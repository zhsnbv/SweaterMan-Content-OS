import type { AgentRequest, AgentResponse, AiProvider, VisionRequest } from '../provider';
import type { ToolContext } from '../tools';
import { TOOLS_BY_NAME } from '../tools';
import { buildWeekSkeleton, planningNote } from '@/lib/services/planner';
import { currentWeekId, previousWeekId, weekDates } from '@/lib/domain/week';
import type { ContentUnit, PlatformVariant } from '@/lib/domain/schema';
import { rankLearnings } from '@/lib/services/learnings';

/**
 * Deterministic engine used when no model key is configured (AI_PROVIDER=mock,
 * local dev, CI, tests).
 *
 * It is NOT a stub. It reads the same durable context, calls the same tools and
 * writes the same revisions and GitHub snapshots as a real model — it just
 * derives its decisions from rules and existing production data instead of
 * generating prose. That keeps every acceptance flow runnable end-to-end
 * without credentials, and keeps the tool layer honest.
 */
export class MockProvider implements AiProvider {
  readonly name = 'deterministic';
  readonly live = false;

  async run(req: AgentRequest): Promise<AgentResponse> {
    const last = [...req.messages].reverse().find((m) => m.role === 'user');
    const message = (last?.content ?? '').trim();
    const ctx = req.ctx;

    try {
      if (ctx.scope.kind === 'content_unit') {
        return await this.editUnit(ctx, message);
      }
      if (isReviewIntent(message)) {
        return await this.review(ctx, message);
      }
      if (isNewWeekIntent(message)) {
        return await this.newWeek(ctx, message);
      }
      if (isBacklogIntent(message)) {
        return await this.addIdeas(ctx, message);
      }
      return await this.answer(ctx, message);
    } catch (err) {
      return {
        text: `Не получилось выполнить: ${err instanceof Error ? err.message : String(err)}`,
        toolCalls: ctx.calls,
      };
    }
  }

  /* ---------------- «Новая неделя, обнови план» ---------------- */

