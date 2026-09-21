'use client';

import * as React from 'react';
import { DndContext, PointerSensor, useDroppable, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { format, parseISO, isToday } from 'date-fns';
import type { ContentUnit } from '@/lib/domain/schema';
import { DAY_LABELS, weekDates } from '@/lib/domain/week';
import { cn } from '@/lib/utils';
import { UnitCard } from './UnitCard';

function DayColumn({
  date,
  label,
  units,
  onOpen,
  activeId,
}: {
  date: string;
  label: string;
  units: ContentUnit[];
  onOpen: (id: string) => void;
  activeId: string | null;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: date });
  const today = isToday(parseISO(date));

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div
        className={cn(
          'flex items-baseline justify-between gap-1 px-1.5 pb-1.5',
          today && 'text-[var(--color-accent)]',
        )}
      >
        <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--color-ink-3)]">
          <span className={cn(today && 'text-[var(--color-accent)]')}>{label}</span>
        </span>
        <span
          className={cn(
            'text-[10px] numeric',
            today ? 'font-semibold text-[var(--color-accent)]' : 'text-[var(--color-ink-3)]',
          )}
        >
          {format(parseISO(date), 'd MMM')}
        </span>
      </div>

      <div
        ref={setNodeRef}
        className={cn(
          'flex min-h-[120px] flex-1 flex-col gap-1.5 rounded-lg border border-transparent p-1 transition-colors',
          isOver && 'border-dashed border-[var(--color-accent)] bg-[var(--color-accent-soft)]/50',
        )}
      >
        {units.map((u) => (
          <UnitCard key={u.id} unit={u} onOpen={() => onOpen(u.id)} active={activeId === u.id} />
        ))}
        {units.length === 0 ? (
          <div className="flex flex-1 items-center justify-center rounded-md border border-dashed border-[var(--color-line)] py-4 text-[10px] text-[var(--color-ink-3)]">
            пусто
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function WeekBoard({
  weekId,
  units,
  onOpen,
  onMove,
  activeId,
}: {
  weekId: string;
  units: ContentUnit[];
  onOpen: (id: string) => void;
  onMove: (id: string, date: string) => void;
  activeId: string | null;
}) {
  const dates = weekDates(weekId);
  const sensors = useSensors(
    // A small activation distance keeps a click on the card from starting a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  const onDragEnd = (e: DragEndEvent) => {
    const id = String(e.active.id);
    const date = e.over ? String(e.over.id) : null;
    if (!date) return;
    const unit = units.find((u) => u.id === id);
    if (!unit || unit.date === date) return;
    onMove(id, date);
  };

  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <div className="flex h-full gap-1 overflow-x-auto px-3 py-3">
        {dates.map((date, i) => (
          <DayColumn
            key={date}
            date={date}
            label={DAY_LABELS[i]}
            units={units.filter((u) => u.date === date).sort((a, b) => a.position - b.position)}
            onOpen={onOpen}
            activeId={activeId}
          />
        ))}
      </div>
    </DndContext>
  );
}
