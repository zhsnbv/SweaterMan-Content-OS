import { describe, expect, it } from 'vitest';
import {
  currentWeekId,
  localDateString,
  nextWeekId,
  previousWeekId,
  weekDates,
  weekIdFromDate,
  weekStart,
} from '@/lib/domain/week';

describe('ISO week helpers', () => {
  it('derives the ISO week id from a date', () => {
    expect(weekIdFromDate('2026-09-21')).toBe('2026-W39');
    expect(weekIdFromDate('2026-09-27')).toBe('2026-W39');
    expect(weekIdFromDate('2026-09-28')).toBe('2026-W40');
  });

  it('starts weeks on Monday', () => {
    expect(weekStart('2026-W39').getUTCDay()).toBe(1);
    expect(weekDates('2026-W39')).toHaveLength(7);
    expect(weekDates('2026-W39')[0]).toBe('2026-09-21');
    expect(weekDates('2026-W39')[6]).toBe('2026-09-27');
  });

  it('walks forwards and backwards across a year boundary', () => {
    expect(nextWeekId('2026-W39')).toBe('2026-W40');
    expect(previousWeekId('2026-W40')).toBe('2026-W39');
    expect(nextWeekId(previousWeekId('2026-W01'))).toBe('2026-W01');
  });

  it("puts the viewer's today inside the current week", () => {
    expect(weekDates(currentWeekId())).toContain(localDateString(new Date()));
  });
});