  private async newWeek(ctx: ToolContext, message: string): Promise<AgentResponse> {
    const targetWeek = explicitWeek(message) ?? scopeWeek(ctx) ?? currentWeekId();
    const prevWeek = previousWeekId(targetWeek);
    const notes: string[] = [];

    // STEP 1 — review the previous week if nobody has.
    const prevUnits = await ctx.store.listUnits({ weekId: prevWeek });
    const existingReview = await ctx.store.getReview(prevWeek);
    if (!existingReview && prevUnits.length) {
      await call(ctx, 'run_weekly_review', { week_id: prevWeek });
      notes.push(`Предыдущая неделя ${prevWeek} не была разобрана — сделал review автоматически.`);
    } else if (existingReview) {
      notes.push(`Review ${prevWeek} уже был — взял его выводы.`);
    } else {
      notes.push(`Предыдущей недели ${prevWeek} в системе нет — планирую с нуля.`);
    }

    // STEP 2–4 — read everything durable that should shape the plan.
    const [learnings, coreVideos, backlog, strategy, reports] = await Promise.all([
      ctx.store.listLearnings(),
      ctx.store.listCoreVideos(),
      ctx.store.listBacklog(),
      ctx.store.getStrategyState(),
      ctx.store.listReports(),
    ]);
    const ranked = rankLearnings(learnings, { limit: 12 });
    const confirmed = reports.filter((r) => r.confirmed);

    if (ranked.length) {
      const high = ranked.filter((l) => l.confidence === 'HIGH');
      notes.push(
        high.length
          ? `Учёл ${ranked.length} learnings, из них HIGH: ${high.map((l) => l.action || l.observation).join(' · ')}`
          : `Учёл ${ranked.length} learnings (все пока LOW/MEDIUM — как ограничения, не как доказательства).`,
      );
    }
    notes.push(
      confirmed.length
        ? `Подтверждённых отчётов в системе: ${confirmed.length}.`
        : 'Подтверждённой аналитики пока нет — формат не меняю без данных.',
    );

    const upcoming = coreVideos.filter((v) => v.production_stage !== 'published');
    notes.push(
      upcoming.length
        ? `Ближайшие Core: ${upcoming.map((v) => `${v.id} (${v.production_stage})`).join(', ')}.`
        : 'Core-роликов в производстве нет — supporting строю из backlog и прошлых материалов.',
    );

    // STEP 5 — assemble the week from real state.
    const skeleton = buildWeekSkeleton({
      weekId: targetWeek,
      coreVideos,
      backlog,
      learnings: ranked,
      previousUnits: prevUnits,
      salesLevel: strategy.sales_level,
    });

    const constrained = applyMessageConstraints(skeleton, message);

    if (!constrained.length) {
      return {
        text: 'Нечего планировать: нет ни Core-роликов в производстве, ни идей в backlog. Добавьте Core Video или идею в backlog, и повторите команду.',
        toolCalls: ctx.calls,
      };
    }

    // STEP 6 — save.
    const note = planningNote(constrained, {
      weekId: targetWeek,
      coreVideos,
      backlog,
      learnings: ranked,
      previousUnits: prevUnits,
      salesLevel: strategy.sales_level,
    });

    // STEP 7 — create_week_plan queues the durable GitHub sync itself.
    const result: any = await call(ctx, 'create_week_plan', {
      week_id: targetWeek,
      planning_note: note,
      replace_existing: true,
      units: constrained,
    });

    const lines = constrained.map(
      (u) =>
        `• ${dayName(u.date)} — ${u.content_type} · ${u.title} (${u.estimated_effort}) → ${u.platforms
          .map((p) => `${p.platform}/${p.surface}`)
          .join(', ')}`,
    );

    return {
      text: [
        `Неделя ${targetWeek} собрана: ${result.count} карточек.`,
        '',
        ...lines,
        '',
        note,
        '',
        'Что учтено:',
        ...notes.map((n) => `— ${n}`),
        '',
        'Состояние сохранено и отправлено в durable snapshot.',
      ].join('\n'),
      toolCalls: ctx.calls,
    };
  }

  /* ---------------- card-scoped editing ---------------- */

  private async editUnit(ctx: ToolContext, message: string): Promise<AgentResponse> {
    if (ctx.scope.kind !== 'content_unit') throw new Error('not a unit scope');
    const unitId = ctx.scope.unitId;
    const unit = await ctx.store.getUnit(unitId);
    if (!unit) throw new Error(`Карточка ${unitId} не найдена`);

    // Feedback is persisted first, so it survives even if nothing else changes.
    await call(ctx, 'record_user_feedback', { content_unit_id: unitId, feedback: message });

    const intents = detectEditIntents(message);
    if (!intents.length) {
      return {
        text: [
          'Записал ваш комментарий к карточке.',
          '',
          'Детерминированный движок умеет выполнять: «упрости» / «быстрее» / «короче» / «смешнее» / «одна Story вместо карусели» / «агрессивнее продавай» / «перенеси на <день>».',
          'Для свободных правок текста подключите ANTHROPIC_API_KEY или OPENAI_API_KEY в Settings.',
        ].join('\n'),
        toolCalls: ctx.calls,
      };
    }

    const { platforms, effort, applied } = applyEditIntents(unit, intents);

    const patch: Record<string, unknown> = { platforms };
    if (effort && effort !== unit.estimated_effort) patch.estimated_effort = effort;
    patch.ai_reasoning_short = `Правка по фидбеку: ${applied.join('; ')}`;

    const result: any = await call(ctx, 'update_content_unit', {
      content_unit_id: unitId,
      reason: message.slice(0, 160),
      ...patch,
    });

    const moveTo = detectMove(message, unit.week_id);
    if (moveTo && moveTo !== unit.date) {
      await call(ctx, 'move_content_unit', { content_unit_id: unitId, date: moveTo });
      applied.push(`перенесена на ${moveTo}`);
    }

    return {
      text: [
        `Изменил только ${unitId}.`,
        '',
        `Что сделал: ${applied.join('; ')}.`,
        '',
        'Что изменилось:',
        result.diff_summary,
        '',
        `Сохранена ревизия #${result.revision_number - 1}, откатить можно кнопкой Undo. Изменения ушли в durable snapshot.`,
      ].join('\n'),
      toolCalls: ctx.calls,
    };
  }

