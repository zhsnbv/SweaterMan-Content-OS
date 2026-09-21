'use client';

import { AlertCircle, CalendarClock } from 'lucide-react';
import { isToday, parseISO, isBefore, startOfToday } from 'date-fns';
import type { ContentUnit } from '@/lib/domain/schema';
import { dueWindows } from '@/lib/services/analytics-status';

/**
 * V1 notifications: no service, no queue — just what the dashboard can derive.
 * Reports that are due, what ships today, and what is already overdue.
 */
export function DueBanner({
  units,
  onOpen,
}: {
  units: ContentUnit[];
  onOpen: (id: string) => void;
}) {
  const due = units.flatMap((u) => dueWindows(u).map((w) => ({ unit: u, window: w })));
  const today = units.filter((u) => isToday(parseISO(u.date)) && u.status !== 'published');
  const overdue = units.filter(
    (u) =>
      isBefore(parseISO(u.date), startOfToday()) &&
      !['published', 'skipped'].includes(u.status),
  );

  if (!due.length && !today.length && !overdue.length) return null;

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b border-[var(--color-line)] bg-[var(--color-surface-2)] px-4 py-1.5 text-[11px]">
      {due.length ? (
        <span className="flex items-center gap-1.5 text-[#b54708]">
          <AlertCircle className="h-3 w-3" />
          <span className="font-medium">{due.length} report due:</span>
          {due.slice(0, 3).map(({ unit, window }) => (
            <button
              key={`${unit.id}-${window}`}
              onClick={() => onOpen(unit.id)}
              className="underline decoration-dotted underline-offset-2 hover:decoration-solid"
            >
              {unit.id} {window}
            </button>
          ))}
          {due.length > 3 ? <span>+{due.length - 3}</span> : null}
        </span>
      ) : null}

      {today.length ? (
        <span className="flex items-center gap-1.5 text-[var(--color-ink-2)]">
          <CalendarClock className="h-3 w-3" />
          <span className="font-medium">Сегодня публикуем:</span>
          {today.map((u) => (
            <button
              key={u.id}
              onClick={() => onOpen(u.id)}
              className="underline decoration-dotted underline-offset-2 hover:decoration-solid"
            >
              {u.title.slice(0, 40)}
            </button>
          ))}
        </span>
      ) : null}

      {overdue.length ? (
        <span className="text-[var(--color-ink-3)]">
          Просрочено: {overdue.length}
        </span>
      ) : null}
    </div>
  );
}
