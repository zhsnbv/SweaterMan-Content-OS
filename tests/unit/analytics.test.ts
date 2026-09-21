import { describe, expect, it } from 'vitest';
import { baselineObservation, sanitizeMetrics } from '@/lib/services/analytics';
import { recomputeAnalyticsStatus } from '@/lib/services/analytics-status';
import { contentUnitSchema, type AnalyticsReport, type ContentUnit } from '@/lib/domain/schema';

const unit = (publishedAt: string | null): ContentUnit =>
  contentUnitSchema.parse({
    id: 'CU-2026-W39-01',
    workspace_id: 'ws',
    week_id: '2026-W39',
    date: '2026-09-21',
    title: 't',
    content_type: 'AUDIENCE',
    platforms: [
      {
        id: 'pv1',
        content_unit_id: 'CU-2026-W39-01',
        platform: 'instagram',
        surface: 'story',
        format: '',
        publish_status: publishedAt ? 'published' : 'not_published',
        published_at: publishedAt,
      },
    ],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

const report = (over: Partial<AnalyticsReport>): AnalyticsReport => ({
  id: 'r1',
  content_unit_id: 'CU-2026-W39-01',
  platform: 'instagram',
  window: '24h',
  publish_url: '',
  screenshots: [],
  extracted_metrics: [],
  confirmed_metrics: [],
  confirmed: false,
  user_notes: '',
  ai_observation: '',
  created_at: new Date().toISOString(),
  confirmed_at: null,
  ...over,
});

describe('metric sanitisation', () => {
  it('drops unknown keys and never invents a value', () => {
    const out = sanitizeMetrics([
      { key: 'views', value: 1200, raw: '1.2K' },
      { key: 'made_up_metric', value: 99 },
      { key: 'likes', value: null },
      { key: 'shares', value: 'not a number' },
    ]);
    expect(out.map((m) => m.key)).toEqual(['views', 'likes', 'shares']);
    expect(out.find((m) => m.key === 'likes')?.value).toBeNull();
    expect(out.find((m) => m.key === 'shares')?.value).toBeNull();
  });

  it('de-duplicates repeated keys', () => {
    expect(
      sanitizeMetrics([
        { key: 'views', value: 1 },
        { key: 'views', value: 2 },
      ]),
    ).toHaveLength(1);
  });
});

describe('analytics due state', () => {
  it('stays empty until something is published', () => {
    const s = recomputeAnalyticsStatus(unit(null), []).analytics_status;
    expect(s['24h_due']).toBe(false);
    expect(s['24h_complete']).toBe(false);
  });

  it('marks 24h due once the window has passed with no confirmed report', () => {
    const publishedAt = new Date(Date.now() - 30 * 3600 * 1000).toISOString();
    const s = recomputeAnalyticsStatus(unit(publishedAt), []).analytics_status;
    expect(s['24h_due']).toBe(true);
    expect(s['72h_due']).toBe(false);
  });

  it('is complete — not due — once every published platform has a confirmed report', () => {
    const publishedAt = new Date(Date.now() - 30 * 3600 * 1000).toISOString();
    const s = recomputeAnalyticsStatus(unit(publishedAt), [
      report({ confirmed: true }),
    ]).analytics_status;
    expect(s['24h_complete']).toBe(true);
    expect(s['24h_due']).toBe(false);
  });

  it('ignores unconfirmed reports', () => {
    const publishedAt = new Date(Date.now() - 30 * 3600 * 1000).toISOString();
    const s = recomputeAnalyticsStatus(unit(publishedAt), [
      report({ confirmed: false }),
    ]).analytics_status;
    expect(s['24h_complete']).toBe(false);
    expect(s['24h_due']).toBe(true);
  });
});

describe('observations stay honest about sample size', () => {
  it('refuses to compare when n=1', () => {
    const r = report({ confirmed: true, confirmed_metrics: [{ key: 'views', value: 5000, raw: '' }] });
    expect(baselineObservation(r, [])).toMatch(/Sample size = 1/);
  });

  it('says NA when views were not visible', () => {
    const r = report({ confirmed: true, confirmed_metrics: [{ key: 'views', value: null, raw: '' }] });
    expect(baselineObservation(r, [])).toMatch(/NA/);
  });
});
