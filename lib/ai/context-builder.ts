import type { Store } from '@/lib/store';
import type {
  AnalyticsReport,
  BacklogItem,
  ContentUnit,
  ContextDoc,
  CoreVideo,
  Learning,
  StrategyState,
  WeeklyReview,
} from '@/lib/domain/schema';
import { rankLearnings } from '@/lib/services/learnings';
import { previousWeekId, weekDates, weekRangeLabel } from '@/lib/domain/week';
import type { LearningCategory } from '@/lib/domain/enums';
import { EFFORT_LABEL, PLATFORM_LABEL } from '@/lib/domain/enums';

export type Scope =
  | { kind: 'workspace' }
  | { kind: 'week'; weekId: string }
  | { kind: 'content_unit'; unitId: string }
  | { kind: 'core_video'; coreVideoId: string }
  | { kind: 'report'; unitId: string };

export type ContextBundle = {
  scope: Scope;
  base: {
    master: string;
    funnel: string;
    production: string;
    performance: string;
    strategyState: StrategyState;
  };
  task: {
    weekId: string | null;
    weekLabel: string | null;
    units: ContentUnit[];
    unit: ContentUnit | null;
    coreVideo: CoreVideo | null;
    upcomingCoreVideos: CoreVideo[];
    backlog: BacklogItem[];
  };
  memory: {
    learnings: Learning[];
    reviews: WeeklyReview[];
    feedback: string[];
    reports: AnalyticsReport[];
    summaries: string[];
  };
  meta: { charBudget: number; charsUsed: number; truncated: string[] };
};

/**
 * Per-scope character budgets. Nothing here depends on chat history: a bundle
 * built from an empty conversation is as good as one built after 50 messages.
 */
const BUDGETS: Record<Scope['kind'], number> = {
  workspace: 26_000,
  week: 30_000,
  content_unit: 14_000,
  core_video: 16_000,
  report: 10_000,
};

/** Which learning categories matter for which scope. */
const SCOPE_CATEGORIES: Record<Scope['kind'], LearningCategory[]> = {
  workspace: ['content', 'funnel', 'operations', 'audience', 'platform', 'production'],
  week: ['content', 'production', 'funnel', 'operations'],
  content_unit: ['content', 'production'],
  core_video: ['production', 'content'],
  report: ['platform', 'audience', 'content'],
};

/**
 * Splits a markdown doc into `##` sections so we can send only what the task
 * needs instead of the whole strategic library.
 */