  /* ---------------- weekly review ---------------- */

  private async review(ctx: ToolContext, message: string): Promise<AgentResponse> {
    const weekId = explicitWeek(message) ?? scopeWeek(ctx) ?? currentWeekId();
    const target = /предыдущ|прошл|previous|last/i.test(message) ? previousWeekId(weekId) : weekId;
    const result: any = await call(ctx, 'run_weekly_review', { week_id: target });
    const review = result.review;

    const lines = review.units.map(
      (u: any) =>
        `• ${u.content_unit_id} ${u.title}\n  хотели проверить: ${u.what_we_wanted_to_test}\n  что произошло: ${u.what_happened}\n  результат: ${u.result}`,
    );

    return {
      text: [
        `Review ${target} готов.`,
        '',
        ...(lines.length ? lines : ['(в этой неделе нет карточек)']),
        '',
        `CONTENT: ${review.content_summary}`,
        `PRODUCTION: ${review.production_summary}`,
        `FUNNEL: ${review.funnel_summary}`,
        `BACKLOG: ${review.backlog_summary}`,
        `USER FEEDBACK: ${review.user_feedback_summary}`,
        '',
        'NEXT WEEK CHANGES:',
        review.next_week_changes,
        result.new_learnings?.length
          ? `\nНовых learnings записано: ${result.new_learnings.length}.`
          : '',
      ]
        .filter(Boolean)
        .join('\n'),
      toolCalls: ctx.calls,
    };
  }

  /* ---------------- backlog ---------------- */

  private async addIdeas(ctx: ToolContext, message: string): Promise<AgentResponse> {
    const count = Math.min(Number(/(\d+)/.exec(message)?.[1] ?? 2), 5);
    const existing = await ctx.store.listBacklog();
    const known = new Set(existing.map((b) => b.title.toLowerCase()));

    // Seeded from the clusters MASTER_CONTEXT says are still untested, not invented at random.
    const candidates = [
      {
        title: 'Животные, которые узнают себя в зеркале — и что делают дальше',
        cluster: 'animals_nature',
        why: 'Reputation reversal по H1: знакомый объект с ярлыком. Серия n=3, нужно n≥5.',
        test: 'Story poll: «Кто из этих четверых узнаёт себя в зеркале?»',
      },
      {
        title: 'Известная катастрофа глазами человека, который был рядом',
        cluster: 'history',
        why: 'H3: история = модель редкого мега-хита (V001). Нужно 2 ролика для проверки.',
        test: 'YouTube Community poll: три события на выбор.',
      },
      {
        title: 'Что вымерло последним из динозавров и как долго это тянулось',
        cluster: 'prehistory_evolution',
        why: 'H4: deep time даёт меньше reach, но subs/1k ~1,7–1,8× канала.',
        test: 'TikTok photo mode с одним вопросом в конце.',
      },
      {
        title: 'Симбиоз, часть 3 — кто кого использует на самом деле',
        cluster: 'animals_nature',
        why: 'H2: «ч.2» успешной темы (V026 ← V003) дала 488K. Проверить на третьей части.',
        test: 'Story poll: «Нужна третья часть про дружбы?»',
      },
      {
        title: 'Почему у глубоководных рыб такие глаза',
        cluster: 'animals_nature',
        why: 'Single animal deep dive: медиана 27K, один хит (V022).',
        test: 'YouTube Community quiz из трёх вариантов.',
      },
    ];

    const added = [];
    for (const c of candidates) {
      if (added.length >= count) break;
      if (known.has(c.title.toLowerCase())) continue;
      const res: any = await call(ctx, 'add_backlog_item', {
        title: c.title,
        source: 'ai_suggestion',
        cluster: c.cluster,
        why_interesting: c.why,
        suggested_test: c.test,
        status: 'RAW',
      });
      added.push(res.item);
    }

    return {
      text: added.length
        ? [
            `Добавил ${added.length} идей в backlog:`,
            '',
            ...added.map((i: any) => `• ${i.title}\n  почему: ${i.why_interesting}\n  как проверить: ${i.suggested_test}`),
          ].join('\n')
        : 'Все подходящие идеи уже есть в backlog.',
      toolCalls: ctx.calls,
    };
  }

