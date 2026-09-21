'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { Check, AlertTriangle, Plus, Trash2 } from 'lucide-react';
import { useAppState, api } from '@/components/data';
import { ROLES, type Role } from '@/lib/domain/enums';
import { Button, Card, Input, SectionTitle, Select, Spinner } from '@/components/ui/primitives';
import { PageHeader } from '@/components/shell/PageHeader';
import { cn, relativeTime } from '@/lib/utils';

export function SettingsPage() {
  const { state, loading, refresh } = useAppState();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [email, setEmail] = React.useState('');
  const [role, setRole] = React.useState<Role>('EDITOR');

  if (loading || !state) {
    return (
      <div className="flex h-full items-center justify-center text-[var(--color-ink-3)]">
        <Spinner />
      </div>
    );
  }

  const { integrations } = state;

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    try {
      await fn();
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не удалось');
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <PageHeader title="Settings" subtitle="Интеграции, команда, demo-данные" />

      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <div className="mx-auto max-w-[760px] space-y-4">
          <Card className="p-4">
            <SectionTitle>Integrations</SectionTitle>
            <div className="space-y-2">
              <IntegrationRow
                ok={integrations.supabase}
                name="Supabase"
                detail={
                  integrations.supabase
                    ? `Postgres + Storage · store: ${integrations.storeKind}`
                    : 'Не настроено. Приложение работает на локальном файловом хранилище — добавьте NEXT_PUBLIC_SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY.'
                }
              />
              <IntegrationRow
                ok={integrations.ai.live}
                name={`AI provider — ${integrations.ai.provider}`}
                detail={
                  integrations.ai.live
                    ? `planner: ${integrations.ai.models.planner} · review: ${integrations.ai.models.review} · vision: ${integrations.ai.models.vision}`
                    : `${integrations.ai.reason}. Планирование, review и правки карточек работают детерминированно; извлечение метрик со скриншотов требует vision-модели.`
                }
              />
              <IntegrationRow
                ok={integrations.github}
                name="GitHub durable sync"
                detail={
                  integrations.github
                    ? `Пишет в ${integrations.githubTarget}`
                    : 'Токена нет — snapshot пишется в локальную папку в том же формате. Добавьте GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO.'
                }
              />
            </div>
          </Card>

          <Card className="p-4">
            <SectionTitle>GitHub data branch</SectionTitle>
            <p className="mb-2 text-[11.5px] text-[var(--color-ink-2)]">
              Состояние контента пишется в отдельную ветку{' '}
              <code className="rounded bg-[var(--color-surface-2)] px-1">
                {integrations.githubTarget}
              </code>
              , чтобы коммиты контента не запускали деплой. Ветка создаётся автоматически, если её
              нет.
            </p>
            <Button
              size="sm"
              disabled={busy !== null}
              onClick={() =>
                run('branch', async () => {
                  const res = await api<{ ok: boolean; target: string; error?: string }>(
                    '/api/setup',
                    { method: 'POST', json: { action: 'init_branch' } },
                  );
                  if (res.ok) toast.success(`Ветка готова: ${res.target}`);
                  else toast.error(res.error ?? 'Не удалось');
                })
              }
            >
              {busy === 'branch' ? <Spinner /> : null} Initialize / verify branch
            </Button>

            {state.syncLog.length ? (
              <div className="mt-3 space-y-1">
                {state.syncLog.slice(0, 5).map((s) => (
                  <div key={s.id} className="flex items-center gap-2 text-[11px]">
                    <span
                      className={cn(
                        'h-1.5 w-1.5 shrink-0 rounded-full',
                        s.status === 'ok'
                          ? 'bg-[#0e9f6e]'
                          : s.status === 'failed'
                            ? 'bg-[#b42318]'
                            : 'bg-[var(--color-ink-3)]',
                      )}
                    />
                    <span className="min-w-0 flex-1 truncate text-[var(--color-ink-2)]">
                      {s.message}
                    </span>
                    <span className="shrink-0 text-[var(--color-ink-3)] numeric">
                      {s.files.length} файлов
                    </span>
                    <span className="shrink-0 text-[var(--color-ink-3)]">
                      {relativeTime(s.created_at)}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
          </Card>

          <Card className="p-4">
            <SectionTitle>Workspace members</SectionTitle>
            <div className="mb-3 space-y-1">
              {state.members.map((m) => (
                <div
                  key={m.id}
                  className="flex items-center gap-2 rounded-md border border-[var(--color-line)] px-2.5 py-1.5 text-[11.5px]"
                >
                  <span className="font-medium">{m.name}</span>
                  <span className="text-[var(--color-ink-3)]">{m.email}</span>
                  <span className="ml-auto rounded bg-[var(--color-surface-2)] px-1.5 py-[1px] text-[10px] font-semibold text-[var(--color-ink-2)]">
                    {m.role}
                  </span>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-1.5">
              <Input
                placeholder="email@team.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <Select className="w-[110px]" value={role} onChange={(e) => setRole(e.target.value as Role)}>
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </Select>
              <Button
                size="sm"
                disabled={!email.trim() || busy !== null}
                onClick={() =>
                  run('member', async () => {
                    await api('/api/setup', {
                      method: 'POST',
                      json: { action: 'add_member', email, role },
                    });
                    setEmail('');
                    toast.success('Участник добавлен');
                  })
                }
              >
                <Plus className="h-3 w-3" /> Invite
              </Button>
            </div>
            <p className="mt-1.5 text-[10.5px] text-[var(--color-ink-3)]">
              OWNER подтверждает изменения фундаментальной стратегии. EDITOR редактирует контент и
              комментарии. VIEWER — только чтение.
            </p>
          </Card>

          <Card className="p-4">
            <SectionTitle>Demo data</SectionTitle>
            <p className="mb-2 text-[11.5px] text-[var(--color-ink-2)]">
              Создаёт V027 и примерную неделю тем же планировщиком, что работает в проде. Очистка
              удаляет весь контент, но не трогает постоянные документы контекста.
            </p>
            <div className="flex gap-1.5">
              <Button
                size="sm"
                disabled={busy !== null}
                onClick={() =>
                  run('seed', async () => {
                    await api('/api/demo', { method: 'POST', json: { action: 'seed' } });
                    toast.success('Demo-данные созданы');
                  })
                }
              >
                {busy === 'seed' ? <Spinner /> : null} Seed demo data
              </Button>
              <Button
                variant="danger"
                size="sm"
                disabled={busy !== null}
                onClick={() => {
                  if (!confirm('Удалить весь контент workspace? Документы контекста останутся.'))
                    return;
                  void run('clear', async () => {
                    await api('/api/demo', { method: 'POST', json: { action: 'clear' } });
                    toast.success('Контент очищен');
                  });
                }}
              >
                {busy === 'clear' ? <Spinner /> : <Trash2 className="h-3 w-3" />} Clear all content
              </Button>
            </div>
          </Card>

          <Card className="p-4">
            <SectionTitle>Environment</SectionTitle>
            <p className="text-[11.5px] leading-relaxed text-[var(--color-ink-2)]">
              Ключи задаются только через переменные окружения — приложение их не хранит и не
              показывает. Полный список в{' '}
              <code className="rounded bg-[var(--color-surface-2)] px-1">.env.example</code>:
              Supabase, AI_PROVIDER + ключи, три роли моделей (planner / review / vision) и GitHub.
            </p>
          </Card>
        </div>
      </div>
    </>
  );
}

function IntegrationRow({ ok, name, detail }: { ok: boolean; name: string; detail: string }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-[var(--color-line)] p-2.5">
      <span
        className={cn(
          'mt-[2px] flex h-4 w-4 shrink-0 items-center justify-center rounded-full',
          ok ? 'bg-[#eefaf5] text-[#087f55]' : 'bg-[#fdf6ec] text-[#b54708]',
        )}
      >
        {ok ? <Check className="h-2.5 w-2.5" /> : <AlertTriangle className="h-2.5 w-2.5" />}
      </span>
      <div className="min-w-0">
        <p className="text-[12px] font-medium">{name}</p>
        <p className="text-[11px] leading-relaxed text-[var(--color-ink-3)]">{detail}</p>
      </div>
    </div>
  );
}