export function sections(markdown: string): Array<{ heading: string; body: string }> {
  const lines = markdown.split('\n');
  const out: Array<{ heading: string; body: string }> = [];
  let heading = '(preamble)';
  let buf: string[] = [];
  for (const line of lines) {
    if (/^##\s+/.test(line)) {
      if (buf.length) out.push({ heading, body: buf.join('\n').trim() });
      heading = line.replace(/^##\s+/, '').trim();
      buf = [];
    } else {
      buf.push(line);
    }
  }
  if (buf.length) out.push({ heading, body: buf.join('\n').trim() });
  return out.filter((s) => s.body.length > 0);
}

/**
 * Keeps whole sections up to a budget, preferring those whose heading matches
 * the scope's keywords. Truncating on section boundaries keeps docs readable.
 */
export function selectSections(markdown: string, budget: number, prefer: RegExp[]): string {
  const all = sections(markdown);
  if (markdown.length <= budget) return markdown;

  const scored = all.map((s, i) => ({
    ...s,
    i,
    score: prefer.some((re) => re.test(s.heading)) ? 1 : 0,
  }));
  scored.sort((a, b) => b.score - a.score || a.i - b.i);

  const kept: typeof scored = [];
  let used = 0;
  for (const s of scored) {
    const cost = s.heading.length + s.body.length + 6;
    if (used + cost > budget) continue;
    kept.push(s);
    used += cost;
  }
  kept.sort((a, b) => a.i - b.i);
  const omitted = all.length - kept.length;
  const body = kept.map((s) => `## ${s.heading}\n${s.body}`).join('\n\n');
  return omitted > 0 ? `${body}\n\n_(${omitted} разделов опущено для этого запроса.)_` : body;
}

const PREFER: Record<Scope['kind'], RegExp[]> = {
  workspace: [/.*/],
  week: [/CONTENT|SIGNAL|OPERATING|SUPPORTING|RULES|mix|PLATFORM|HYPOTHES/i],
  content_unit: [/CONTENT DNA|RULES|SUPPORTING|Лестница|mix|Роли площадок/i],
  core_video: [/Стадии|источник|PRODUCTION|CONTENT DNA|почти бесплатно/i],
  report: [/PERFORMANCE|BASELINE|Аналитика|SIGNAL|RETENTION/i],
};

async function docBody(store: Store, slug: ContextDoc['slug']): Promise<string> {
  const doc = await store.getContextDoc(slug);
  return doc?.body ?? `(${slug} не импортирован — положите файл в seed/ и запустите setup.)`;
}

/**
 * Assembles everything an AI call needs, from durable storage only.
 * Called before EVERY AI request — see lib/ai/agent.ts.
 */
export async function buildContextBundle(store: Store, scope: Scope): Promise<ContextBundle> {
  const budget = BUDGETS[scope.kind];
  const truncated: string[] = [];

  const [masterRaw, funnelRaw, productionRaw, performanceRaw, strategyState] = await Promise.all([
    docBody(store, 'MASTER_CONTEXT'),
    docBody(store, 'FUNNEL_PLAYBOOK'),
    docBody(store, 'PRODUCTION_PIPELINE'),
    docBody(store, 'PERFORMANCE_INSIGHTS'),
    store.getStrategyState(),
  ]);

  // Base docs get roughly half the budget, split by how much each scope needs.
  const share = scope.kind === 'content_unit' ? 0.45 : 0.55;
  const baseBudget = Math.floor(budget * share);
  const prefer = PREFER[scope.kind];

  const master = selectSections(masterRaw, Math.floor(baseBudget * 0.34), prefer);
  const funnel = selectSections(funnelRaw, Math.floor(baseBudget * 0.28), prefer);
  const production = selectSections(productionRaw, Math.floor(baseBudget * 0.24), prefer);
  // PERFORMANCE_INSIGHTS is the largest and least often needed in full.
  const performance =
    scope.kind === 'week' || scope.kind === 'workspace' || scope.kind === 'report'
      ? selectSections(performanceRaw, Math.floor(baseBudget * 0.3), prefer)
      : '';

  for (const [name, before, after] of [
    ['MASTER_CONTEXT', masterRaw, master],
    ['FUNNEL_PLAYBOOK', funnelRaw, funnel],
    ['PRODUCTION_PIPELINE', productionRaw, production],
  ] as const) {
    if (after.length < before.length) truncated.push(name);
  }

  /* ---- task slice ---- */

  let weekId: string | null = null;
  let unit: ContentUnit | null = null;
  let coreVideo: CoreVideo | null = null;

  if (scope.kind === 'week') weekId = scope.weekId;
  if (scope.kind === 'content_unit' || scope.kind === 'report') {
    unit = await store.getUnit(scope.unitId);
    weekId = unit?.week_id ?? null;
    if (unit?.related_core_video_id) {
      coreVideo = await store.getCoreVideo(unit.related_core_video_id);
    }
  }
  if (scope.kind === 'core_video') {
    coreVideo = await store.getCoreVideo(scope.coreVideoId);
  }

  const units = weekId ? await store.listUnits({ weekId }) : [];

  const allCoreVideos = await store.listCoreVideos();
  const upcomingCoreVideos = allCoreVideos
    .filter((v) => v.production_stage !== 'published')
    .sort((a, b) => (a.planned_publish_date ?? '9999').localeCompare(b.planned_publish_date ?? '9999'))
    .slice(0, 5);

  const backlogAll = await store.listBacklog();
  const backlog =
    scope.kind === 'content_unit'
      ? []
      : backlogAll
          .filter((b) => !['PRODUCED', 'REJECTED'].includes(b.status))
          .slice(0, 20);

  /* ---- memory slice ---- */

  const allLearnings = await store.listLearnings();
  const learnings = rankLearnings(allLearnings, {
    categories: SCOPE_CATEGORIES[scope.kind],
    limit: scope.kind === 'content_unit' ? 6 : 12,
  });

  const allReviews = await store.listReviews();
  const reviews = allReviews.slice(-(scope.kind === 'content_unit' ? 1 : 3));

  // Feedback the team has already given, so the AI never repeats a rejected idea.
  const feedbackSource = unit ? [unit] : units.length ? units : await store.listUnits();
  const feedback = feedbackSource
    .flatMap((u) => u.user_feedback.map((f) => `${u.id}: ${f}`))
    .slice(-15);

  const reports = unit
    ? await store.listReports({ unitId: unit.id })
    : (await store.listReports()).filter((r) => r.confirmed).slice(-25);

  const summaries = (await store.listSummaries())
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 3)
    .map((s) => `### ${s.key}\n${s.body}`);

  const bundle: ContextBundle = {
    scope,
    base: { master, funnel, production, performance, strategyState },
    task: {
      weekId,
      weekLabel: weekId ? weekRangeLabel(weekId) : null,
      units,
      unit,
      coreVideo,
      upcomingCoreVideos,
      backlog,
    },
    memory: { learnings, reviews, feedback, reports, summaries },
    meta: { charBudget: budget, charsUsed: 0, truncated },
  };

  bundle.meta.charsUsed = renderContextBundle(bundle).length;
  return bundle;
}

