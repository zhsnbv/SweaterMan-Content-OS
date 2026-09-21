'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { RotateCcw } from 'lucide-react';
import { useAppState, api } from '@/components/data';
import { currentWeekId, previousWeekId } from '@/lib/domain/week';
import type { Confidence } from '@/lib/domain/enums';
import { Button, EmptyState, Spinner, Tabs } from '@/components/ui/primitives';
import { PageHeader } from '@/components/shell/PageHeader';
import { cn, relativeTime } from '@/lib/utils';

const CONFIDENCE_STYLE: Record<Confidence, string> = {
  HIGH: 'bg-[#eefaf5] text-[#087f55] border-[#c9ece0]',
  MEDIUM: 'bg-[#fdf6ec] text-[#a35d06] border-[#f4dfc0]',
  LOW: 'bg-[var(--color-surface-2)] text-[var(--color-ink-3)] border-[var(--color-line)]',
};

const RESULT_STYLE: Record<string, string> = {
  YES: 'text-[#087f55]',
  NO: 'text-[#b42318]',
  TOO_EARLY: 'text-[var(--color-ink-3)]',
};

export function InsightsPage() {
  const { state, loading, refresh } = useAppState();
  const [tab, setTab] = React.useState('reviews');
  const [busy, setBusy] = React.useState(false);

  if (loading || !state) {
    return (
      <div className="flex h-full items-center justify-center text-[var(--color-ink-3)]">
        <Spinner />
      </div>
    );
  }

  const runReview = async () => {
    setBusy(true);
    try {
      const week = previousWeekId(currentWeekId());
      const res = await api<{ new_learnings: string[] }>('/api/review', {
        method: 'POST',
        json: { week_id: week },
      });
      toast.success(`Review ${week} готов`, {
        description: res.new_learnings.length
          ? `Записано новых learnings: ${res.new_learnings.length}`
          : 'Новых learnings нет',
      });
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не удалось');
    } finally {
      setBusy(false);
    }
  };

  const active = state.learnings.filter((l) => !l.superseded_by);

  return (
    <>
      <PageHeader
        title="Insights"
        subtitle={`${state.reviews.length} weekly reviews · ${active.length} активных learnings`}
        actions={
          <Button variant="primary" size="sm" onClick={runReview} disabled={busy}>
            {busy ? <Spinner /> : <RotateCcw className="h-3 w-3" />} Review previous week
          </Button>
        }
      />

      <Tabs
        tabs={[
          { id: 'reviews', label: 'Weekly reviews', badge: state.reviews.length || undefined },
          { id: 'learnings', label: 'Learnings', badge: active.length || undefined },
        ]}
        active={tab}
        onChange={setTab}
      />

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {tab === 'reviews' ? (
          state.reviews.length ? (
            <div className="space-y-4">
              {[...state.reviews].reverse().map((r) => (
                <div
                  key={r.id}
                  className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)]"
                >
                  <div className="flex items-baseline justify-between border-b border-[var(--color-line)] px-3 py-2">
                    <h3 className="text-[13px] font-semibold">{r.week_id}</h3>
                    <span className="text-[10.5px] text-[var(--color-ink-3)]">
                      {r.generated_by} · {relativeTime(r.created_at)}
                    </span>
                  </div>

                  <div className="divide-y divide-[var(--color-line)]">
                    {r.units.map((u) => (
                      <div key={u.content_unit_id} className="px-3 py-2.5">
                        <div className="mb-1 flex items-center gap-2">
                          <span className="font-mono text-[10px] text-[var(--color-ink-3)]">
                            {u.content_unit_id}
                          </span>
                          <span className="text-[12px] font-medium">{u.title}</span>
                          <span
                            className={cn(
                              'ml-auto text-[10.5px] font-semibold',
                              RESULT_STYLE[u.result],
                            )}
                          >
                            {u.result.replace('_', ' ')}
                          </span>
                        </div>
                        <dl className="grid grid-cols-[130px_1fr] gap-x-3 gap-y-0.5 text-[11.5px]">
                          <dt className="text-[var(--color-ink-3)]">Хотели проверить</dt>
                          <dd className="text-[var(--color-ink-2)]">{u.what_we_wanted_to_test}</dd>
                          <dt className="text-[var(--color-ink-3)]">Что произошло</dt>
                          <dd className="text-[var(--color-ink-2)]">{u.what_happened}</dd>
                          {u.what_to_repeat ? (
                            <>
                              <dt className="text-[var(--color-ink-3)]">Повторить</dt>
                              <dd className="text-[var(--color-ink-2)]">{u.what_to_repeat}</dd>
                            </>
                          ) : null}
                          {u.what_to_change ? (
                            <>
                              <dt className="text-[var(--color-ink-3)]">Изменить</dt>
                              <dd className="text-[var(--color-ink-2)]">{u.what_to_change}</dd>
                            </>
                          ) : null}
                        </dl>
                      </div>
                    ))}
                  </div>

                  <div className="space-y-1 border-t border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-2.5 text-[11.5px]">
                    {(
                      [
                        ['CONTENT', r.content_summary],
                        ['PRODUCTION', r.production_summary],
                        ['FUNNEL', r.funnel_summary],
                        ['BACKLOG', r.backlog_summary],
                        ['USER FEEDBACK', r.user_feedback_summary],
                      ] as const
                    ).map(([label, value]) => (
                      <div key={label} className="grid grid-cols-[120px_1fr] gap-3">
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-ink-3)]">
                          {label}
                        </span>
                        <span className="whitespace-pre-wrap text-[var(--color-ink-2)]">{value}</span>
                      </div>
                    ))}
                    <div className="grid grid-cols-[120px_1fr] gap-3 pt-1">
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-ink)]">
                        Next week
                      </span>
                      <span className="whitespace-pre-wrap text-[var(--color-ink)]">
                        {r.next_week_changes}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              title="Weekly reviews ещё не делались"
              hint="Review сравнивает, что вы хотели проверить, с тем, что произошло, и превращает повторяющийся feedback команды в learnings."
            />
          )
        ) : null}

        {tab === 'learnings' ? (
          active.length ? (
            <div className="space-y-2">
              {active.map((l) => (
                <div
                  key={l.id}
                  className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-3"
                >
                  <div className="mb-1.5 flex items-start gap-2">
                    <span
                      className={cn(
                        'shrink-0 rounded border px-1.5 py-[1px] text-[9.5px] font-semibold',
                        CONFIDENCE_STYLE[l.confidence],
                      )}
                    >
                      {l.confidence}
                    </span>
                    <span className="text-[10px] uppercase tracking-wide text-[var(--color-ink-3)]">
                      {l.category}
                    </span>
                    <span className="ml-auto text-[10px] text-[var(--color-ink-3)]">
                      {relativeTime(l.created_at)}
                    </span>
                  </div>
                  <p className="text-[12.5px] font-medium leading-snug">{l.observation}</p>
                  <p className="mt-1 text-[11.5px] text-[var(--color-ink-3)]">
                    <span className="font-medium">Evidence:</span> {l.evidence.join('; ')}
                  </p>
                  {l.action ? (
                    <p className="mt-1 text-[11.5px] text-[var(--color-ink-2)]">
                      <span className="font-medium">Action:</span> {l.action}
                    </p>
                  ) : null}
                  {l.tags.length ? (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {l.tags.map((t) => (
                        <span
                          key={t}
                          className="rounded bg-[var(--color-surface-2)] px-1.5 py-[1px] font-mono text-[9.5px] text-[var(--color-ink-3)]"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              title="Learnings пока нет"
              hint="Learning появляется только с evidence: подтверждённая аналитика или повторяющийся feedback команды. Один пост — это LOW confidence, а не правило."
            />
          )
        ) : null}
      </div>
    </>
  );
}
