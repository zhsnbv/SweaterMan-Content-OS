'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { X, Upload, Plus } from 'lucide-react';
import type { AnalyticsReport, ContentUnit, MetricValue } from '@/lib/domain/schema';
import {
  METRIC_KEYS,
  METRIC_LABEL,
  type AnalyticsWindow,
  type MetricKey,
  type Platform,
} from '@/lib/domain/enums';
import { Button, Input, Label, Select, Spinner, Textarea } from '@/components/ui/primitives';
import { PlatformIcon } from '@/components/ui/tokens';
import { api } from '@/components/data';

/**
 * Two-step, deliberately manual flow:
 *  1. upload screenshot(s) → the vision model extracts ONLY visible numbers
 *  2. the user reviews and corrects them, and only then are they confirmed
 * Nothing unconfirmed ever reaches the learning engine.
 */
export function ReportDialog({
  unit,
  window: reportWindow,
  onClose,
  onDone,
}: {
  unit: ContentUnit;
  window: AnalyticsWindow;
  onClose: () => void;
  onDone: () => void;
}) {
  const publishedVariants = unit.platforms.filter((p) => p.publish_status === 'published');
  const [platform, setPlatform] = React.useState<Platform>(
    (publishedVariants[0]?.platform ?? 'instagram') as Platform,
  );
  const [files, setFiles] = React.useState<File[]>([]);
  const [notes, setNotes] = React.useState('');
  const [step, setStep] = React.useState<'upload' | 'confirm'>('upload');
  const [busy, setBusy] = React.useState(false);
  const [report, setReport] = React.useState<AnalyticsReport | null>(null);
  const [extractNote, setExtractNote] = React.useState('');
  const [observation, setObservation] = React.useState('');
  const [rows, setRows] = React.useState<MetricValue[]>([]);

  const upload = async () => {
    setBusy(true);
    try {
      const form = new FormData();
      form.set('platform', platform);
      form.set('window', reportWindow);
      form.set('user_notes', notes);
      form.set(
        'publish_url',
        unit.platforms.find((p) => p.platform === platform)?.publish_url ?? '',
      );
      for (const f of files) form.append('screenshots', f);

      const res = await api<{
        report: AnalyticsReport;
        note: string;
        preview_observation: string;
      }>(`/api/units/${unit.id}/reports`, { method: 'POST', body: form });

      setReport(res.report);
      setExtractNote(res.note);
      setObservation(res.preview_observation);
      setRows(
        res.report.extracted_metrics.length
          ? res.report.extracted_metrics
          : [{ key: 'views', value: null, raw: '' }],
      );
      setStep('confirm');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не удалось загрузить');
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!report) return;
    setBusy(true);
    try {
      await api(`/api/reports/${report.id}/confirm`, {
        method: 'POST',
        json: { metrics: rows, user_notes: notes },
      });
      toast.success(`${reportWindow} report сохранён`);
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не удалось сохранить');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-6">
      <div className="fade-in absolute inset-0 bg-[#17171b]/25" onClick={onClose} />
      <div className="relative flex max-h-[86vh] w-[520px] flex-col overflow-hidden rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] shadow-xl">
        <div className="flex items-center justify-between border-b border-[var(--color-line)] px-4 py-3">
          <div>
            <h3 className="text-[13px] font-semibold">
              {reportWindow} report · {unit.id}
            </h3>
            <p className="text-[11px] text-[var(--color-ink-3)]">
              {step === 'upload'
                ? 'Загрузите скриншот аналитики — цифры будут извлечены и показаны на проверку.'
                : 'Проверьте и исправьте. Сохраняются только подтверждённые значения.'}
            </p>
          </div>
          <Button variant="ghost" size="xs" onClick={onClose}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {step === 'upload' ? (
            <div className="space-y-3">
              <div>
                <Label>Платформа</Label>
                <Select value={platform} onChange={(e) => setPlatform(e.target.value as Platform)}>
                  {(publishedVariants.length ? publishedVariants : unit.platforms).map((p) => (
                    <option key={p.id} value={p.platform}>
                      {p.platform} / {p.surface}
                    </option>
                  ))}
                </Select>
              </div>

              <div>
                <Label>Скриншоты аналитики</Label>
                <label className="flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-md border border-dashed border-[var(--color-line-strong)] px-4 py-6 text-center hover:bg-[var(--color-surface-2)]">
                  <Upload className="h-4 w-4 text-[var(--color-ink-3)]" />
                  <span className="text-[11.5px] text-[var(--color-ink-2)]">
                    {files.length ? `${files.length} файл(ов) выбрано` : 'Выбрать изображения'}
                  </span>
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
                  />
                </label>
                <p className="mt-1 text-[10.5px] text-[var(--color-ink-3)]">
                  Изображение хранится в Storage. В Git попадают только путь и структурированные
                  метрики.
                </p>
              </div>

              <div>
                <Label>Заметки</Label>
                <Textarea
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Что стоит помнить про этот замер"
                />
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {extractNote ? (
                <p className="rounded-md border border-[var(--color-line)] bg-[var(--color-surface-2)] p-2 text-[11px] text-[var(--color-ink-2)]">
                  {extractNote}
                </p>
              ) : null}

              <div className="space-y-1.5">
                {rows.map((row, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <Select
                      className="w-[52%]"
                      value={row.key}
                      onChange={(e) =>
                        setRows(
                          rows.map((r, j) =>
                            j === i ? { ...r, key: e.target.value as MetricKey } : r,
                          ),
                        )
                      }
                    >
                      {METRIC_KEYS.map((k) => (
                        <option key={k} value={k}>
                          {METRIC_LABEL[k]}
                        </option>
                      ))}
                    </Select>
                    <Input
                      className="flex-1 numeric"
                      placeholder="NA"
                      value={row.value === null ? '' : String(row.value)}
                      onChange={(e) => {
                        const raw = e.target.value.trim();
                        const num = raw === '' ? null : Number(raw.replace(/\s/g, ''));
                        setRows(
                          rows.map((r, j) =>
                            j === i
                              ? { ...r, value: num !== null && Number.isFinite(num) ? num : null }
                              : r,
                          ),
                        );
                      }}
                    />
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => setRows(rows.filter((_, j) => j !== i))}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() =>
                    setRows([
                      ...rows,
                      {
                        key: (METRIC_KEYS.find((k) => !rows.some((r) => r.key === k)) ??
                          'views') as MetricKey,
                        value: null,
                        raw: '',
                      },
                    ])
                  }
                >
                  <Plus className="h-3 w-3" /> Добавить метрику
                </Button>
              </div>

              <p className="text-[10.5px] text-[var(--color-ink-3)]">
                Пустое поле = NA. Система никогда не подставляет недостающие значения сама.
              </p>

              {observation ? (
                <p className="rounded-md border-l-2 border-[var(--color-accent)] bg-[var(--color-surface-2)] px-2 py-1.5 text-[11px] italic text-[var(--color-ink-2)]">
                  {observation}
                </p>
              ) : null}

              {report?.screenshots.length ? (
                <div className="flex gap-1.5">
                  {report.screenshots.map((s) => (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      key={s}
                      src={s}
                      alt="screenshot"
                      className="h-20 rounded border border-[var(--color-line)]"
                    />
                  ))}
                </div>
              ) : null}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-[var(--color-line)] px-4 py-3">
          <div className="flex items-center gap-1.5 text-[11px] text-[var(--color-ink-3)]">
            <PlatformIcon platform={platform} />
            <span>{reportWindow}</span>
          </div>
          <div className="flex gap-1.5">
            <Button variant="ghost" size="sm" onClick={onClose}>
              Отмена
            </Button>
            {step === 'upload' ? (
              <Button variant="accent" size="sm" onClick={upload} disabled={busy}>
                {busy ? <Spinner /> : null} Извлечь метрики
              </Button>
            ) : (
              <Button variant="accent" size="sm" onClick={confirm} disabled={busy}>
                {busy ? <Spinner /> : null} Подтвердить и сохранить
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