/* ------------------------------------------------------------------ *
 * Rendering
 * ------------------------------------------------------------------ */

function renderUnit(u: ContentUnit, detailed: boolean): string {
  const head = [
    `- ${u.id} · ${u.date} · ${u.content_type} · ${u.title}`,
    `  slot=${u.slot_type} effort=${u.estimated_effort} (${EFFORT_LABEL[u.estimated_effort]}) status=${u.status}`,
    u.objective ? `  objective: ${u.objective}` : '',
    u.expected_signal ? `  expected signal: ${u.expected_signal}` : '',
    u.related_core_video_id ? `  core video: ${u.related_core_video_id}` : '',
  ].filter(Boolean);

  const platforms = u.platforms.map(
    (p) =>
      `  · ${PLATFORM_LABEL[p.platform]} / ${p.surface}${p.format ? ` (${p.format})` : ''}` +
      `${p.publish_status === 'published' ? ` [published ${p.publish_url}]` : ''}` +
      (detailed
        ? `\n    hook: ${p.hook || '—'}\n    copy: ${p.ready_to_use_copy || '—'}\n    visual: ${p.visual_instruction || '—'}\n    cta: ${p.cta || '—'}`
        : ''),
  );

  const extra = detailed
    ? [
        u.hypothesis ? `  hypothesis: ${u.hypothesis}` : '',
        u.notes ? `  notes: ${u.notes}` : '',
        u.user_feedback.length ? `  user feedback so far: ${u.user_feedback.join(' | ')}` : '',
        u.assets.length ? `  assets: ${u.assets.map((a) => a.label).join(', ')}` : '',
      ].filter(Boolean)
    : [];

  return [...head, ...platforms, ...extra].join('\n');
}

