'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { ChevronLeft, ChevronRight, Sparkles, Plus, RotateCcw, Lightbulb, Filter } from 'lucide-react';
import { useAppState, api } from '@/components/data';
import { currentWeekId, nextWeekId, previousWeekId, weekRangeLabel } from '@/lib/domain/week';
import { CONTENT_TYPES, PLATFORMS, type ContentType, type Platform } from '@/lib/domain/enums';
import { Button, EmptyState, Spinner } from '@/components/ui/primitives';
import { PageHeader } from '@/components/shell/PageHeader';
import { SyncStatus } from '@/components/shell/SyncStatus';
import { WeekBoard } from './WeekBoard';
import { UnitDrawer } from '@/components/drawer/UnitDrawer';
import { CopilotDrawer } from '@/components/chat/CopilotDrawer';
import { DueBanner } from './DueBanner';
import { cn } from '@/lib/utils';
import { TypeIcon } from '@/components/ui/tokens';

export function WeekView() {
  const [weekId, setWeekId] = React.useState(currentWeekId());
  const { state, loading, refresh } = useAppState(weekId);
  const [openUnit, setOpenUnit] = React.useState<string | null>(null);
  const [copilot, setCopilot] = React.useState(false);
  const [typeFilter, setTypeFilter] = React.useState<ContentType[]>([]);
  const [platformFilter, setPlatformFilter] = React.useState<Platform[]>([]);
  const [busy, setBusy] = React.useState<string | null>(null);

  const go = (next: string) => {
    setWeekId(next);
    void refresh(next);
  };

  const units = React.useMemo(() => {
    if (!state) return [];
    return state.units.filter((u) => {
      if (typeFilter.length && !typeFilter.includes(u.content_type)) return false;
      if (platformFilter.length && !u.platforms.some((p) => platformFilter.includes(p.platform)))
        return false;
      return true;
    });
  }, [state, typeFilter, platformFilter]);

  const move = async (id: string, date: string) => {
    try {
      await api(`/api/units/${id}/move`, { method: 'POST', json: { date } });
      await refresh(weekId);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не удалось перенести');
    }
  };

  const runCommand = async (message: string, label: string) => {
    setBusy(label);
    try {
      const res = await api<{ text: string }>('/api/ai/chat', {
        method: 'POST',
        json: { message, scope: { kind: 'week', weekId } },
      });
      toast.success(label, { description: res.text.split('\n')[0]?.slice(0, 120) });
      await refresh(weekId);
      setCopilot(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не удалось');
    } finally {
      setBusy(null);
    }
  };

  const seedDemo = async () => {
    setBusy('demo');
    try {
      await api('/api/demo', { method: 'POST', json: { action: 'seed' } });
      toast.success('Demo-данные созданы');
      await refresh(weekId);
    } finally {
      setBusy(null);
    }
  };

  if (loading || !state) {
    return (
      <div className="flex h-full items-center justify-center text-[var(--color-ink-3)]">
        <Spinner />
      </div>
    );
  }

  const isCurrent = weekId === currentWeekId();

  return (
    <>
      <PageHeader
        title="Week"
        subtitle={`${weekId} · ${weekRangeLabel(weekId)}`}
        actions={
          <>
            <div className="mr-1 flex items-center rounded-md border border-[var(--color-line)]">
              <button
                onClick={() => go(previousWeekId(weekId))}
                className="px-1.5 py-1 text-[var(--color-ink-3)] hover:text-[var(--color-ink)]"
                aria-label="Previous week"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => go(currentWeekId())}
                className={cn(
                  'border-x border-[var(--color-line)] px-2 py-1 text-[11px] font-medium',
                  isCurrent ? 'text-[var(--color-ink)]' : 'text-[var(--color-ink-3)] hover:text-[var(--color-ink)]',
                )}
              >
                Today
              </button>
              <button
                onClick={() => go(nextWeekId(weekId))}
                className="px-1.5 py-1 text-[var(--color-ink-3)] hover:text-[var(--color-ink)]"
                aria-label="Next week"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>

            <Button
              size="sm"
              onClick={() => runCommand('Сделай weekly review предыдущей недели', 'Review previous week')}
              disabled={busy !== null}
            >
              {busy === 'Review previous week' ? <Spinner /> : <RotateCcw className="h-3 w-3" />}
              Review previous
            </Button>

            <Button
              variant="primary"
              size="sm"
              onClick={() => runCommand('Новая неделя, обнови план', 'Generate week')}
              disabled={busy !== null}
            >
              {busy === 'Generate week' ? <Spinner /> : <Sparkles className="h-3 w-3" />}
              Generate / Update week
            </Button>

            <Button variant="accent" size="sm" onClick={() => setCopilot(true)}>
              AI Chat
            </Button>

            <SyncStatus
              log={state.syncLog}
              target={state.integrations.githubTarget}
              onRefresh={() => refresh(weekId)}
            />
          </>
        }
      />

      <FilterBar
        typeFilter={typeFilter}
        setTypeFilter={setTypeFilter}
        platformFilter={platformFilter}
        setPlatformFilter={setPlatformFilter}
        note={state.week?.planning_note ?? ''}
      />

      <DueBanner units={state.units} onOpen={setOpenUnit} />

      <div className="min-h-0 flex-1 overflow-hidden">
        {state.units.length === 0 ? (
          <div className="p-6">
            <EmptyState
              title="На эту неделю ничего не запланировано"
              hint="Напишите «Новая неделя, обнови план» — система прочитает предыдущую неделю, learnings, аналитику, upcoming Core Videos и backlog, и соберёт календарь."
              action={
                <div className="flex gap-1.5">
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => runCommand('Новая неделя, обнови план', 'Generate week')}
                    disabled={busy !== null}
                  >
                    {busy === 'Generate week' ? <Spinner /> : <Sparkles className="h-3 w-3" />}
                    Generate week
                  </Button>
                  {!state.coreVideos.length ? (
                    <Button size="sm" onClick={seedDemo} disabled={busy !== null}>
                      {busy === 'demo' ? <Spinner /> : <Plus className="h-3 w-3" />}
                      Загрузить demo-данные
                    </Button>
                  ) : null}
                </div>
              }
            />
          </div>
        ) : (
          <WeekBoard
            weekId={weekId}
            units={units}
            onOpen={setOpenUnit}
            onMove={move}
            activeId={openUnit}
          />
        )}
      </div>

      <UnitDrawer
        unitId={openUnit}
        coreVideos={state.coreVideos}
        onClose={() => setOpenUnit(null)}
        onChanged={() => refresh(weekId)}
      />

      <CopilotDrawer
        open={copilot}
        weekId={weekId}
        onClose={() => setCopilot(false)}
        onChanged={() => refresh(weekId)}
        providerLabel={state.integrations.ai.reason}
      />
    </>
  );
}