  /* ---------------- questions ---------------- */

  private async answer(ctx: ToolContext, message: string): Promise<AgentResponse> {
    const [learnings, reviews, units, reports] = await Promise.all([
      ctx.store.listLearnings(),
      ctx.store.listReviews(),
      ctx.store.listUnits(),
      ctx.store.listReports(),
    ]);
    const confirmed = reports.filter((r) => r.confirmed);
    const ranked = rankLearnings(learnings, { limit: 8 });

    if (/что мы поняли|learnings|выучил|узнали/i.test(message)) {
      return {
        text: ranked.length
          ? [
              'Что накопилось в learnings (по убыванию релевантности):',
              '',
              ...ranked.map(
                (l) => `• [${l.confidence}] ${l.observation}\n  evidence: ${l.evidence.join('; ')}\n  действие: ${l.action || '—'}`,
              ),
              '',
              'Напоминание: LOW — это наблюдение, а не правило.',
            ].join('\n')
          : 'Learnings пока нет. Они появляются после weekly review и подтверждённой аналитики.',
        toolCalls: ctx.calls,
      };
    }

    return {
      text: [
        'Детерминированный движок без ключа модели отвечает только на структурные вопросы.',
        '',
        `Сейчас в системе: карточек ${units.length}, недель с review ${reviews.length}, подтверждённых отчётов ${confirmed.length}, learnings ${learnings.length}.`,
        '',
        'Команды, которые он выполняет полностью: «Новая неделя, обнови план», «Сделай weekly review», «Добавь N идей в backlog», «Что мы поняли».',
        'Для свободного диалога добавьте ANTHROPIC_API_KEY или OPENAI_API_KEY.',
      ].join('\n'),
      toolCalls: ctx.calls,
    };
  }

  /* ---------------- vision ---------------- */

  async extractMetrics(_req: VisionRequest) {
    // Without a vision model nothing is "seen" — and the system must never
    // invent a number. The user types the metrics in the confirmation screen.
    return {
      metrics: [],
      note: 'Модель со зрением не подключена, поэтому ничего не извлечено. Впишите видимые показатели вручную — остальные оставьте NA. Система никогда не додумывает цифры.',
    };
  }
}

/* ------------------------------------------------------------------ *
 * Intent detection + deterministic transforms
 * ------------------------------------------------------------------ */

function isNewWeekIntent(m: string): boolean {
  return /нов(ая|ую) недел|обнови план|сгенерируй недел|generate week|new week|план на недел/i.test(m);
}
function isReviewIntent(m: string): boolean {
  return /review|разбор недел|итоги недел|подведи итоги/i.test(m);
}
function isBacklogIntent(m: string): boolean {
  return /backlog|бэклог|идей для теста|добавь .*иде/i.test(m);
}

export type EditIntent =
  | 'simplify'
  | 'cheaper'
  | 'shorter'
  | 'funnier'
  | 'single_story'
  | 'sell_harder';

