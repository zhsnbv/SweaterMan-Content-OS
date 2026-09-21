'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { X, Undo2, Send, Sparkles, Copy, ExternalLink } from 'lucide-react';
import type {
  AnalyticsReport,
  Comment,
  ContentUnit,
  CoreVideo,
  Revision,
} from '@/lib/domain/schema';
import {
  EFFORTS,
  EFFORT_LABEL,
  CONTENT_TYPES,
  UNIT_STATUSES,
  REQUIRED_ANALYTICS_WINDOWS,
  type AnalyticsWindow,
  type Platform,
} from '@/lib/domain/enums';
import { Button, Drawer, Input, Label, Select, Tabs, Textarea, SectionTitle, Spinner } from '@/components/ui/primitives';
import { PlatformIcon, TypeChip } from '@/components/ui/tokens';
import { api } from '@/components/data';
import { cn, relativeTime } from '@/lib/utils';
import { ReportDialog } from '@/components/analytics/ReportDialog';

type Detail = {
  unit: ContentUnit;
  revisions: Revision[];
  comments: Comment[];
  reports: AnalyticsReport[];
};

export function UnitDrawer({
  unitId,
  coreVideos,
  onClose,
  onChanged,
}: {
  unitId: string | null;
  coreVideos: CoreVideo[];
  onClose: () => void;
  onChanged: () => void;
}) {
  if (!unitId) return null;
  // Keyed on the card id so switching cards remounts the panel. Resetting the
  // inner state from an effect instead would cascade an extra render.
  return (
    <UnitDrawerContent
      key={unitId}
      unitId={unitId}
      coreVideos={coreVideos}
      onClose={onClose}
      onChanged={onChanged}
    />
  );
}

