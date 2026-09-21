import type { ContentType, Effort, Platform, SlotType } from '@/lib/domain/enums';
import type { BacklogItem, ContentUnit, CoreVideo, Learning } from '@/lib/domain/schema';
import { weekDates } from '@/lib/domain/week';

export type ProposedVariant = {
  platform: Platform;
  surface: string;
  format: string;
  hook: string;
  ready_to_use_copy: string;
  visual_instruction: string;
  cta: string;
};

export type ProposedUnit = {
  date: string;
  title: string;
  slot_type: SlotType;
  content_type: ContentType;
  source: string;
  related_core_video_id: string | null;
  objective: string;
  hypothesis: string;
  expected_signal: string;
  estimated_effort: Effort;
  ai_reasoning_short: string;
  platforms: ProposedVariant[];
};

export type PlannerInputs = {
  weekId: string;
  coreVideos: CoreVideo[];
  backlog: BacklogItem[];
  learnings: Learning[];
  previousUnits: ContentUnit[];
  salesLevel: 'none' | 'micro' | 'soft' | 'direct';
};

/**
 * The starting weekly rhythm from the brief. A template, not a law — the
 * planner (and the user) may drop, move or merge slots.
 */
export const RHYTHM: Array<{ day: number; slot: SlotType; type: ContentType }> = [
  { day: 0, slot: 'topic_hypothesis', type: 'DISCOVERY' },
  { day: 1, slot: 'process_backstage', type: 'PROCESS' },
  { day: 3, slot: 'core_video', type: 'CORE' },
  { day: 4, slot: 'audience_extension', type: 'AUDIENCE' },
  { day: 5, slot: 'authority_commercial', type: 'AUTHORITY' },
  { day: 6, slot: 'core_video_2', type: 'CORE' },
];

/**
 * Which backstage material the pipeline has actually produced by a given stage.
 * Mirrors context/PRODUCTION_PIPELINE.md §4 — the planner must never invent
 * production that does not exist.
 */
export const STAGE_MATERIAL: Record<string, { label: string; visual: string }> = {
  idea: { label: 'отклонённые темы и референсы', visual: 'Скриншот списка тем-кандидатов, отклонённые вычеркнуты.' },
  research: { label: 'факты, не вошедшие в ролик', visual: 'Текстовая карточка с фактом на фоне кадра из ролика.' },
  storyboard: { label: 'текстовая раскадровка', visual: 'Скриншот куска текстовой раскадровки; одну сцену выделить.' },
  shooting: { label: 'raw-кадр ведущего до вырезания', visual: 'Raw-кадр Sweater Man на исходном фоне рядом с вырезанным.' },
  assets: { label: 'master assets и их вариации', visual: 'Сетка: master asset в центре, 4 вариации вокруг; одна явно бракованная.' },
  assembly: { label: 'промежуточный кадр сцены', visual: 'Before/after: пустой сгенерированный фон → фон с вставленным ведущим.' },
  capcut: { label: 'CapCut timeline', visual: 'Скриншот таймлайна CapCut с дорожками субтитров и звука.' },
  ready: { label: 'финальные кадры', visual: 'Финальный кадр рядом с его первой генерацией.' },
  published: { label: 'опубликованный ролик', visual: 'Кадр из опубликованного ролика.' },
};

function effortCap(learnings: Learning[]): Effort {
  // A HIGH-confidence effort learning tightens the default budget.
  const tight = learnings.some(
    (l) => l.confidence === 'HIGH' && l.tags.some((t) => t.startsWith('effort:')),
  );
  return tight ? 'XS' : 'S';
}

function avoidsCarousel(learnings: Learning[]): boolean {
  return learnings.some(
    (l) => l.confidence !== 'LOW' && l.tags.includes('effort:carousel'),
  );
}

/**
 * Builds a grounded skeleton for a week from durable state alone: which core
 * videos are in production, what the backlog wants tested, what the learnings
 * say about effort. The AI receives this as a starting point and rewrites the
 * copy; the deterministic provider uses it as-is.
 */
