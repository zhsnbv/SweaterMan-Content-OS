'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { Lock, RefreshCw, Check, XCircle } from 'lucide-react';
import { useAppState, api } from '@/components/data';
import { Button, Label, SectionTitle, Spinner, Textarea } from '@/components/ui/primitives';
import { PageHeader } from '@/components/shell/PageHeader';
import { cn, relativeTime, renderMarkdown } from '@/lib/utils';

/**
 * The memory layers are shown explicitly:
 *   A. immutable strategy docs   B. operational strategy_state
 *   C. learnings (Insights)      D. weekly data (Week / Insights)
 */
export function ContextPage() {
  const { state, loading, refresh } = useAppState();
  const [active, setActive] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  if (loading || !state) {
    return (
      <div className="flex h-full items-center justify-center text-[var(--color-ink-3)]">
        <Spinner />
      </div>
    );
  }

  const docs = state.contextDocs;
  const current = docs.find((d) => d.slug === active) ?? docs[0] ?? null;
  const proposed = state.strategyChanges.filter((c) => c.status === 'PROPOSED');

  const reimport = async () => {
    setBusy(true);
    try {
      const res = await api<{ imported: string[]; missing: string[] }>('/api/context', {
        method: 'POST',
        json: { action: 'reimport' },
      });
      toast.success(`Импортировано: ${res.imported.join(', ') || '—'}`, {
        description: res.missing.length ? `Не найдено: ${res.missing.join(', ')}` : undefined,
      });
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const decide = async (id: string, decision: 'APPROVED' | 'REJECTED') => {
    try {
      await api(`/api/strategy-changes/${id}`, { method: 'POST', json: { decision } });
      toast.success(decision === 'APPROVED' ? 'Изменение применено' : 'Предложение отклонено');
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не удалось');
    }
  };

  return (
    <>
      <PageHeader
        title="Context"
        subtitle="Постоянная память системы — AI собирает контекст отсюда при каждом запросе"
        actions={
          <Button size="sm" onClick={reimport} disabled={busy}>
            {busy ? <Spinner /> : <RefreshCw className="h-3 w-3" />} Re-import from seed/
          </Button>
        }
      />

      <div className="flex min-h-0 flex-1">
        <aside className="w-[230px] shrink-0 overflow-y-auto border-r border-[var(--color-line)] p-3">
          <SectionTitle>A · Immutable</SectionTitle>
          <div className="mb-4 flex flex-col gap-0.5">
            {docs.map((d) => (
              <button
                key={d.slug}
                onClick={() => setActive(d.slug)}
                className={cn(
                  'flex items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[11.5px] transition-colors',
                  current?.slug === d.slug
                    ? 'bg-[var(--color-surface-2)] font-medium text-[var(--color-ink)]'
                    : 'text-[var(--color-ink-2)] hover:bg-[var(--color-surface-2)]',
                )}
              >
                {d.immutable ? (
                  <Lock className="h-3 w-3 shrink-0 text-[var(--color-ink-3)]" />
                ) : (
                  <span className="w-3" />
                )}
                <span className="min-w-0 flex-1 truncate">{d.title}</span>
                <span className="text-[9.5px] text-[var(--color-ink-3)] numeric">
                  {Math.round(d.body.length / 1000)}k
                </span>
              </button>
            ))}
          </div>

          <SectionTitle>B · Operational</SectionTitle>
          <div className="mb-4 rounded-md border border-[var(--color-line)] p-2 text-[11px] leading-relaxed text-[var(--color-ink-2)]">
            <p className="mb-1 font-medium text-[var(--color-ink)]">strategy_state.json</p>
            <p className="text-[10.5px] text-[var(--color-ink-3)]">
              Обновлено {relativeTime(state.strategyState.updated_at)}
            </p>
            <p className="mt-1.5">{state.strategyState.current_focus}</p>
            <p className="mt-1.5 text-[10.5px] text-[var(--color-ink-3)]">
              sales level: {state.strategyState.sales_level}
            </p>
          </div>

          <SectionTitle>C · Learnings</SectionTitle>
          <p className="mb-4 text-[11px] text-[var(--color-ink-3)]">
            {state.learnings.filter((l) => !l.superseded_by).length} активных · append-only ·
            страница Insights
          </p>

          <SectionTitle>D · Weekly data</SectionTitle>
          <p className="text-[11px] text-[var(--color-ink-3)]">
            {state.weeks.length} недель · {state.reviews.length} reviews
          </p>
        </aside>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {proposed.length ? (
            <div className="border-b border-[#f4dfc0] bg-[#fdf6ec] p-3">
              <SectionTitle>Proposed strategy changes — нужно решение Owner</SectionTitle>
              <div className="space-y-2">
                {proposed.map((c) => (
                  <div
                    key={c.id}
                    className="rounded-md border border-[#f4dfc0] bg-[var(--color-surface)] p-2.5"
                  >
                    <p className="text-[11px] font-semibold">{c.target_doc}</p>
                    <p className="mt-1 text-[11.5px] text-[var(--color-ink-2)]">{c.rationale}</p>
                    <pre className="mt-1 whitespace-pre-wrap font-sans text-[11.5px] text-[var(--color-ink)]">
                      {c.proposed_change}
                    </pre>
                    {c.evidence.length ? (
                      <p className="mt-1 text-[10.5px] text-[var(--color-ink-3)]">
                        Evidence: {c.evidence.join('; ')}
                      </p>
                    ) : null}
                    <div className="mt-2 flex gap-1.5">
                      <Button variant="primary" size="xs" onClick={() => decide(c.id, 'APPROVED')}>
                        <Check className="h-3 w-3" /> Approve
                      </Button>
                      <Button variant="ghost" size="xs" onClick={() => decide(c.id, 'REJECTED')}>
                        <XCircle className="h-3 w-3" /> Reject
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {current ? (
            <DocView
              key={current.slug}
              doc={current}
              onSaved={async () => {
                await refresh();
              }}
            />
          ) : (
            <div className="p-6 text-[12px] text-[var(--color-ink-3)]">Документы не загружены.</div>
          )}
        </div>
      </div>
    </>
  );
}

function DocView({
  doc,
  onSaved,
}: {
  doc: { slug: string; title: string; body: string; immutable: boolean; updated_at: string };
  onSaved: () => void;
}) {
  const [editing, setEditing] = React.useState(false);
  const [body, setBody] = React.useState(doc.body);
  const [busy, setBusy] = React.useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await api('/api/context', {
        method: 'POST',
        json: { action: 'update_doc', slug: doc.slug, body, owner_override: doc.immutable },
      });
      toast.success('Документ сохранён');
      setEditing(false);
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не удалось');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-1.5 text-[14px] font-semibold tracking-tight">
            {doc.immutable ? <Lock className="h-3.5 w-3.5 text-[var(--color-ink-3)]" /> : null}
            {doc.title}
          </h2>
          <p className="text-[10.5px] text-[var(--color-ink-3)]">
            {doc.immutable
              ? 'Фундаментальный документ. AI может только предложить изменение — применяет Owner.'
              : 'Отчётный документ — можно переимпортировать из seed/.'}{' '}
            Обновлён {relativeTime(doc.updated_at)}.
          </p>
        </div>
        <div className="flex gap-1.5">
          {editing ? (
            <>
              <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
                Отмена
              </Button>
              <Button variant="primary" size="sm" onClick={save} disabled={busy}>
                {busy ? <Spinner /> : null} Сохранить как Owner
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              onClick={() => {
                setBody(doc.body);
                setEditing(true);
              }}
            >
              Редактировать
            </Button>
          )}
        </div>
      </div>

      {editing ? (
        <>
          <Label>Markdown</Label>
          <Textarea
            rows={30}
            className="font-mono text-[11.5px]"
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </>
      ) : (
        <article
          className="prose-doc max-w-[780px]"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(doc.body) }}
        />
      )}
    </div>
  );
}