function FilterBar({
  typeFilter,
  setTypeFilter,
  platformFilter,
  setPlatformFilter,
  note,
}: {
  typeFilter: ContentType[];
  setTypeFilter: (v: ContentType[]) => void;
  platformFilter: Platform[];
  setPlatformFilter: (v: Platform[]) => void;
  note: string;
}) {
  const toggle = <T,>(list: T[], v: T, set: (x: T[]) => void) =>
    set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-1.5">
      <div className="flex items-center gap-1">
        <Filter className="h-3 w-3 text-[var(--color-ink-3)]" />
        {CONTENT_TYPES.map((t) => (
          <button
            key={t}
            onClick={() => toggle(typeFilter, t, setTypeFilter as never)}
            className={cn(
              'flex items-center gap-1 rounded px-1.5 py-0.5 text-[10.5px] font-medium transition-colors',
              typeFilter.includes(t)
                ? 'bg-[var(--color-ink)] text-white'
                : 'text-[var(--color-ink-3)] hover:bg-[var(--color-surface-2)]',
            )}
          >
            <TypeIcon type={t} className={typeFilter.includes(t) ? 'text-white' : undefined} />
            {t}
          </button>
        ))}
      </div>

      <div className="h-3 w-px bg-[var(--color-line)]" />

      <div className="flex items-center gap-1">
        {PLATFORMS.map((p) => (
          <button
            key={p}
            onClick={() => toggle(platformFilter, p, setPlatformFilter as never)}
            className={cn(
              'rounded px-1.5 py-0.5 text-[10.5px] font-medium capitalize transition-colors',
              platformFilter.includes(p)
                ? 'bg-[var(--color-ink)] text-white'
                : 'text-[var(--color-ink-3)] hover:bg-[var(--color-surface-2)]',
            )}
          >
            {p}
          </button>
        ))}
      </div>

      {note ? (
        <p className="ml-auto flex items-center gap-1 truncate text-[10.5px] text-[var(--color-ink-3)]">
          <Lightbulb className="h-3 w-3 shrink-0" />
          {note}
        </p>
      ) : null}
    </div>
  );
}