export function detectEditIntents(m: string): EditIntent[] {
  const out: EditIntent[] = [];
  if (/упрост|слишком сложно|проще|попроще/i.test(m)) out.push('simplify');
  if (/долго|быстр|10 минут|дешев|меньше работы|не успе|трудоём/i.test(m)) out.push('cheaper');
  if (/корот|сократ|в два раза|вдвое|меньше текста/i.test(m)) out.push('shorter');
  if (/смешн|юмор|веселее|скучн/i.test(m)) out.push('funnier');
  if (/не хочу карусел|одну? stor|одна stor|вместо карусел|сделай stor/i.test(m))
    out.push('single_story');
  if (/агрессивн|продава|продаж|курс|waitlist|оффер/i.test(m)) out.push('sell_harder');
  return Array.from(new Set(out));
}

function halve(text: string): string {
  const parts = text.split(/\n{2,}/).filter(Boolean);
  if (parts.length > 1) return parts.slice(0, Math.max(1, Math.ceil(parts.length / 2))).join('\n\n');
  const sentences = text.split(/(?<=[.!?…])\s+/).filter(Boolean);
  if (sentences.length > 1) {
    return sentences.slice(0, Math.max(1, Math.ceil(sentences.length / 2))).join(' ');
  }
  return text.length > 120 ? `${text.slice(0, 117).trimEnd()}…` : text;
}

