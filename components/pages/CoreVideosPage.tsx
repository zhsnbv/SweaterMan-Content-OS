'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { Plus, X } from 'lucide-react';
import { useAppState, api } from '@/components/data';
import { CORE_VIDEO_STAGES, type CoreVideoStage } from '@/lib/domain/enums';
import type { CoreVideo } from '@/lib/domain/schema';
import {
  Button,
  Drawer,
  EmptyState,
  Input,
  Label,
  SectionTitle,
  Select,
  Spinner,
  Textarea,
} from '@/components/ui/primitives';
import { PageHeader } from '@/components/shell/PageHeader';
import { cn } from '@/lib/utils';

const STAGE_LABEL: Record<CoreVideoStage, string> = {
  idea: 'Idea',
  research: 'Research',
  storyboard: 'Storyboard',
  shooting: 'Shooting',
  assets: 'Assets',
  assembly: 'Assembly',
  capcut: 'CapCut',
  ready: 'Ready',
  published: 'Published',
};

export function CoreVideosPage() {
  const { state, loading, refresh } = useAppState();
  const [open, setOpen] = React.useState<string | null>(null);
  const [creating, setCreating] = React.useState(false);

  if (loading || !state) {
    return (
      <div className="flex h-full items-center justify-center text-[var(--color-ink-3)]">
        <Spinner />
      </div>
    );
  }

  const byStage = (stage: CoreVideoStage) => state.coreVideos.filter((v) => v.production_stage === stage);
  const selected = state.coreVideos.find((v) => v.id === open) ?? null;

  return (
    <>
      <PageHeader
        title="Core videos"
        subtitle={`${state.coreVideos.length} в системе · pipeline от идеи до публикации`}
        actions={
          <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
            <Plus className="h-3 w-3" /> Add core video
          </Button>
        }
      />

      <div className="min-h-0 flex-1 overflow-x-auto p-3">
        {!state.coreVideos.length ? (
          <EmptyState
            title="Нет ни одного Core Video"
            hint="Планировщик строит supporting-контент из материалов производства. Добавьте ролик, укажите стадию и доступные ассеты — и неделя начнёт собираться из того, что реально есть."
            action={
              <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
                <Plus className="h-3 w-3" /> Add core video
              </Button>
            }
          />
        ) : (
          <div className="flex gap-2">
            {CORE_VIDEO_STAGES.map((stage) => {
              const items = byStage(stage);
              return (
                <div key={stage} className="flex w-[180px] shrink-0 flex-col">
                  <div className="flex items-baseline justify-between px-1 pb-1.5">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.07em] text-[var(--color-ink-3)]">
                      {STAGE_LABEL[stage]}
                    </span>
                    <span className="text-[10px] text-[var(--color-ink-3)] numeric">
                      {items.length || ''}
                    </span>
                  </div>
                  <div className="flex flex-1 flex-col gap-1.5 rounded-lg bg-[var(--color-surface-2)]/60 p-1">
                    {items.map((v) => (
                      <button
                        key={v.id}
                        onClick={() => setOpen(v.id)}
                        className="rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] p-2 text-left hover:border-[var(--color-line-strong)]"
                      >
                        <div className="mb-1 flex items-center gap-1.5">
                          <span className="font-mono text-[10px] font-semibold">{v.id}</span>
                          {v.planned_publish_date ? (
                            <span className="text-[9.5px] text-[var(--color-ink-3)] numeric">
                              {v.planned_publish_date}
                            </span>
                          ) : null}
                        </div>
                        <p className="text-[11.5px] font-medium leading-snug">{v.working_title}</p>
                        {v.available_assets.length ? (
                          <p className="mt-1 text-[10px] text-[var(--color-ink-3)]">
                            {v.available_assets.length} ассетов готово
                          </p>
                        ) : null}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {selected ? (
        <CoreVideoDrawer
          key={`${selected.id}:${selected.updated_at}`}
          video={selected}
          onClose={() => setOpen(null)}
          onChanged={() => refresh()}
        />
      ) : null}

      {creating ? (
        <CreateCoreVideo
          onClose={() => setCreating(false)}
          onCreated={async () => {
            setCreating(false);
            await refresh();
          }}
        />
      ) : null}
    </>
  );
}

function CoreVideoDrawer({
  video,
  onClose,
  onChanged,
}: {
  video: CoreVideo;
  onClose: () => void;
  onChanged: () => void;
}) {
  // Remounted by the parent on every save (key includes updated_at), so the
  // draft always starts from the persisted version — no reset effect needed.
  const [draft, setDraft] = React.useState(video);
  const [saving, setSaving] = React.useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await api(`/api/core-videos/${video.id}`, {
        method: 'PATCH',
        json: {
          working_title: draft.working_title,
          topic: draft.topic,
          cluster: draft.cluster,
          planned_publish_date: draft.planned_publish_date || null,
          production_stage: draft.production_stage,
          storyboard_text: draft.storyboard_text,
          storyboard_url: draft.storyboard_url,
          figma_url: draft.figma_url,
          production_notes: draft.production_notes,
          available_assets: draft.available_assets,
        },
      });
      toast.success('Сохранено');
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не удалось');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer open onClose={onClose} width="w-[560px]">
      <div className="flex items-start justify-between border-b border-[var(--color-line)] px-4 py-3">
        <div>
          <span className="font-mono text-[10px] text-[var(--color-ink-3)]">{video.id}</span>
          <h2 className="text-[14px] font-semibold tracking-tight">{video.working_title}</h2>
        </div>
        <Button variant="ghost" size="xs" onClick={onClose}>
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        <div>
          <Label>Working title</Label>
          <Input
            value={draft.working_title}
            onChange={(e) => setDraft({ ...draft, working_title: e.target.value })}
          />
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div>
            <Label>Stage</Label>
            <Select
              value={draft.production_stage}
              onChange={(e) =>
                setDraft({ ...draft, production_stage: e.target.value as CoreVideoStage })
              }
            >
              {CORE_VIDEO_STAGES.map((s) => (
                <option key={s} value={s}>
                  {STAGE_LABEL[s]}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Planned</Label>
            <Input
              type="date"
              value={draft.planned_publish_date ?? ''}
              onChange={(e) => setDraft({ ...draft, planned_publish_date: e.target.value })}
            />
          </div>
          <div>
            <Label>Cluster</Label>
            <Input
              value={draft.cluster}
              onChange={(e) => setDraft({ ...draft, cluster: e.target.value })}
            />
          </div>
        </div>

        <div>
          <Label>Topic</Label>
          <Textarea
            rows={2}
            value={draft.topic}
            onChange={(e) => setDraft({ ...draft, topic: e.target.value })}
          />
        </div>

        <div>
          <Label>Storyboard (текстовая раскадровка)</Label>
          <Textarea
            rows={10}
            className="font-mono text-[11.5px]"
            value={draft.storyboard_text}
            onChange={(e) => setDraft({ ...draft, storyboard_text: e.target.value })}
            placeholder="СЦЕНА 1. Что в кадре. Что говорит Sweater Man. Какие персонажи и фон нужны."
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label>Storyboard URL</Label>
            <Input
              value={draft.storyboard_url}
              onChange={(e) => setDraft({ ...draft, storyboard_url: e.target.value })}
            />
          </div>
          <div>
            <Label>Figma</Label>
            <Input
              value={draft.figma_url}
              onChange={(e) => setDraft({ ...draft, figma_url: e.target.value })}
            />
          </div>
        </div>

        <div>
          <SectionTitle>Available assets</SectionTitle>
          <div className="space-y-1">
            {draft.available_assets.map((a, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <Input
                  value={a.label}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      available_assets: draft.available_assets.map((x, j) =>
                        j === i ? { ...x, label: e.target.value } : x,
                      ),
                    })
                  }
                />
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() =>
                    setDraft({
                      ...draft,
                      available_assets: draft.available_assets.filter((_, j) => j !== i),
                    })
                  }
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            ))}
            <Button
              variant="ghost"
              size="xs"
              onClick={() =>
                setDraft({
                  ...draft,
                  available_assets: [
                    ...draft.available_assets,
                    { label: '', url: '', kind: 'asset' },
                  ],
                })
              }
            >
              <Plus className="h-3 w-3" /> Добавить ассет
            </Button>
          </div>
          <p className="mt-1 text-[10.5px] text-[var(--color-ink-3)]">
            Планировщик строит backstage-посты из того, что здесь перечислено.
          </p>
        </div>

        <div>
          <Label>Production notes</Label>
          <Textarea
            rows={3}
            value={draft.production_notes}
            onChange={(e) => setDraft({ ...draft, production_notes: e.target.value })}
          />
        </div>
      </div>

      <div className="flex justify-end gap-1.5 border-t border-[var(--color-line)] p-3">
        <Button variant="ghost" size="sm" onClick={onClose}>
          Закрыть
        </Button>
        <Button variant="primary" size="sm" onClick={save} disabled={saving}>
          {saving ? <Spinner /> : null} Сохранить
        </Button>
      </div>
    </Drawer>
  );
}

function CreateCoreVideo({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [title, setTitle] = React.useState('');
  const [topic, setTopic] = React.useState('');
  const [date, setDate] = React.useState('');
  const [stage, setStage] = React.useState<CoreVideoStage>('idea');
  const [busy, setBusy] = React.useState(false);

  const create = async () => {
    setBusy(true);
    try {
      await api('/api/core-videos', {
        method: 'POST',
        json: {
          working_title: title,
          topic,
          planned_publish_date: date || null,
          production_stage: stage,
        },
      });
      toast.success('Core video создан');
      onCreated();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не удалось');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-6">
      <div className="fade-in absolute inset-0 bg-[#17171b]/25" onClick={onClose} />
      <div className={cn('relative w-[420px] rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-4 shadow-xl')}>
        <h3 className="mb-3 text-[13px] font-semibold">Новый Core Video</h3>
        <div className="space-y-2.5">
          <div>
            <Label>Working title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
          </div>
          <div>
            <Label>Topic</Label>
            <Textarea rows={2} value={topic} onChange={(e) => setTopic(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Planned publish</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div>
              <Label>Stage</Label>
              <Select value={stage} onChange={(e) => setStage(e.target.value as CoreVideoStage)}>
                {CORE_VIDEO_STAGES.map((s) => (
                  <option key={s} value={s}>
                    {STAGE_LABEL[s]}
                  </option>
                ))}
              </Select>
            </div>
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-1.5">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Отмена
          </Button>
          <Button variant="primary" size="sm" onClick={create} disabled={busy || !title.trim()}>
            {busy ? <Spinner /> : null} Создать
          </Button>
        </div>
      </div>
    </div>
  );
}
