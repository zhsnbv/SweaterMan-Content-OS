import type { Store } from '@/lib/store';
import type { AnalyticsReport, ContentUnit, WeeklyReview } from '@/lib/domain/schema';
import { weeklyReviewSchema, type ReviewUnitEntry } from '@/lib/domain/schema';
import { uid } from '@/lib/domain/ids';
import { metricValue } from './analytics';
import { learningsFromFeedback, recordLearning } from './learnings';

/**
 * Builds a weekly review from what is actually in storage. Deliberately blunt:
 * for each unit — what we wanted to test, what happened, YES / NO / TOO EARLY.
 * "TOO EARLY" is the honest default, because the strategy docs are explicit
 * that a short cannot be judged on day 7.
 */
export async function runWeeklyReview(
  store: Store,
  workspaceId: string,
  weekId: string,
  opts: { generatedBy?: string; narrative?: Partial<WeeklyReview> } = {},
): Promise<{ review: WeeklyReview; learnings: string[] }> {
  const units = await store.listUnits({ weekId });
  const allReports = await store.listReports();
  const reportsByUnit = new Map<string, AnalyticsReport[]>();
  for (const r of allReports) {
    const list = reportsByUnit.get(r.content_unit_id) ?? [];
    list.push(r);
    reportsByUnit.set(r.content_unit_id, list);
  }

  const entries: ReviewUnitEntry[] = units.map((u) =>
    reviewEntry(u, reportsByUnit.get(u.id) ?? []),
  );

  const published = units.filter((u) =>
    u.platforms.some((p) => p.publish_status === 'published'),
  );
  const confirmedCount = entries.filter((e) => e.result !== 'TOO_EARLY').length;

  const review = weeklyReviewSchema.parse({
    id: uid('rev'),
    workspace_id: workspaceId,
    week_id: weekId,
    units: entries,
    content_summary:
      opts.narrative?.content_summary ??
      `Запланировано ${units.length}, опубликовано ${published.length}. Подтверждённых результатов: ${confirmedCount}. ${
        confirmedCount === 0
          ? 'Выводов по контенту пока нет — нет подтверждённой аналитики.'
          : 'Выводы держим на уровне наблюдений: выборка маленькая.'
      }`,
    production_summary:
      opts.narrative?.production_summary ?? productionSummary(units),
    funnel_summary: opts.narrative?.funnel_summary ?? funnelSummary(units, allReports),
    backlog_summary:
      opts.narrative?.backlog_summary ??
      (units.some((u) => u.content_type === 'DISCOVERY')
        ? 'Тест темы отработал: статус backlog-элемента обновляем только при подтверждённом сигнале, один poll доказательством не считается.'
        : 'Тестов тем на этой неделе не было.'),
    user_feedback_summary:
      opts.narrative?.user_feedback_summary ?? feedbackSummary(units),
    next_week_changes:
      opts.narrative?.next_week_changes ??
      nextWeekChanges(units, entries),
    generated_by: opts.generatedBy ?? 'system',
    created_at: new Date().toISOString(),
  });

  await store.saveReview(review);

  // Repeated team feedback is evidence — turn it into learnings.
  const allUnits = await store.listUnits();
  const fromFeedback = await learningsFromFeedback(store, workspaceId, allUnits);
  const learningIds = fromFeedback.map((l) => l.id);

  // A skipped or unpublished plan is itself an operational signal.
  const unpublished = units.filter(
    (u) => u.status !== 'published' && u.status !== 'skipped' && u.content_type !== 'CORE',
  );
  if (units.length >= 3 && unpublished.length >= Math.ceil(units.length / 2)) {
    const l = await recordLearning(store, workspaceId, {
      category: 'operations',
      observation: 'More than half of a planned week does not get published.',
      evidence: [`${weekId}: ${unpublished.length}/${units.length} units unpublished`],
      action: 'Plan fewer supporting units per week; the real ceiling is lower than the template.',
      tags: ['planning', 'effort:too-long'],
      sourceUnits: unpublished.map((u) => u.id),
    });
    learningIds.push(l.id);
  }

  return { review, learnings: learningIds };
}

function reviewEntry(u: ContentUnit, reports: AnalyticsReport[]): ReviewUnitEntry {
  const confirmed = reports.filter((r) => r.confirmed);
  const wanted =
    u.expected_signal || u.hypothesis || u.objective || 'Явная гипотеза не была записана.';

  if (!u.platforms.some((p) => p.publish_status === 'published')) {
    return {
      content_unit_id: u.id,
      title: u.title,
      what_we_wanted_to_test: wanted,
      what_happened: u.status === 'skipped' ? 'Слот сознательно пропущен.' : 'Не опубликовано.',
      result: 'TOO_EARLY',
      what_to_repeat: '',
      what_to_change:
        u.status === 'skipped'
          ? 'Пропуск — нормально, если он осознанный. Проверить, не был ли слот лишним изначально.'
          : 'Либо упростить до реального бюджета времени, либо не планировать этот слот.',
    };
  }

  if (!confirmed.length) {
    return {
      content_unit_id: u.id,
      title: u.title,
      what_we_wanted_to_test: wanted,
      what_happened: 'Опубликовано, подтверждённых цифр ещё нет.',
      result: 'TOO_EARLY',
      what_to_repeat: '',
      what_to_change: 'Загрузить 24h/72h отчёт, иначе результат не попадёт в learnings.',
    };
  }

  const views = confirmed.map((r) => metricValue(r, 'views')).filter((v): v is number => v !== null);
  const engagement = (['likes', 'shares', 'saves', 'comments', 'poll_votes'] as const)
    .map((k) => confirmed.map((r) => metricValue(r, k)).find((v) => v !== null))
    .filter((v): v is number => v !== null && v !== undefined);

  const what = [
    views.length ? `views: ${views.map((v) => v.toLocaleString('ru-RU')).join(' / ')}` : 'views: NA',
    engagement.length ? `engagement зафиксирован` : 'engagement: NA',
    `отчётов подтверждено: ${confirmed.length}`,
  ].join('; ');

  // With a single confirmed data point we do not claim a verdict.
  const result = confirmed.length >= 2 && views.length ? 'YES' : 'TOO_EARLY';

  return {
    content_unit_id: u.id,
    title: u.title,
    what_we_wanted_to_test: wanted,
    what_happened: what,
    result,
    what_to_repeat:
      result === 'YES' ? 'Формат отработал — можно повторить на следующем выпуске.' : '',
    what_to_change:
      result === 'YES'
        ? ''
        : 'Собрать ещё 1–2 сопоставимых результата, прежде чем делать вывод (n=1 ничего не доказывает).',
  };
}