function simplify(text: string): string {
  // One idea per post: keep the first block, drop enumerations and asides.
  const first = text.split(/\n{2,}/)[0] ?? text;
  return first
    .replace(/\s*\([^)]*\)/g, '')
    .replace(/[;—–]\s*/g, '. ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

const DRY_LINES = [
  'Природа, как обычно, не спрашивала.',
  'Никто из участников не был в курсе.',
  'Эволюция это придумала раньше нас и без ТЗ.',
  'Выглядит нелепо. Работает лучше нашего.',
];

function funnier(text: string, seed: number): string {
  const line = DRY_LINES[seed % DRY_LINES.length];
  const stripped = text.replace(/!+/g, '.').trimEnd();
  return stripped.endsWith(line) ? stripped : `${stripped}\n\n${line}`;
}

function sellHarder(text: string): string {
  const offer =
    'Мы учим делать такие ролики. Список на обучение открыт — ссылка в профиле, места считаем по факту, без таймеров.';
  return text.includes('обучение') ? text : `${text.trimEnd()}\n\n${offer}`;
}

export function applyEditIntents(
  unit: ContentUnit,
  intents: EditIntent[],
): { platforms: PlatformVariant[]; effort: ContentUnit['estimated_effort'] | null; applied: string[] } {
  const applied: string[] = [];
  let effort: ContentUnit['estimated_effort'] | null = null;

  let platforms = unit.platforms.map((p) => ({ ...p }));

  if (intents.includes('single_story') || intents.includes('cheaper') || intents.includes('simplify')) {
    const carousels = platforms.filter((p) => /carousel|photo_mode/.test(`${p.surface}${p.format}`));
    if (carousels.length) {
      platforms = platforms.map((p) =>
        /carousel|photo_mode/.test(`${p.surface}${p.format}`)
          ? {
              ...p,
              surface: p.platform === 'instagram' ? 'story' : p.surface,
              format: p.platform === 'instagram' ? 'story_single' : 'photo_single',
              visual_instruction:
                'Один кадр из уже существующего материала, текст поверх. Ничего дополнительно не производим.',
            }
          : p,
      );
      applied.push('карусель заменена на один кадр / Story');
    }
  }

  if (intents.includes('single_story')) {
    const ig = platforms.filter((p) => p.platform === 'instagram');
    if (platforms.length > 1 && ig.length) {
      platforms = [{ ...ig[0], surface: 'story', format: 'story_single', position: 0 }];
      applied.push('оставлена одна Instagram Story, остальные площадки убраны');
    }
  }

  if (intents.includes('cheaper')) {
    platforms = platforms.slice(0, 1).map((p) => ({
      ...p,
      visual_instruction: `${p.visual_instruction ? `${p.visual_instruction} ` : ''}Использовать только уже существующий материал: один готовый кадр, без новой генерации и без досъёмки.`.trim(),
    }));
    effort = 'XS';
    applied.push('оставлена одна площадка, визуал только из существующего материала, effort → XS');
  }

  if (intents.includes('simplify')) {
    platforms = platforms.map((p) => ({
      ...p,
      ready_to_use_copy: simplify(p.ready_to_use_copy),
      visual_instruction: simplify(p.visual_instruction),
    }));
    if (!effort) effort = unit.estimated_effort === 'L' ? 'M' : 'S';
    applied.push('текст сведён к одной мысли');
  }

  if (intents.includes('shorter')) {
    platforms = platforms.map((p) => ({
      ...p,
      ready_to_use_copy: halve(p.ready_to_use_copy),
      hook: p.hook.length > 60 ? halve(p.hook) : p.hook,
    }));
    applied.push('текст сокращён примерно вдвое');
  }

  if (intents.includes('funnier')) {
    platforms = platforms.map((p, i) => ({
      ...p,
      ready_to_use_copy: funnier(p.ready_to_use_copy, unit.id.length + i),
    }));
    applied.push('добавлена сухая финальная строка, восклицания убраны');
  }

  if (intents.includes('sell_harder')) {
    platforms = platforms.map((p, i) => ({
      ...p,
      ready_to_use_copy: i === 0 ? sellHarder(p.ready_to_use_copy) : p.ready_to_use_copy,
      cta: i === 0 ? 'Link sticker → Telegram, список на обучение' : p.cta,
    }));
    applied.push('добавлен прямой оффер обучения и CTA в Telegram');
  }

  return { platforms, effort, applied };
}

/** Week-level constraints the user can state in the same message. */
function applyMessageConstraints<T extends { content_type: string; date: string }>(
  units: T[],
  message: string,
): T[] {
  let out = [...units];

  if (/только один core|один core|1 core|only one core/i.test(message)) {
    let seen = false;
    out = out.filter((u) => {
      if (u.content_type !== 'CORE') return true;
      if (seen) return false;
      seen = true;
      return true;
    });
  }

  if (/суббот.*продаж|прям(ую|ая) продаж|direct sell/i.test(message)) {
    out = out.map((u) =>
      u.content_type === 'AUTHORITY' ? { ...u, content_type: 'COMMERCIAL' as never } : u,
    );
  }

  if (/меньше карточек|короче недел|поменьше постов/i.test(message)) {
    out = out.slice(0, 4);
  }

  return out;
}

function detectMove(message: string, weekId: string): string | null {
  const days: Array<[RegExp, number]> = [
    [/понедельник|monday/i, 0],
    [/вторник|tuesday/i, 1],
    [/сред[уа]|wednesday/i, 2],
    [/четверг|thursday/i, 3],
    [/пятниц|friday/i, 4],
    [/суббот|saturday/i, 5],
    [/воскресень|sunday/i, 6],
  ];
  if (!/перенес|подвинь|move|поставь на/i.test(message)) return null;
  for (const [re, idx] of days) {
    if (re.test(message)) return weekDates(weekId)[idx];
  }
  return null;
}

function explicitWeek(message: string): string | null {
  return /(\d{4}-W\d{2})/.exec(message)?.[1] ?? null;
}

function scopeWeek(ctx: ToolContext): string | null {
  return ctx.scope.kind === 'week' ? ctx.scope.weekId : null;
}

function dayName(date: string): string {
  const names = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
  const d = new Date(`${date}T00:00:00Z`);
  return names[(d.getUTCDay() + 6) % 7];
}

async function call(ctx: ToolContext, name: string, input: unknown): Promise<unknown> {
  const tool = TOOLS_BY_NAME.get(name);
  if (!tool) throw new Error(`Unknown tool: ${name}`);
  const parsed = tool.inputSchema.parse(input);
  return tool.execute(ctx, parsed);
}