/** Renders the bundle as the system-prompt context block. */
export function renderContextBundle(b: ContextBundle): string {
  const parts: string[] = [];

  parts.push(
    '# BASE CONTEXT (постоянный, не переписывать без approved strategy change)',
    '## MASTER_CONTEXT',
    b.base.master,
    '## FUNNEL_PLAYBOOK',
    b.base.funnel,
    '## PRODUCTION_PIPELINE',
    b.base.production,
  );
  if (b.base.performance) {
    parts.push('## PERFORMANCE_INSIGHTS', b.base.performance);
  }
  parts.push('## STRATEGY_STATE (операционное, меняется еженедельно)', JSON.stringify(b.base.strategyState, null, 2));

  parts.push('\n# TASK CONTEXT');
  if (b.task.weekId) {
    parts.push(`Week: ${b.task.weekId} (${b.task.weekLabel}) — дни: ${weekDates(b.task.weekId).join(', ')}`);
  }
  if (b.task.unit) {
    parts.push('## SELECTED CONTENT UNIT (менять можно ТОЛЬКО его)', renderUnit(b.task.unit, true));
  } else if (b.task.units.length) {
    parts.push(
      '## UNITS IN THIS WEEK',
      b.task.units.map((u) => renderUnit(u, false)).join('\n'),
    );
  } else if (b.task.weekId) {
    parts.push('## UNITS IN THIS WEEK\n(неделя пустая)');
  }

  if (b.task.coreVideo) {
    const v = b.task.coreVideo;
    parts.push(
      '## RELATED CORE VIDEO',
      `${v.id} · ${v.working_title} · stage=${v.production_stage} · planned=${v.planned_publish_date ?? '—'}`,
      v.topic ? `topic: ${v.topic}` : '',
      v.storyboard_text ? `storyboard:\n${v.storyboard_text.slice(0, 2500)}` : '',
      v.available_assets.length
        ? `available assets: ${v.available_assets.map((a) => a.label).join(', ')}`
        : '',
      v.production_notes ? `production notes: ${v.production_notes}` : '',
    );
  }

  if (b.task.upcomingCoreVideos.length) {
    parts.push(
      '## UPCOMING CORE VIDEOS',
      b.task.upcomingCoreVideos
        .map(
          (v) =>
            `- ${v.id} · ${v.working_title} · stage=${v.production_stage} · planned=${v.planned_publish_date ?? '—'}` +
            (v.available_assets.length
              ? `\n  assets ready: ${v.available_assets.map((a) => a.label).join(', ')}`
              : ''),
        )
        .join('\n'),
    );
  }

  if (b.task.backlog.length) {
    parts.push(
      '## BACKLOG (idea pool)',
      b.task.backlog
        .map((i) => `- ${i.id} [${i.status}] ${i.title}${i.suggested_test ? ` — test: ${i.suggested_test}` : ''}`)
        .join('\n'),
    );
  }

  parts.push('\n# MEMORY');
  parts.push(
    '## LEARNINGS (evidence-based, отсортированы по релевантности)',
    b.memory.learnings.length
      ? b.memory.learnings
          .map(
            (l) =>
              `- [${l.confidence}] ${l.observation}\n  evidence: ${l.evidence.join('; ')}\n  action: ${l.action || '—'}`,
          )
          .join('\n')
      : '(пока нет)',
  );

  if (b.memory.reviews.length) {
    parts.push(
      '## RECENT WEEKLY REVIEWS',
      b.memory.reviews
        .map(
          (r) =>
            `### ${r.week_id}\nCONTENT: ${r.content_summary}\nPRODUCTION: ${r.production_summary}\nFUNNEL: ${r.funnel_summary}\nNEXT WEEK: ${r.next_week_changes}`,
        )
        .join('\n\n'),
    );
  }

  if (b.memory.feedback.length) {
    parts.push('## USER / TEAM FEEDBACK (не предлагать то, что уже отклонили)', b.memory.feedback.map((f) => `- ${f}`).join('\n'));
  }

  const confirmed = b.memory.reports.filter((r) => r.confirmed);
  if (confirmed.length) {
    parts.push(
      '## CONFIRMED ANALYTICS (только подтверждённые пользователем цифры)',
      confirmed
        .map((r) => {
          const m = r.confirmed_metrics
            .map((x) => `${x.key}=${x.value === null ? 'NA' : x.value}`)
            .join(' ');
          return `- ${r.content_unit_id} ${r.platform} ${r.window}: ${m || '(нет считанных метрик)'}`;
        })
        .join('\n'),
    );
  }

  if (b.memory.summaries.length) {
    parts.push('## COMPACTED SUMMARIES', b.memory.summaries.join('\n\n'));
  }

  if (b.meta.truncated.length) {
    parts.push(
      `\n_(Контекст собран из durable storage. Сокращены по бюджету: ${b.meta.truncated.join(', ')}. Полные документы доступны в приложении на странице CONTEXT.)_`,
    );
  }

  return parts.filter(Boolean).join('\n\n');
}

/** Convenience for "what does the previous week look like" lookups. */
export async function previousWeekSnapshot(store: Store, weekId: string) {
  const prev = previousWeekId(weekId);
  const [units, review] = await Promise.all([
    store.listUnits({ weekId: prev }),
    store.getReview(prev),
  ]);
  return { weekId: prev, units, review };
}
