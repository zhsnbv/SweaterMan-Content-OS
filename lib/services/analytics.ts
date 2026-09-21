import type { Store } from '@/lib/store';
import { uid } from '@/lib/domain/ids';
import {
  analyticsReportSchema,
  type AnalyticsReport,
  type ContentUnit,
  type MetricValue,
} from '@/lib/domain/schema';
import { METRIC_KEYS, type AnalyticsWindow, type Platform } from '@/lib/domain/enums';
import { recomputeAnalyticsStatus } from './analytics-status';
import { updateUnit } from './units';

/** Marks one platform variant as published and starts the reporting clock. */
export async function markPublished(
  store: Store,
  unitId: string,
  platform: Platform,
  publishUrl: string,
  opts: { surface?: string; publishedAt?: string; actor?: string } = {},
): Promise<{ unit: ContentUnit; publishedAt: string }> {
  const unit = await store.getUnit(unitId);
  if (!unit) throw new Error(`Content unit not found: ${unitId}`);
  const publishedAt = opts.publishedAt ?? new Date().toISOString();

  const platforms = unit.platforms.map((v) =>
    v.platform === platform && (!opts.surface || v.surface === opts.surface)
      ? {
          ...v,
          publish_status: 'published' as const,
          publish_url: publishUrl,
          published_at: publishedAt,
        }
      : v,
  );

  const anyPublished = platforms.some((p) => p.publish_status === 'published');
  const result = await updateUnit(
    store,
    unitId,
    { platforms, status: anyPublished ? 'published' : unit.status },
    { actor: opts.actor ?? 'user', reason: `published on ${platform}` },
  );

  const reports = await store.listReports({ unitId });
  const withStatus = recomputeAnalyticsStatus(result.unit, reports);
  await store.saveUnit(withStatus);
  return { unit: withStatus, publishedAt };
}

/**
 * Keeps only metric keys the system knows. Anything the extractor invented is
 * dropped; anything it could not read stays as `null` (NA), never as a guess.
 */
export function sanitizeMetrics(input: unknown): MetricValue[] {
  if (!Array.isArray(input)) return [];
  const allowed = new Set<string>(METRIC_KEYS);
  const seen = new Set<string>();
  const out: MetricValue[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue;
    const key = String((raw as any).key ?? '');
    if (!allowed.has(key) || seen.has(key)) continue;
    seen.add(key);
    const v = (raw as any).value;
    const num = v === null || v === undefined || v === '' ? null : Number(v);
    out.push({
      key: key as MetricValue['key'],
      value: num !== null && Number.isFinite(num) ? num : null,
      raw: String((raw as any).raw ?? ''),
    });
  }
  return out;
}

/** Creates (or replaces) an unconfirmed report holding the extracted numbers. */
export async function createReport(
  store: Store,
  input: {
    unitId: string;
    platform: Platform;
    window: AnalyticsWindow;
    publishUrl?: string;
    screenshots?: string[];
    extracted?: MetricValue[];
    userNotes?: string;
    aiObservation?: string;
  },
): Promise<AnalyticsReport> {
  const existing = (await store.listReports({ unitId: input.unitId })).find(
    (r) => r.platform === input.platform && r.window === input.window,
  );
  const report = analyticsReportSchema.parse({
    id: existing?.id ?? uid('rep'),
    content_unit_id: input.unitId,
    platform: input.platform,
    window: input.window,
    publish_url: input.publishUrl ?? existing?.publish_url ?? '',
    screenshots: [...(existing?.screenshots ?? []), ...(input.screenshots ?? [])],
    extracted_metrics: sanitizeMetrics(input.extracted ?? []),
    confirmed_metrics: existing?.confirmed_metrics ?? [],
    confirmed: false,
    user_notes: input.userNotes ?? existing?.user_notes ?? '',
    ai_observation: input.aiObservation ?? existing?.ai_observation ?? '',
    created_at: existing?.created_at ?? new Date().toISOString(),
    confirmed_at: null,
  });
  await store.saveReport(report);
  return report;
}

/**
 * Only confirmed numbers ever reach the learning engine. The user may correct
 * anything before confirming.
 */
export async function confirmReport(
  store: Store,
  reportId: string,
  confirmed: MetricValue[],
  userNotes?: string,
): Promise<{ report: AnalyticsReport; unit: ContentUnit | null }> {
  const report = await store.getReport(reportId);
  if (!report) throw new Error(`Report not found: ${reportId}`);
  const next: AnalyticsReport = {
    ...report,
    confirmed_metrics: sanitizeMetrics(confirmed),
    confirmed: true,
    user_notes: userNotes ?? report.user_notes,
    confirmed_at: new Date().toISOString(),
  };
  await store.saveReport(next);

  const unit = await store.getUnit(report.content_unit_id);
  if (!unit) return { report: next, unit: null };
  const reports = await store.listReports({ unitId: unit.id });
  const withStatus = recomputeAnalyticsStatus(unit, reports);
  await store.saveUnit(withStatus);
  return { report: next, unit: withStatus };
}

export function metricValue(report: AnalyticsReport, key: MetricValue['key']): number | null {
  const source = report.confirmed ? report.confirmed_metrics : report.extracted_metrics;
  return source.find((m) => m.key === key)?.value ?? null;
}

/**
 * A deliberately cautious sentence. With n=1 the system says so rather than
 * generalising — the strategic docs are explicit that one post proves nothing.
 */
export function baselineObservation(
  report: AnalyticsReport,
  peers: AnalyticsReport[],
): string {
  const views = metricValue(report, 'views');
  const sameWindow = peers.filter(
    (r) => r.window === report.window && r.confirmed && r.id !== report.id,
  );
  const peerViews = sameWindow
    .map((r) => metricValue(r, 'views'))
    .filter((v): v is number => v !== null);

  if (views === null) {
    return 'Views не видны на скриншоте — NA. Сравнение не делается.';
  }
  if (peerViews.length === 0) {
    return `Первый подтверждённый ${report.window}-отчёт такого рода. Sample size = 1 — сравнивать пока не с чем, вывод не делаем.`;
  }
  const median = [...peerViews].sort((a, b) => a - b)[Math.floor(peerViews.length / 2)];
  const ratio = median ? views / median : 1;
  const direction = ratio >= 1.15 ? 'выше' : ratio <= 0.85 ? 'ниже' : 'на уровне';
  return `${views.toLocaleString('ru-RU')} views — ${direction} медианы подтверждённых ${report.window}-отчётов (${median.toLocaleString('ru-RU')}, n=${peerViews.length}). При n<3 это наблюдение, а не вывод.`;
}
