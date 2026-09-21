import { describe, expect, it } from 'vitest';
import { weekDates, weekIdFromDate, weekStart, weekRangeLabel } from '@/lib/domain/week';

/**
 * Regression guard. The first implementation mixed a UTC-constructed date with
 * local-time arithmetic, which shifted the whole week by a day for anyone east
 * of Greenwich. A week id must be identical for every teammate.
 */
describe('week ids are timezone-independent', () => {
  it('anchors weeks to Monday in UTC', () => {
    for (const id of ['2026-W01', '2026-W39', '2026-W40', '2027-W01']) {
      expect(weekStart(id).getUTCDay()).toBe(1);
      expect(weekStart(id).getUTCHours()).toBe(0);
    }
  });

  it('gives every day of the week a distinct, ordered date', () => {
    const dates = weekDates('2026-W40');
    expect(dates).toEqual([
      '2026-09-28',
      '2026-09-29',
      '2026-09-30',
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
      '2026-10-04',
    ]);
    expect(new Set(dates).size).toBe(7);
  });

  it('maps every date in a week back to that week', () => {
    for (const d of weekDates('2026-W39')) {
      expect(weekIdFromDate(d)).toBe('2026-W39');
    }
  });

  it('handles the ISO year boundary, where week 1 can start in December', () => {
    expect(weekIdFromDate('2025-12-29')).toBe('2026-W01');
    expect(weekIdFromDate('2027-01-03')).toBe('2026-W53');
  });

  it('labels a range that spans two months', () => {
    expect(weekRangeLabel('2026-W40')).toContain('сен');
    expect(weekRangeLabel('2026-W40')).toContain('окт');
  });
});
