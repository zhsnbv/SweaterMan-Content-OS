import {
  ANALYTICS_WINDOW_HOURS,
  REQUIRED_ANALYTICS_WINDOWS,
  type AnalyticsWindow,
} from '@/lib/domain/enums';
import type { AnalyticsReport, AnalyticsStatus, ContentUnit } from '@/lib/domain/schema';

/**
 * Derives the due/complete flags from the publish timestamps and the reports
 * that exist. Always recomputed — never hand-maintained — so the card can't lie.
 */
export function recomputeAnalyticsStatus(
  unit: ContentUnit,
  reports: AnalyticsReport[],
  now: Date = new Date(),
): ContentUnit {
  const published = unit.platforms
    .filter((p) => p.publish_status === 'published' && p.published_at)
    .map((p) => new Date(p.published_at as string).getTime())
    .filter((t) => Number.isFinite(t));

  const status: AnalyticsStatus = {
    '24h_due': false,
    '24h_complete': false,
    '72h_due': false,
    '72h_complete': false,
    '7d_due': false,
    '7d_complete': false,
    '30d_due': false,
    '30d_complete': false,
  };

  if (!published.length) {
    return { ...unit, analytics_status: status };
  }

  // The clock starts at the first publication of the unit on any platform.
  const first = Math.min(...published);

  for (const w of ['24h', '72h', '7d', '30d'] as AnalyticsWindow[]) {
    const dueAt = first + ANALYTICS_WINDOW_HOURS[w] * 3600 * 1000;
    const confirmed = reports.filter((r) => r.window === w && r.confirmed);
    // A window is complete when every published platform has a confirmed report.
    const publishedPlatforms = new Set(
      unit.platforms.filter((p) => p.publish_status === 'published').map((p) => p.platform),
    );
    const covered = new Set(confirmed.map((r) => r.platform));
    const complete =
      publishedPlatforms.size > 0 &&
      [...publishedPlatforms].every((p) => covered.has(p as never));

    status[`${w}_complete` as keyof AnalyticsStatus] = complete;
    status[`${w}_due` as keyof AnalyticsStatus] = now.getTime() >= dueAt && !complete;
  }

  return { ...unit, analytics_status: status };
}

export function dueWindows(unit: ContentUnit): AnalyticsWindow[] {
  return REQUIRED_ANALYTICS_WINDOWS.filter(
    (w) => unit.analytics_status[`${w}_due` as keyof AnalyticsStatus],
  );
}

export function hasAnyDue(unit: ContentUnit): boolean {
  return dueWindows(unit).length > 0;
}