function productionSummary(units: ContentUnit[]): string {
  const heavy = units.filter((u) => u.estimated_effort === 'L').length;
  const cheap = units.filter((u) => u.estimated_effort === 'XS' || u.estimated_effort === 'S').length;
  const cores = units.filter((u) => u.content_type === 'CORE').length;
  return `Core-роликов: ${cores}. Дорогих единиц (L): ${heavy}. Дешёвых (XS/S): ${cheap}. ${
    cores > 2 ? 'Выше недельного бюджета 1–2 ролика.' : 'В пределах бюджета.'
  }`;
}

function funnelSummary(units: ContentUnit[], reports: AnalyticsReport[]): string {
  const commercial = units.filter((u) => u.content_type === 'COMMERCIAL').length;
  const tgStarts = reports
    .filter((r) => r.confirmed)
    .map((r) => metricValue(r, 'telegram_starts'))
    .filter((v): v is number => v !== null);
  const starts = tgStarts.reduce((a, b) => a + b, 0);
  return `Commercial touches: ${commercial}. Подтверждённых Telegram starts: ${
    tgStarts.length ? starts : 'NA — не заносили'
  }. Цепочка views → starts → creator/pro → waitlist измеряется только по подтверждённым цифрам.`;
}

function feedbackSummary(units: ContentUnit[]): string {
  const fb = units.flatMap((u) => u.user_feedback.map((f) => `${u.id}: ${f}`));
  if (!fb.length) return 'Правок от команды на этой неделе не было.';
  return `${fb.length} правок от команды:\n${fb.map((f) => `- ${f}`).join('\n')}`;
}

function nextWeekChanges(units: ContentUnit[], entries: ReviewUnitEntry[]): string {
  const changes: string[] = [];
  const tooEarly = entries.filter((e) => e.result === 'TOO_EARLY').length;
  if (tooEarly === entries.length && entries.length > 0) {
    changes.push('Не менять формат из-за отсутствия данных — сначала собрать подтверждённые отчёты.');
  }
  if (units.filter((u) => u.content_type === 'CORE').length > 2) {
    changes.push('Сократить до 1–2 Core-роликов.');
  }
  if (!units.some((u) => u.content_type === 'COMMERCIAL')) {
    changes.push('Добавить как минимум micro CTA — waitlist доступен с первого дня.');
  }
  if (units.filter((u) => u.estimated_effort === 'L').length > 2) {
    changes.push('Снизить долю дорогих supporting-единиц.');
  }
  const feedbackHeavy = units.filter((u) => u.user_feedback.length > 0).length;
  if (feedbackHeavy >= 2) {
    changes.push(`Учесть правки команды по ${feedbackHeavy} карточкам при планировании.`);
  }
  return changes.length ? changes.map((c) => `- ${c}`).join('\n') : '- Существенных изменений не требуется.';
}

/** Markdown rendering used for the GitHub snapshot (weeks/<id>/review.md). */
export function renderReviewMarkdown(review: WeeklyReview): string {
  const lines = [`# Weekly review — ${review.week_id}`, ''];
  for (const u of review.units) {
    lines.push(
      `## ${u.content_unit_id} — ${u.title}`,
      `**WHAT WE WANTED TO TEST:** ${u.what_we_wanted_to_test}`,
      `**WHAT HAPPENED:** ${u.what_happened}`,
      `**RESULT:** ${u.result}`,
      u.what_to_repeat ? `**WHAT TO REPEAT:** ${u.what_to_repeat}` : '',
      u.what_to_change ? `**WHAT TO CHANGE:** ${u.what_to_change}` : '',
      '',
    );
  }
  lines.push(
    '## WEEKLY SUMMARY',
    `**CONTENT:** ${review.content_summary}`,
    `**PRODUCTION:** ${review.production_summary}`,
    `**FUNNEL:** ${review.funnel_summary}`,
    `**BACKLOG:** ${review.backlog_summary}`,
    `**USER FEEDBACK:** ${review.user_feedback_summary}`,
    '',
    '## NEXT WEEK CHANGES',
    review.next_week_changes,
    '',
    `_generated_by: ${review.generated_by} · ${review.created_at}_`,
  );
  return lines.filter((l) => l !== '').join('\n');
}
