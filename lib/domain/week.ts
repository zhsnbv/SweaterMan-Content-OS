/**
 * ISO week helpers.
 *
 * All arithmetic here is done in UTC on purpose. A week id must map to the
 * same seven date strings for every teammate and for the GitHub snapshot,
 * regardless of the machine's timezone — mixing UTC construction with
 * local-time date math silently shifts a week by a day east of Greenwich.
 * Display formatting (which *should* follow the viewer) stays in the UI.
 */

const DAY_MS = 86_400_000;

const MONTHS_RU = [
  'янв', 'фев', 'мар', 'апр', 'май', 'июн',
  'июл', 'авг', 'сен', 'окт', 'ноя', 'дек',
];

function toUtcDate(value: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!m) throw new Error(`Invalid date: ${value}`);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

export function formatUtcDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * The viewer's calendar day as a YYYY-MM-DD string.
 *
 * This is the only sanctioned bridge from a `Date` to a week id. Passing a
 * `Date` straight into week maths is ambiguous — a UTC-midnight Monday is the
 * previous Sunday in Los Angeles — so `weekIdFromDate` takes strings only.
 */
export function localDateString(d: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Monday-based UTC start of the ISO week containing `d`. */
function isoWeekStart(d: Date): Date {
  // getUTCDay: Sunday = 0. Shift so Monday = 0.
  const offset = (d.getUTCDay() + 6) % 7;
  return new Date(d.getTime() - offset * DAY_MS);
}

/** ISO week id for a YYYY-MM-DD date, e.g. "2026-W39". */
export function weekIdFromDate(date: string): string {
  const d = toUtcDate(date);
  const monday = isoWeekStart(d);
  // The ISO week-numbering year is the year of that week's Thursday.
  const thursday = new Date(monday.getTime() + 3 * DAY_MS);
  const year = thursday.getUTCFullYear();
  const jan1 = new Date(Date.UTC(year, 0, 1));
  const week = Math.floor((thursday.getTime() - jan1.getTime()) / (7 * DAY_MS)) + 1;
  return `${year}-W${String(week).padStart(2, '0')}`;
}

export function parseWeekId(weekId: string): { year: number; week: number } {
  const m = /^(\d{4})-W(\d{2})$/.exec(weekId);
  if (!m) throw new Error(`Invalid week id: ${weekId}`);
  return { year: Number(m[1]), week: Number(m[2]) };
}

/** Monday (UTC) of the given ISO week. */
export function weekStart(weekId: string): Date {
  const { year, week } = parseWeekId(weekId);
  // 4 January is always in ISO week 1.
  const week1Monday = isoWeekStart(new Date(Date.UTC(year, 0, 4)));
  return new Date(week1Monday.getTime() + (week - 1) * 7 * DAY_MS);
}

export function weekEnd(weekId: string): Date {
  return new Date(weekStart(weekId).getTime() + 6 * DAY_MS);
}

export function weekDates(weekId: string): string[] {
  const start = weekStart(weekId).getTime();
  return Array.from({ length: 7 }, (_, i) => formatUtcDate(new Date(start + i * DAY_MS)));
}

export function shiftWeek(weekId: string, delta: number): string {
  // weekStart() is already UTC-midnight, so format it back to a date string
  // rather than handing a Date to weekIdFromDate (which reads local days).
  return weekIdFromDate(formatUtcDate(new Date(weekStart(weekId).getTime() + delta * 7 * DAY_MS)));
}

export function previousWeekId(weekId: string): string {
  return shiftWeek(weekId, -1);
}

export function nextWeekId(weekId: string): string {
  return shiftWeek(weekId, 1);
}

export function currentWeekId(now: Date = new Date()): string {
  return weekIdFromDate(localDateString(now));
}

export const DAY_LABELS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const;
export type DayLabel = (typeof DAY_LABELS)[number];

export function dayIndexOfDate(weekId: string, date: string): number {
  return weekDates(weekId).indexOf(date);
}

export function weekRangeLabel(weekId: string): string {
  const s = weekStart(weekId);
  const e = weekEnd(weekId);
  const sameMonth = s.getUTCMonth() === e.getUTCMonth();
  const month = (d: Date) => MONTHS_RU[d.getUTCMonth()];
  return sameMonth
    ? `${s.getUTCDate()}–${e.getUTCDate()} ${month(e)} ${e.getUTCFullYear()}`
    : `${s.getUTCDate()} ${month(s)} – ${e.getUTCDate()} ${month(e)} ${e.getUTCFullYear()}`;
}
