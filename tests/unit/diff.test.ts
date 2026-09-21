import { describe, expect, it } from 'vitest';
import { diffUnits, summarizeDiff } from '@/lib/services/diff';
import { contentUnitSchema, type ContentUnit } from '@/lib/domain/schema';

const base = (): ContentUnit =>
  contentUnitSchema.parse({
    id: 'CU-1',
    workspace_id: 'ws',
    week_id: '2026-W39',
    date: '2026-09-21',
    title: 'Заголовок',
    content_type: 'AUDIENCE',
    estimated_effort: 'M',
    platforms: [
      {
        id: 'pv-1',
        content_unit_id: 'CU-1',
        platform: 'instagram',
        surface: 'carousel',
        format: 'carousel_3',
        ready_to_use_copy: 'Длинный текст',
        hook: 'Хук',
      },
      {
        id: 'pv-2',
        content_unit_id: 'CU-1',
        platform: 'tiktok',
        surface: 'photo_mode',
        format: '',
        ready_to_use_copy: 'TT',
      },
    ],
    created_at: '2026-09-21T00:00:00.000Z',
    updated_at: '2026-09-21T00:00:00.000Z',
  });

describe('unit diff', () => {
  it('reports nothing when nothing changed', () => {
    expect(diffUnits(base(), base())).toEqual([]);
    expect(summarizeDiff([])).toBe('Ничего не изменилось.');
  });

  it('reports scalar changes with a readable label', () => {
    const after = { ...base(), title: 'Новый', estimated_effort: 'XS' as const };
    const diffs = diffUnits(base(), after);
    expect(diffs.map((d) => d.label)).toEqual(expect.arrayContaining(['Title', 'Effort']));
    expect(summarizeDiff(diffs)).toMatch(/Title: Заголовок → Новый/);
  });

  it('reports a surface change as a change, not a delete plus an add', () => {
    const before = base();
    const after = {
      ...before,
      platforms: [{ ...before.platforms[0], surface: 'story', format: 'story_single' }, before.platforms[1]],
    };
    const diffs = diffUnits(before, after);
    expect(diffs.some((d) => d.label.includes('Removed'))).toBe(false);
    expect(diffs.some((d) => d.label.includes('Added'))).toBe(false);
    expect(diffs.some((d) => /surface/.test(d.label))).toBe(true);
  });

  it('still reports a genuinely removed platform', () => {
    const before = base();
    const after = { ...before, platforms: [before.platforms[0]] };
    expect(diffUnits(before, after).some((d) => d.label.startsWith('Removed'))).toBe(true);
  });

  it('truncates long values so the summary stays readable', () => {
    const before = base();
    const after = {
      ...before,
      platforms: [
        { ...before.platforms[0], ready_to_use_copy: 'x'.repeat(500) },
        before.platforms[1],
      ],
    };
    const [diff] = diffUnits(before, after).filter((d) => /copy/.test(d.label));
    expect(diff.after.length).toBeLessThan(120);
    expect(diff.after.endsWith('…')).toBe(true);
  });
});
