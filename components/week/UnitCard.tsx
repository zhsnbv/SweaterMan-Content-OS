'use client';

import * as React from 'react';
import { useDraggable } from '@dnd-kit/core';
import { AlertCircle, CheckCircle2, Clock, Link2 } from 'lucide-react';
import type { ContentUnit } from '@/lib/domain/schema';
import { EFFORT_LABEL } from '@/lib/domain/enums';
import { cn } from '@/lib/utils';
import { PlatformIcon, StatusText, TypeIcon } from '@/components/ui/tokens';
import { dueWindows } from '@/lib/services/analytics-status';

/**
 * The calendar card shows only what answers: what, when, where, why,
 * how much work, is it done. Everything else lives in the drawer.
 */
export function UnitCard({
  unit,
  onOpen,
  active,
}: {
  unit: ContentUnit;
  onOpen: () => void;
  active?: boolean;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: unit.id });
  const due = dueWindows(unit);
  const published = unit.platforms.some((p) => p.publish_status === 'published');
  const complete = unit.analytics_status['24h_complete'];

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={onOpen}
      className={cn(
        'group cursor-pointer rounded-[var(--radius-card)] border bg-[var(--color-surface)] p-2 text-left transition-all',
        'hover:border-[var(--color-line-strong)] hover:shadow-[0_1px_3px_rgba(23,23,27,0.06)]',
        active ? 'border-[var(--color-accent)] ring-1 ring-[var(--color-accent)]/20' : 'border-[var(--color-line)]',
        isDragging && 'opacity-40',
        unit.status === 'skipped' && 'opacity-55',
      )}
    >
      <div className="mb-1 flex items-start gap-1.5">
        <TypeIcon type={unit.content_type} className="mt-[2px] shrink-0" />
        <p className="min-w-0 flex-1 text-[12px] font-medium leading-[1.35] text-[var(--color-ink)]">
          {unit.title}
        </p>
      </div>

      {unit.objective ? (
        <p className="mb-1.5 line-clamp-2 text-[11px] leading-snug text-[var(--color-ink-3)]">
          {unit.objective}
        </p>
      ) : null}

      <div className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
        {unit.platforms.slice(0, 4).map((p) => (
          <span key={p.id} className="inline-flex items-center gap-1">
            <PlatformIcon platform={p.platform} />
            <span className="text-[10px] lowercase text-[var(--color-ink-3)]">
              {p.surface.replace(/_/g, ' ')}
            </span>
          </span>
        ))}
        {unit.platforms.length > 4 ? (
          <span className="text-[10px] text-[var(--color-ink-3)]">+{unit.platforms.length - 4}</span>
        ) : null}
        {unit.platforms.length === 0 ? (
          <span className="text-[10px] text-[var(--color-ink-3)]">нет площадок</span>
        ) : null}
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-[var(--color-line)] pt-1.5">
        <div className="flex items-center gap-1.5">
          <span
            className="text-[10px] font-medium text-[var(--color-ink-3)] numeric"
            title={`Оценка работы: ${EFFORT_LABEL[unit.estimated_effort]}`}
          >
            {unit.estimated_effort}
          </span>
          {unit.scheduled_time ? (
            <span className="flex items-center gap-0.5 text-[10px] text-[var(--color-ink-3)] numeric">
              <Clock className="h-2.5 w-2.5" />
              {unit.scheduled_time}
            </span>
          ) : null}
          <StatusText status={unit.status} />
        </div>

        <div className="flex items-center gap-1">
          {published ? (
            <Link2 className="h-3 w-3 text-[#087f55]" aria-label="published" />
          ) : null}
          {due.length ? (
            <span
              className="flex items-center gap-0.5 rounded bg-[#fef6ee] px-1 text-[9px] font-semibold text-[#b54708]"
              title={`Отчёт просрочен: ${due.join(', ')}`}
            >
              <AlertCircle className="h-2.5 w-2.5" />
              {due[0]}
            </span>
          ) : complete ? (
            <CheckCircle2 className="h-3 w-3 text-[#087f55]" aria-label="24h report added" />
          ) : null}
        </div>
      </div>
    </div>
  );
}
