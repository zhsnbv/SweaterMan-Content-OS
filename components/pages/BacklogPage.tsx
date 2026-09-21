'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';
import { useAppState, api } from '@/components/data';
import { BACKLOG_STATUSES, type BacklogStatus } from '@/lib/domain/enums';
import { Button, EmptyState, Input, Label, Select, Spinner, Textarea } from '@/components/ui/primitives';
import { PageHeader } from '@/components/shell/PageHeader';
import { cn } from '@/lib/utils';

const STATUS_STYLE: Record<BacklogStatus, string> = {
  RAW: 'bg-[var(--color-surface-2)] text-[var(--color-ink-3)] border-[var(--color-line)]',
  TEST: 'bg-[#f5f1ff] text-[#5b3fd6] border-[#e4dcff]',
  PROMISING: 'bg-[#eefaf5] text-[#087f55] border-[#c9ece0]',
  RESEARCH: 'bg-[#fdf6ec] text-[#a35d06] border-[#f4dfc0]',
  CORE_CANDIDATE: 'bg-[#eff4fe] text-[#1d4ed8] border-[#cfdefb]',
  PRODUCED: 'bg-[#f1f1f4] text-[#17171b] border-[#d8d8de]',
  REJECTED: 'bg-[#fef3f2] text-[#b42318] border-[#fecdca]',
};

export function BacklogPage() {
  const { state, loading, refresh } = useAppState();
  const [adding, setAdding] = React.useState(false);
  const [filter, setFilter] = React.useState<BacklogStatus | 'ALL'>('ALL');

  if (loading || !state) {
    return (
      <div className="flex h-full items-center justify-center text-[var(--color-ink-3)]">
        <Spinner />
      </div>
    );
  }

  const items =
    filter === 'ALL' ? state.backlog : state.backlog.filter((b) => b.status === filter);

  const setStatus = async (id: string, status: BacklogStatus) => {
    try {
      const res = await api<{ guard: string }>(`/api/backlog/${id}`, {
        method: 'PATCH',
        json: { status },
      });
      if (res.guard) toast.warning(res.guard);
      else toast.success('Статус обновлён');
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не удалось');
    }
  };

  return (
    <>
      <PageHeader
        title="Backlog"
        subtitle={`${state.backlog.length} идей · статус меняется только по evidence`}
        actions={
          <>
            <Select
              className="w-[150px]"
              value={filter}
              onChange={(e) => setFilter(e.target.value as never)}
            >
              <option value="ALL">Все статусы</option>
              {BACKLOG_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
            <Button variant="primary" size="sm" onClick={() => setAdding(true)}>
              <Plus className="h-3 w-3" /> Add idea
            </Button>
          </>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {!items.length ? (
          <EmptyState
            title="Backlog пуст"
            hint="Идеи попадают сюда вручную, из AI-чата («Добавь две идеи для теста новых тем») или из результатов topic-hypothesis постов."
            action={
              <Button variant="primary" size="sm" onClick={() => setAdding(true)}>
                <Plus className="h-3 w-3" /> Add idea
              </Button>
            }
          />
        ) : (
          <div className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-line)]">
            <table className="w-full border-collapse text-[12px]">
              <thead>
                <tr className="border-b border-[var(--color-line)] bg-[var(--color-surface-2)] text-left">
                  <th className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-ink-3)]">
                    Idea
                  </th>
                  <th className="w-[130px] px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-ink-3)]">
                    Cluster
                  </th>
                  <th className="w-[150px] px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-ink-3)]">
                    Status
                  </th>
                  <th className="w-[80px] px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-ink-3)]">
                    Evidence
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((b) => (
                  <tr
                    key={b.id}
                    className="border-b border-[var(--color-line)] align-top last:border-0 hover:bg-[var(--color-surface-2)]/60"
                  >
                    <td className="px-3 py-2.5">
                      <p className="font-medium text-[var(--color-ink)]">{b.title}</p>
                      {b.why_interesting ? (
                        <p className="mt-0.5 text-[11px] text-[var(--color-ink-3)]">
                          {b.why_interesting}
                        </p>
                      ) : null}
                      {b.suggested_test ? (
                        <p className="mt-1 text-[11px] text-[var(--color-ink-2)]">
                          <span className="text-[var(--color-ink-3)]">Как проверить: </span>
                          {b.suggested_test}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-3 py-2.5 text-[11px] text-[var(--color-ink-3)]">
                      {b.cluster || '—'}
                    </td>
                    <td className="px-3 py-2.5">
                      <Select
                        className={cn('h-6 text-[10.5px] font-medium', STATUS_STYLE[b.status])}
                        value={b.status}
                        onChange={(e) => setStatus(b.id, e.target.value as BacklogStatus)}
                      >
                        {BACKLOG_STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </Select>
                    </td>
                    <td className="px-3 py-2.5 text-[11px] text-[var(--color-ink-3)] numeric">
                      {b.evidence.length || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {adding ? (
        <AddIdea
          onClose={() => setAdding(false)}
          onAdded={async () => {
            setAdding(false);
            await refresh();
          }}
        />
      ) : null}
    </>
  );
}

function AddIdea({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [title, setTitle] = React.useState('');
  const [why, setWhy] = React.useState('');
  const [test, setTest] = React.useState('');
  const [cluster, setCluster] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  const add = async () => {
    setBusy(true);
    try {
      await api('/api/backlog', {
        method: 'POST',
        json: { title, why_interesting: why, suggested_test: test, cluster },
      });
      toast.success('Идея добавлена');
      onAdded();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не удалось');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-6">
      <div className="fade-in absolute inset-0 bg-[#17171b]/25" onClick={onClose} />
      <div className="relative w-[440px] rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-4 shadow-xl">
        <h3 className="mb-3 text-[13px] font-semibold">Новая идея</h3>
        <div className="space-y-2.5">
          <div>
            <Label>Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
          </div>
          <div>
            <Label>Почему интересно</Label>
            <Textarea rows={2} value={why} onChange={(e) => setWhy(e.target.value)} />
          </div>
          <div>
            <Label>Как проверить дёшево</Label>
            <Textarea
              rows={2}
              value={test}
              onChange={(e) => setTest(e.target.value)}
              placeholder="Story poll, Community quiz, photo mode…"
            />
          </div>
          <div>
            <Label>Cluster</Label>
            <Input
              value={cluster}
              onChange={(e) => setCluster(e.target.value)}
              placeholder="animals_nature, history, prehistory_evolution…"
            />
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-1.5">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Отмена
          </Button>
          <Button variant="primary" size="sm" onClick={add} disabled={busy || !title.trim()}>
            {busy ? <Spinner /> : null} Добавить
          </Button>
        </div>
      </div>
    </div>
  );
}