function UnitDrawerContent({
  unitId,
  coreVideos,
  onClose,
  onChanged,
}: {
  unitId: string;
  coreVideos: CoreVideo[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [detail, setDetail] = React.useState<Detail | null>(null);
  const [tab, setTab] = React.useState('summary');
  const [busy, setBusy] = React.useState(false);
  const [reportFor, setReportFor] = React.useState<{ window: AnalyticsWindow } | null>(null);

  const load = React.useCallback(async () => {
    setDetail(await api<Detail>(`/api/units/${unitId}`));
  }, [unitId]);

  React.useEffect(() => {
    // Fetching on mount: state is set after the await, so no cascading render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const refreshAll = async () => {
    await load();
    onChanged();
  };

  return (
    <Drawer open onClose={onClose} width="w-[600px]">
      {!detail ? (
        <div className="flex h-full items-center justify-center text-[var(--color-ink-3)]">
          <Spinner />
        </div>
      ) : (
        <>
          <DrawerHeader unit={detail.unit} onClose={onClose} />

          <Tabs
            tabs={[
              { id: 'summary', label: 'Summary' },
              { id: 'platforms', label: 'Platforms', badge: detail.unit.platforms.length },
              { id: 'analytics', label: 'Analytics', badge: detail.reports.length || undefined },
              { id: 'activity', label: 'Activity', badge: detail.revisions.length || undefined },
              { id: 'comments', label: 'Comments', badge: detail.comments.length || undefined },
            ]}
            active={tab}
            onChange={setTab}
          />

          <div className="min-h-0 flex-1 overflow-y-auto">
            {tab === 'summary' ? (
              <SummaryTab
                key={detail.unit.updated_at}
                detail={detail}
                coreVideos={coreVideos}
                onSaved={refreshAll}
              />
            ) : null}
            {tab === 'platforms' ? (
              <PlatformsTab detail={detail} onChanged={refreshAll} />
            ) : null}
            {tab === 'analytics' ? (
              <AnalyticsTab detail={detail} onAdd={(w) => setReportFor({ window: w })} onChanged={refreshAll} />
            ) : null}
            {tab === 'activity' ? <ActivityTab detail={detail} onChanged={refreshAll} /> : null}
            {tab === 'comments' ? <CommentsTab detail={detail} onChanged={refreshAll} /> : null}
          </div>

          <UnitChat unitId={detail.unit.id} busy={busy} setBusy={setBusy} onChanged={refreshAll} />

          {reportFor ? (
            <ReportDialog
              unit={detail.unit}
              window={reportFor.window}
              onClose={() => setReportFor(null)}
              onDone={async () => {
                setReportFor(null);
                await refreshAll();
              }}
            />
          ) : null}
        </>
      )}
    </Drawer>
  );
}

/* ---------------- header ---------------- */

function DrawerHeader({ unit, onClose }: { unit: ContentUnit; onClose: () => void }) {
  return (
    <div className="flex items-start gap-3 border-b border-[var(--color-line)] px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center gap-1.5">
          <TypeChip type={unit.content_type} />
          <span className="font-mono text-[10px] text-[var(--color-ink-3)]">{unit.id}</span>
          <span className="text-[10px] text-[var(--color-ink-3)] numeric">
            rev {unit.revision_number}
          </span>
        </div>
        <h2 className="text-[14px] font-semibold leading-snug tracking-tight">{unit.title}</h2>
      </div>
      <Button variant="ghost" size="xs" onClick={onClose} aria-label="Close">
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

/* ---------------- summary ---------------- */

function SummaryTab({
  detail,
  coreVideos,
  onSaved,
}: {
  detail: Detail;
  coreVideos: CoreVideo[];
  onSaved: () => void;
}) {
  const { unit } = detail;
  // Remounted by the parent whenever the unit changes (key={updated_at}),
  // so the draft starts from the saved version without a reset effect.
  const [draft, setDraft] = React.useState(unit);
  const [saving, setSaving] = React.useState(false);

  const dirty = JSON.stringify(draft) !== JSON.stringify(unit);

  const save = async () => {
    setSaving(true);
    try {
      await api(`/api/units/${unit.id}`, {
        method: 'PATCH',
        json: {
          title: draft.title,
          content_type: draft.content_type,
          status: draft.status,
          estimated_effort: draft.estimated_effort,
          scheduled_time: draft.scheduled_time || null,
          objective: draft.objective,
          hypothesis: draft.hypothesis,
          expected_signal: draft.expected_signal,
          notes: draft.notes,
          owner: draft.owner,
          figma_url: draft.figma_url,
          related_core_video_id: draft.related_core_video_id || null,
        },
      });
      toast.success('Карточка сохранена');
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не удалось сохранить');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4 p-4">
      <div>
        <Label>Title</Label>
        <Input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div>
          <Label>Type</Label>
          <Select
            value={draft.content_type}
            onChange={(e) => setDraft({ ...draft, content_type: e.target.value as never })}
          >
            {CONTENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label>Effort</Label>
          <Select
            value={draft.estimated_effort}
            onChange={(e) => setDraft({ ...draft, estimated_effort: e.target.value as never })}
          >
            {EFFORTS.map((t) => (
              <option key={t} value={t}>
                {t} · {EFFORT_LABEL[t]}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label>Status</Label>
          <Select
            value={draft.status}
            onChange={(e) => setDraft({ ...draft, status: e.target.value as never })}
          >
            {UNIT_STATUSES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label>Core video</Label>
          <Select
            value={draft.related_core_video_id ?? ''}
            onChange={(e) =>
              setDraft({ ...draft, related_core_video_id: e.target.value || null })
            }
          >
            <option value="">— не связано —</option>
            {coreVideos.map((v) => (
              <option key={v.id} value={v.id}>
                {v.id} · {v.working_title}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label>Scheduled time</Label>
          <Input
            placeholder="18:00"
            value={draft.scheduled_time ?? ''}
            onChange={(e) => setDraft({ ...draft, scheduled_time: e.target.value })}
          />
        </div>
      </div>

      <div>
        <Label>Objective</Label>
        <Textarea
          rows={2}
          value={draft.objective}
          onChange={(e) => setDraft({ ...draft, objective: e.target.value })}
        />
      </div>

      <div>
        <Label>Hypothesis</Label>
        <Textarea
          rows={2}
          value={draft.hypothesis}
          onChange={(e) => setDraft({ ...draft, hypothesis: e.target.value })}
        />
      </div>

      <div>
        <Label>Expected signal</Label>
        <Textarea
          rows={3}
          value={draft.expected_signal}
          onChange={(e) => setDraft({ ...draft, expected_signal: e.target.value })}
        />
        <p className="mt-1 text-[10.5px] text-[var(--color-ink-3)]">
          Не прогноз просмотров. Формулировка «если произойдёт X — значит Y».
        </p>
      </div>

      <div>
        <Label>Notes</Label>
        <Textarea
          rows={2}
          value={draft.notes}
          onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
        />
      </div>

      {unit.ai_reasoning_short ? (
        <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-surface-2)] p-2.5">
          <SectionTitle>AI reasoning</SectionTitle>
          <p className="text-[11.5px] leading-relaxed text-[var(--color-ink-2)]">
            {unit.ai_reasoning_short}
          </p>
        </div>
      ) : null}

      {unit.user_feedback.length ? (
        <div>
          <SectionTitle>Feedback history</SectionTitle>
          <ul className="space-y-1">
            {unit.user_feedback.map((f, i) => (
              <li
                key={i}
                className="rounded border-l-2 border-[var(--color-line-strong)] bg-[var(--color-surface-2)] px-2 py-1 text-[11.5px] text-[var(--color-ink-2)]"
              >
                {f}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {dirty ? (
        <div className="sticky bottom-0 -mx-4 flex items-center justify-end gap-2 border-t border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-2">
          <Button variant="ghost" size="sm" onClick={() => setDraft(unit)}>
            Отменить
          </Button>
          <Button variant="primary" size="sm" onClick={save} disabled={saving}>
            {saving ? <Spinner /> : null} Сохранить
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/* ---------------- platforms ---------------- */

function PlatformsTab({ detail, onChanged }: { detail: Detail; onChanged: () => void }) {
  const { unit } = detail;
  if (!unit.platforms.length) {
    return (
      <div className="p-4 text-[12px] text-[var(--color-ink-3)]">
        У карточки нет платформ. Попросите AI в чате внизу добавить нужные варианты.
      </div>
    );
  }

  return (
    <div className="divide-y divide-[var(--color-line)]">
      {unit.platforms.map((p) => (
        <VariantBlock key={p.id} unit={unit} variant={p} onChanged={onChanged} />
      ))}
    </div>
  );
}

function VariantBlock({
  unit,
  variant,
  onChanged,
}: {
  unit: ContentUnit;
  variant: ContentUnit['platforms'][number];
  onChanged: () => void;
}) {
  const [url, setUrl] = React.useState(variant.publish_url);
  const [publishing, setPublishing] = React.useState(false);
  const published = variant.publish_status === 'published';

  const publish = async () => {
    setPublishing(true);
    try {
      await api(`/api/units/${unit.id}/publish`, {
        method: 'POST',
        json: { platform: variant.platform, surface: variant.surface, publish_url: url },
      });
      toast.success('Отмечено как опубликованное — через 24 часа появится 24h report due');
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не удалось');
    } finally {
      setPublishing(false);
    }
  };

  const copy = (text: string) => {
    void navigator.clipboard?.writeText(text);
    toast.success('Скопировано');
  };

  return (
    <div className="p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <PlatformIcon platform={variant.platform} />
          <span className="text-[12px] font-medium lowercase">
            {variant.surface.replace(/_/g, ' ')}
          </span>
          {variant.format ? (
            <span className="text-[10.5px] text-[var(--color-ink-3)]">{variant.format}</span>
          ) : null}
        </div>
        {published ? (
          <span className="flex items-center gap-1 text-[10.5px] font-medium text-[#087f55]">
            Published ✓
          </span>
        ) : null}
      </div>

      {variant.hook ? (
        <Field label="Hook" value={variant.hook} onCopy={copy} />
      ) : null}
      <Field label="Ready-to-use copy" value={variant.ready_to_use_copy} onCopy={copy} mono />
      {variant.visual_instruction ? (
        <Field label="Visual instruction" value={variant.visual_instruction} onCopy={copy} />
      ) : null}
      {variant.cta ? <Field label="CTA" value={variant.cta} onCopy={copy} /> : null}

      <div className="mt-3 rounded-md border border-[var(--color-line)] bg-[var(--color-surface-2)] p-2.5">
        <Label>Publishing</Label>
        <div className="flex items-center gap-1.5">
          <Input
            placeholder="https://… ссылка на публикацию"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <Button
            variant={published ? 'secondary' : 'accent'}
            size="sm"
            onClick={publish}
            disabled={publishing || !url.trim()}
          >
            {publishing ? <Spinner /> : null}
            {published ? 'Обновить' : 'Published'}
          </Button>
          {published && variant.publish_url ? (
            <a href={variant.publish_url} target="_blank" rel="noreferrer" title="Открыть">
              <Button variant="ghost" size="sm">
                <ExternalLink className="h-3 w-3" />
              </Button>
            </a>
          ) : null}
        </div>
        {published && variant.published_at ? (
          <p className="mt-1 text-[10.5px] text-[var(--color-ink-3)]">
            Опубликовано {relativeTime(variant.published_at)}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onCopy,
  mono,
}: {
  label: string;
  value: string;
  onCopy: (v: string) => void;
  mono?: boolean;
}) {
  return (
    <div className="mb-2.5">
      <div className="mb-1 flex items-center justify-between">
        <Label className="mb-0">{label}</Label>
        <button
          onClick={() => onCopy(value)}
          className="text-[var(--color-ink-3)] hover:text-[var(--color-ink)]"
          aria-label={`Copy ${label}`}
        >
          <Copy className="h-3 w-3" />
        </button>
      </div>
      <pre
        className={cn(
          'whitespace-pre-wrap rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] p-2 text-[11.5px] leading-relaxed text-[var(--color-ink-2)]',
          mono ? 'font-sans' : 'font-sans',
        )}
      >
        {value || '—'}
      </pre>
    </div>
  );
}

/* ---------------- analytics ---------------- */

function AnalyticsTab({
  detail,
  onAdd,
  onChanged,
}: {
  detail: Detail;
  onAdd: (w: AnalyticsWindow) => void;
  onChanged: () => void;
}) {
  const { unit, reports } = detail;
  const published = unit.platforms.filter((p) => p.publish_status === 'published');

  if (!published.length) {
    return (
      <div className="p-4 text-[12px] text-[var(--color-ink-3)]">
        Карточка ещё не опубликована. Отметьте публикацию на вкладке Platforms — после этого
        появятся окна отчётов 24h / 72h / 7d.
      </div>
    );
  }

  return (
    <div className="space-y-3 p-4">
      <div className="grid grid-cols-3 gap-2">
        {REQUIRED_ANALYTICS_WINDOWS.map((w) => {
          const done = unit.analytics_status[`${w}_complete` as never] as boolean;
          const due = unit.analytics_status[`${w}_due` as never] as boolean;
          return (
            <button
              key={w}
              onClick={() => onAdd(w)}
              className={cn(
                'rounded-md border px-2 py-2 text-left transition-colors',
                done
                  ? 'border-[#c9ece0] bg-[#eefaf5]'
                  : due
                    ? 'border-[#f4dfc0] bg-[#fdf6ec]'
                    : 'border-[var(--color-line)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-2)]',
              )}
            >
              <div className="text-[11px] font-semibold numeric">{w}</div>
              <div
                className={cn(
                  'text-[10.5px]',
                  done ? 'text-[#087f55]' : due ? 'text-[#b54708]' : 'text-[var(--color-ink-3)]',
                )}
              >
                {done ? '✅ Report added' : due ? '⚠️ Due' : 'Add report'}
              </div>
            </button>
          );
        })}
      </div>

      {reports.map((r) => (
        <ReportCard key={r.id} report={r} onChanged={onChanged} />
      ))}
      {!reports.length ? (
        <p className="text-[11.5px] text-[var(--color-ink-3)]">
          Отчётов пока нет. Нажмите на окно выше, чтобы загрузить скриншот аналитики.
        </p>
      ) : null}
    </div>
  );
}

function ReportCard({ report, onChanged: _onChanged }: { report: AnalyticsReport; onChanged: () => void }) {
  const metrics = report.confirmed ? report.confirmed_metrics : report.extracted_metrics;
  return (
    <div className="rounded-md border border-[var(--color-line)] p-2.5">
      <div className="mb-1.5 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <PlatformIcon platform={report.platform as Platform} />
          <span className="text-[11px] font-semibold numeric">{report.window}</span>
        </div>
        <span
          className={cn(
            'text-[10px] font-medium',
            report.confirmed ? 'text-[#087f55]' : 'text-[#b54708]',
          )}
        >
          {report.confirmed ? 'confirmed' : 'не подтверждён'}
        </span>
      </div>

      {report.publish_url ? (
        <a
          href={report.publish_url}
          target="_blank"
          rel="noreferrer"
          className="mb-1.5 block truncate text-[10.5px] text-[var(--color-accent)] hover:underline"
        >
          {report.publish_url}
        </a>
      ) : null}

      {report.screenshots.length ? (
        <div className="mb-2 flex gap-1.5">
          {report.screenshots.map((s) => (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              key={s}
              src={s}
              alt="analytics screenshot"
              className="h-16 w-auto rounded border border-[var(--color-line)] object-cover"
            />
          ))}
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
        {metrics.map((m) => (
          <div key={m.key} className="flex items-baseline justify-between text-[11px]">
            <span className="text-[var(--color-ink-3)]">{m.key}</span>
            <span className="font-medium numeric">
              {m.value === null ? 'NA' : m.value.toLocaleString('ru-RU')}
            </span>
          </div>
        ))}
        {!metrics.length ? (
          <span className="text-[11px] text-[var(--color-ink-3)]">Метрик нет</span>
        ) : null}
      </div>

      {report.user_notes ? (
        <p className="mt-2 text-[11px] text-[var(--color-ink-2)]">{report.user_notes}</p>
      ) : null}
      {report.ai_observation ? (
        <p className="mt-2 border-t border-[var(--color-line)] pt-2 text-[11px] italic text-[var(--color-ink-2)]">
          {report.ai_observation}
        </p>
      ) : null}
    </div>
  );
}

/* ---------------- activity ---------------- */

function ActivityTab({ detail, onChanged }: { detail: Detail; onChanged: () => void }) {
  const [busy, setBusy] = React.useState<string | null>(null);

  const restore = async (revisionId: string) => {
    setBusy(revisionId);
    try {
      const res = await api<{ diff_summary: string }>(`/api/units/${detail.unit.id}/revisions`, {
        method: 'POST',
        json: { revision_id: revisionId },
      });
      toast.success('Версия восстановлена', { description: res.diff_summary.slice(0, 120) });
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не удалось');
    } finally {
      setBusy(null);
    }
  };

  if (!detail.revisions.length) {
    return <div className="p-4 text-[12px] text-[var(--color-ink-3)]">Изменений пока не было.</div>;
  }

  return (
    <div className="divide-y divide-[var(--color-line)]">
      {detail.revisions.map((r) => (
        <div key={r.id} className="p-3">
          <div className="mb-1 flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-semibold numeric">rev {r.revision_number}</span>
              <span className="text-[10.5px] text-[var(--color-ink-3)]">{r.actor}</span>
              <span className="text-[10.5px] text-[var(--color-ink-3)]">
                {relativeTime(r.created_at)}
              </span>
            </div>
            <Button variant="ghost" size="xs" onClick={() => restore(r.id)} disabled={busy === r.id}>
              {busy === r.id ? <Spinner /> : <Undo2 className="h-3 w-3" />} Restore
            </Button>
          </div>
          {r.reason ? (
            <p className="mb-1 text-[11px] text-[var(--color-ink-2)]">«{r.reason}»</p>
          ) : null}
          <pre className="whitespace-pre-wrap font-sans text-[11px] leading-relaxed text-[var(--color-ink-3)]">
            {r.diff_summary || '—'}
          </pre>
        </div>
      ))}
    </div>
  );
}

/* ---------------- comments ---------------- */

function CommentsTab({ detail, onChanged }: { detail: Detail; onChanged: () => void }) {
  const [message, setMessage] = React.useState('');
  const [author, setAuthor] = React.useState('Editor');
  const [busy, setBusy] = React.useState(false);

  const post = async (sendToAi: boolean) => {
    if (!message.trim()) return;
    setBusy(true);
    try {
      const res = await api<{ ai: { text: string } | null }>(
        `/api/units/${detail.unit.id}/comments`,
        { method: 'POST', json: { message, author, send_to_ai: sendToAi } },
      );
      setMessage('');
      if (res.ai) toast.success('AI применил правку', { description: res.ai.text.slice(0, 140) });
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не удалось');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 divide-y divide-[var(--color-line)]">
        {detail.comments.map((c) => (
          <div key={c.id} className="p-3">
            <div className="mb-1 flex items-center gap-1.5">
              <span className="text-[11px] font-semibold">{c.author}</span>
              <span className="text-[10px] text-[var(--color-ink-3)]">{c.author_role}</span>
              <span className="text-[10px] text-[var(--color-ink-3)]">
                {relativeTime(c.created_at)}
              </span>
              {c.ai_invoked ? (
                <span className="flex items-center gap-0.5 rounded bg-[var(--color-accent-soft)] px-1 text-[9px] font-semibold text-[var(--color-accent)]">
                  <Sparkles className="h-2.5 w-2.5" /> AI
                </span>
              ) : null}
            </div>
            <p className="text-[12px] leading-relaxed text-[var(--color-ink)]">{c.message}</p>
            {c.ai_response ? (
              <div className="mt-1.5 rounded-md border-l-2 border-[var(--color-accent)] bg-[var(--color-surface-2)] px-2 py-1.5">
                <pre className="whitespace-pre-wrap font-sans text-[11px] leading-relaxed text-[var(--color-ink-2)]">
                  {c.ai_response}
                </pre>
                {c.revision_id ? (
                  <p className="mt-1 text-[10px] text-[var(--color-ink-3)]">
                    Создана ревизия — откатить можно во вкладке Activity.
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        ))}
        {!detail.comments.length ? (
          <div className="p-4 text-[12px] text-[var(--color-ink-3)]">
            Комментариев нет. Обычный комментарий AI не вызывает; напишите{' '}
            <code className="rounded bg-[var(--color-surface-2)] px-1">@ai</code> или нажмите Send to
            AI.
          </div>
        ) : null}
      </div>

      <div className="sticky bottom-0 border-t border-[var(--color-line)] bg-[var(--color-surface)] p-3">
        <div className="mb-1.5 flex items-center gap-1.5">
          <Input
            className="h-7 w-32"
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
            placeholder="Имя"
          />
          <span className="text-[10.5px] text-[var(--color-ink-3)]">пишет комментарий</span>
        </div>
        <Textarea
          rows={2}
          placeholder="Комментарий для команды. @ai — чтобы AI применил правку."
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
        <div className="mt-1.5 flex justify-end gap-1.5">
          <Button size="sm" onClick={() => post(false)} disabled={busy || !message.trim()}>
            Комментарий
          </Button>
          <Button
            variant="accent"
            size="sm"
            onClick={() => post(true)}
            disabled={busy || !message.trim()}
          >
            {busy ? <Spinner /> : <Sparkles className="h-3 w-3" />} Send to AI
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- card chat ---------------- */

function UnitChat({
  unitId,
  busy,
  setBusy,
  onChanged,
}: {
  unitId: string;
  busy: boolean;
  setBusy: (b: boolean) => void;
  onChanged: () => void;
}) {
  const [input, setInput] = React.useState('');
  const [lastReply, setLastReply] = React.useState<string | null>(null);

  const send = async () => {
    const message = input.trim();
    if (!message) return;
    setInput('');
    setBusy(true);
    setLastReply(null);
    try {
      const res = await api<{ text: string }>('/api/ai/chat', {
        method: 'POST',
        json: { message, scope: { kind: 'content_unit', unitId } },
      });
      setLastReply(res.text);
      onChanged();
    } catch (e) {
      setLastReply(`Ошибка: ${e instanceof Error ? e.message : 'AI недоступен'}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="shrink-0 border-t border-[var(--color-line)] bg-[var(--color-surface-2)] p-3">
      {lastReply ? (
        <pre className="mb-2 max-h-40 overflow-y-auto whitespace-pre-wrap rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] p-2 font-sans text-[11.5px] leading-relaxed text-[var(--color-ink-2)]">
          {lastReply}
        </pre>
      ) : null}
      <div className="flex items-end gap-1.5">
        <Textarea
          rows={1}
          className="min-h-[32px] py-1.5"
          placeholder="Скажите, что изменить в этой карточке…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <Button variant="primary" size="sm" onClick={send} disabled={busy || !input.trim()}>
          {busy ? <Spinner /> : <Send className="h-3 w-3" />}
        </Button>
      </div>
      <p className="mt-1 text-[10px] text-[var(--color-ink-3)]">
        Меняется только эта карточка. Каждая правка создаёт ревизию.
      </p>
    </div>
  );
}