export function buildWeekSkeleton(input: PlannerInputs): ProposedUnit[] {
  const dates = weekDates(input.weekId);
  const cap = effortCap(input.learnings);
  const noCarousel = avoidsCarousel(input.learnings);

  const upcoming = input.coreVideos
    .filter((v) => v.production_stage !== 'published')
    .sort((a, b) =>
      (a.planned_publish_date ?? '9999-99-99').localeCompare(b.planned_publish_date ?? '9999-99-99'),
    );
  const primary = upcoming[0] ?? null;
  const secondary = upcoming[1] ?? null;

  const testable = input.backlog
    .filter((b) => ['RAW', 'TEST', 'PROMISING', 'RESEARCH'].includes(b.status))
    .sort((a, b) => {
      const order = { PROMISING: 0, RESEARCH: 1, TEST: 2, RAW: 3 } as Record<string, number>;
      return (order[a.status] ?? 9) - (order[b.status] ?? 9);
    });

  const usedTitles = new Set(input.previousUnits.map((u) => u.title.toLowerCase()));
  const out: ProposedUnit[] = [];

  /* MON — topic hypothesis, straight from the backlog */
  const idea = testable.find((b) => !usedTitles.has(b.title.toLowerCase())) ?? testable[0];
  if (idea) {
    out.push({
      date: dates[0],
      title: `Тест темы: ${idea.title}`,
      slot_type: 'topic_hypothesis',
      content_type: 'DISCOVERY',
      source: `backlog:${idea.id}`,
      related_core_video_id: null,
      objective: 'Понять, есть ли интерес к теме до того, как тратить на неё производство.',
      hypothesis: idea.why_interesting || `Тема «${idea.title}» может стать Core-кандидатом.`,
      expected_signal:
        'Если на poll отвечает заметно больше людей, чем обычно, и в комментариях просят продолжение — тема переходит в PROMISING. Один удачный poll сам по себе ничего не доказывает.',
      estimated_effort: cap,
      ai_reasoning_short: `Backlog item ${idea.id} в статусе ${idea.status}: дешевле проверить опросом, чем роликом.`,
      platforms: [
        {
          platform: 'instagram',
          surface: 'story',
          format: 'story_poll',
          hook: `${idea.title}. Что думаешь?`,
          ready_to_use_copy: `${idea.title}\n\nОпрос: хочешь про это отдельный ролик?\n• Да, давай\n• Не интересно`,
          visual_instruction:
            'Один статичный кадр по теме на всю Story, крупный текст-вопрос сверху, стикер опроса снизу.',
          cta: '',
        },
        {
          platform: 'youtube',
          surface: 'community_poll',
          format: 'poll',
          hook: idea.title,
          ready_to_use_copy: `${idea.title}\n\nСнимать про это следующий ролик?\n• Да\n• Лучше другое`,
          visual_instruction: 'Без изображения либо один кадр по теме.',
          cta: '',
        },
      ],
    });
  }

  /* TUE — process / backstage, only from material that actually exists */
  if (primary) {
    const material = STAGE_MATERIAL[primary.production_stage] ?? STAGE_MATERIAL.assets;
    const asset = primary.available_assets[0]?.label;
    out.push({
      date: dates[1],
      title: `Backstage ${primary.id}: ${material.label}`,
      slot_type: 'process_backstage',
      content_type: 'PROCESS',
      source: `core_video:${primary.id}/${primary.production_stage}`,
      related_core_video_id: primary.id,
      objective: 'Показать, что эти ролики делаем мы, и подогреть выход следующего выпуска.',
      hypothesis: 'Процесс интересен сам по себе и одновременно фильтрует creator-аудиторию.',
      expected_signal:
        'Если в ответах и комментариях спрашивают «как это сделано» — причина перехода B работает и можно усиливать authority.',
      estimated_effort: cap,
      ai_reasoning_short: `${primary.id} на стадии ${primary.production_stage}: ${material.label}${asset ? ` (есть ассет «${asset}»)` : ''} уже существует, нового продакшена не требуется.`,
      platforms: [
        {
          platform: 'instagram',
          surface: 'story',
          format: 'story_series',
          hook: 'Так это выглядит до монтажа',
          ready_to_use_copy: `Следующий ролик: ${primary.working_title}.\n\n${material.label} — вот на этой стадии он сейчас.\n\nВопрос: угадаешь, что здесь настоящее, а что сгенерировано?`,
          visual_instruction: material.visual,
          cta: 'Как мы это делаем — ссылка в профиле',
        },
        {
          platform: 'tiktok',
          surface: 'photo_mode',
          format: 'photo_carousel_3',
          hook: 'Ролик до того, как он стал роликом',
          ready_to_use_copy: `1. ${material.label}\n2. То же самое ближе\n3. Что из этого попадёт в финал\n\nСледующий выпуск: ${primary.working_title}.`,
          visual_instruction: `3 кадра, без монтажа: ${material.visual}`,
          cta: '',
        },
      ],
    });
  }

  /* THU — core video */
  if (primary) {
    out.push({
      date: dates[3],
      title: primary.working_title,
      slot_type: 'core_video',
      content_type: 'CORE',
      source: `core_video:${primary.id}`,
      related_core_video_id: primary.id,
      objective: 'Основной выпуск недели: охват и вход в воронку.',
      hypothesis: primary.topic
        ? `Тема «${primary.topic}» удержит reach в когорте животных/reputation reversal.`
        : 'Основной выпуск держит охват на уровне медианы когорты B.',
      expected_signal:
        'Оцениваем на D+30, не на D+7: всплытия через недели реальны (V022, V001). На D+2 смотрим только, не провалился ли старт.',
      estimated_effort: 'L',
      ai_reasoning_short: `${primary.id} запланирован к публикации; ставим в четверг по недельному ритму.`,
      platforms: [
        {
          platform: 'youtube',
          surface: 'shorts',
          format: 'vertical_short',
          hook: primary.working_title,
          ready_to_use_copy: `${primary.working_title}\n\n#shorts`,
          visual_instruction: 'Финальный вертикальный ролик из CapCut.',
          cta: 'Как мы делаем такие ролики — ссылка в описании канала',
        },
        {
          platform: 'instagram',
          surface: 'reel',
          format: 'reel',
          hook: primary.working_title,
          ready_to_use_copy: `${primary.working_title}`,
          visual_instruction: 'Тот же мастер-файл, вертикаль 9:16.',
          cta: 'Ссылка в профиле',
        },
        {
          platform: 'tiktok',
          surface: 'video',
          format: 'video',
          hook: primary.working_title,
          ready_to_use_copy: `${primary.working_title}`,
          visual_instruction: 'Тот же мастер-файл.',
          cta: '',
        },
      ],
    });
  }

  /* FRI — audience extension from research that already exists */
  if (primary) {
    out.push({
      date: dates[4],
      title: `Что не вошло в ${primary.id}`,
      slot_type: 'audience_extension',
      content_type: 'AUDIENCE',
      source: `core_video:${primary.id}/research`,
      related_core_video_id: primary.id,
      objective: 'Продлить жизнь темы недели и собрать сигнал по смежным темам.',
      hypothesis: 'Вырезанный факт работает как самостоятельный пост и почти ничего не стоит.',
      expected_signal:
        'Если saves/shares здесь выше обычного для supporting-поста — смежная тема годится в backlog как кандидат.',
      estimated_effort: 'XS',
      ai_reasoning_short:
        'Ресёрч под ролик уже сделан; лишний факт — бесплатный контент по PRODUCTION_PIPELINE §3.',
      platforms: [
        {
          platform: 'instagram',
          surface: noCarousel ? 'story' : 'carousel',
          format: noCarousel ? 'story_single' : 'carousel_3',
          hook: 'Это не влезло в ролик',
          ready_to_use_copy: `Пока собирали ${primary.working_title}, нашли ещё одну деталь, которой не нашлось места.\n\n[факт из ресёрча — перепроверить перед публикацией]\n\nЕсли такое интересно — в Telegram такого больше.`,
          visual_instruction: noCarousel
            ? 'Одна Story: кадр из ролика + текст факта поверх.'
            : '3 карточки: кадр из ролика, текст факта, финальная карточка с вопросом.',
          cta: 'Ссылка в профиле',
        },
      ],
    });
  }

  /* SAT — authority, with a commercial touch when there is something to offer */
  if (primary) {
    const commercial = input.salesLevel !== 'none';
    out.push({
      date: dates[5],
      title: commercial
        ? `Как собран кадр из ${primary.id} + приглашение в waitlist`
        : `Как собран кадр из ${primary.id}`,
      slot_type: 'authority_commercial',
      content_type: commercial ? 'COMMERCIAL' : 'AUTHORITY',
      source: `core_video:${primary.id}/assets`,
      related_core_video_id: primary.id,
      objective: commercial
        ? 'Показать приём и собрать creator/pro в Telegram-waitlist.'
        : 'Показать приём и укрепить authority.',
      hypothesis:
        'Authority-пост с реальным материалом выпуска фильтрует creator/pro лучше, чем общий контент.',
      expected_signal:
        'Если доля creator+pro среди новых Telegram starts выше обычного — причина перехода C работает как lead magnet.',
      estimated_effort: cap === 'XS' ? 'S' : cap,
      ai_reasoning_short: `FUNNEL_PLAYBOOK §2: authority уместен, когда у ролика есть заметное визуальное решение. Sales level = ${input.salesLevel}.`,
      platforms: [
        {
          platform: 'instagram',
          surface: 'story',
          format: 'story_series',
          hook: 'Один кадр, три генерации',
          ready_to_use_copy: `Этот кадр из ${primary.working_title} с первого раза не получился.\n\nСгенерировали фон, вырезали ведущего, собрали сцену — и только третий вариант сел нормально.\n\n${commercial ? 'Готовим обучение тому, как это делается. Встать в список — по ссылке.' : ''}`.trim(),
          visual_instruction:
            'Story 1: первая генерация. Story 2: вырезанный ведущий отдельно. Story 3: финальная сцена.',
          cta: commercial ? 'Link sticker → Telegram, waitlist' : 'Ссылка в профиле',
        },
        {
          platform: 'telegram',
          surface: 'bot_broadcast',
          format: 'text_with_images',
          hook: 'Разбор одного кадра',
          ready_to_use_copy: `Разбор кадра из ${primary.working_title}: что сгенерировали, что вырезали, что переделывали.\n\n${commercial ? 'Если хочешь научиться собирать такие кадры — кнопка ниже поставит тебя в список.' : ''}`.trim(),
          visual_instruction: 'Те же 3 изображения, что и в Story.',
          cta: commercial ? '[Встать в список] [Позже]' : '[Как это сделано]',
        },
      ],
    });
  }

  /* SUN — second core video only if one genuinely exists */
  if (secondary && secondary.planned_publish_date) {
    out.push({
      date: dates[6],
      title: secondary.working_title,
      slot_type: 'core_video_2',
      content_type: 'CORE',
      source: `core_video:${secondary.id}`,
      related_core_video_id: secondary.id,
      objective: 'Второй выпуск недели.',
      hypothesis: 'Две публикации в неделю удерживают частоту без потери качества.',
      expected_signal: 'Сравнить D+30 с предыдущими неделями, где был один Core.',
      estimated_effort: 'L',
      ai_reasoning_short: `${secondary.id} тоже готов к публикации на этой неделе.`,
      platforms: [
        {
          platform: 'youtube',
          surface: 'shorts',
          format: 'vertical_short',
          hook: secondary.working_title,
          ready_to_use_copy: `${secondary.working_title}\n\n#shorts`,
          visual_instruction: 'Финальный вертикальный ролик.',
          cta: '',
        },
      ],
    });
  }

  return out;
}

/** A short note explaining the shape of the generated week. */
export function planningNote(units: ProposedUnit[], input: PlannerInputs): string {
  const byType = units.reduce<Record<string, number>>((acc, u) => {
    acc[u.content_type] = (acc[u.content_type] ?? 0) + 1;
    return acc;
  }, {});
  const mix = Object.entries(byType)
    .map(([t, n]) => `${t}×${n}`)
    .join(', ');
  const cores = units.filter((u) => u.content_type === 'CORE').length;
  const budget =
    cores <= 2
      ? `${cores} Core — в рамках бюджета 1–2 ролика в неделю`
      : `${cores} Core — выше бюджета, нужно сократить`;
  const effortNote = input.learnings.some(
    (l) => l.confidence === 'HIGH' && l.tags.some((t) => t.startsWith('effort:')),
  )
    ? ' Supporting прижат к XS из-за HIGH-confidence learning про трудозатраты.'
    : '';
  return `Микс: ${mix}. ${budget}.${effortNote}`;
}
