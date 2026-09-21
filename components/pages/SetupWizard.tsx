'use client';

import * as React from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Check, AlertTriangle, ArrowRight } from 'lucide-react';
import { api } from '@/components/data';
import { Button, Card, Input, Select, Spinner } from '@/components/ui/primitives';
import { ROLES, type Role } from '@/lib/domain/enums';
import { cn } from '@/lib/utils';

type SetupState = {
  workspace: { name: string; setup_complete: boolean };
  integrations: {
    supabase: boolean;
    github: boolean;
    githubTarget: string;
    storeKind: string;
    ai: { live: boolean; provider: string; reason: string; models: Record<string, string> };
  };
  docs: Array<{ slug: string; imported: boolean; chars: number }>;
};

/**
 * First-run wizard. Deliberately non-blocking: every step reports what is
 * connected, and the app stays fully usable on local adapters if nothing is.
 */
export function SetupWizard() {
  const [state, setState] = React.useState<SetupState | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [email, setEmail] = React.useState('');
  const [role, setRole] = React.useState<Role>('EDITOR');

  const load = React.useCallback(async () => {
    setState(await api<SetupState>('/api/setup'));
  }, []);

  React.useEffect(() => {
    // Data fetch: state is set after the await, so no cascading render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  if (!state) {
    return (
      <div className="flex h-screen items-center justify-center text-[var(--color-ink-3)]">
        <Spinner />
      </div>
    );
  }

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не удалось');
    } finally {
      setBusy(null);
    }
  };

  const missingDocs = state.docs.filter((d) => !d.imported);

  return (
    <div className="h-screen overflow-y-auto bg-[var(--color-canvas)]">
      <div className="mx-auto max-w-[680px] px-6 py-10">
        <div className="mb-6">
          <div className="mb-2 flex h-7 w-7 items-center justify-center rounded bg-[var(--color-ink)] text-[13px] font-bold text-white">
            S
          </div>
          <h1 className="text-[20px] font-semibold tracking-tight">Sweater Man Content OS</h1>
          <p className="mt-1 text-[12.5px] text-[var(--color-ink-2)]">
            Разовая настройка. После неё вы больше не загружаете MD-файлы и не объясняете проект
            заново — контекст живёт под интерфейсом.
          </p>
        </div>

        <div className="space-y-3">
          <Step
            n={1}
            title="Supabase"
            done={state.integrations.supabase}
            detail={
              state.integrations.supabase
                ? 'Postgres + Storage подключены.'
                : 'Не подключено. Приложение работает на локальном файловом хранилище — этого достаточно, чтобы всё попробовать. Для команды добавьте NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY и примените миграции из supabase/migrations.'
            }
          />

          <Step
            n={2}
            title="GitHub durable state"
            done={state.integrations.github}
            detail={
              state.integrations.github
                ? `Пишет snapshot в ${state.integrations.githubTarget}.`
                : 'Токена нет. Snapshot пишется локально в том же формате, что и в ветке content-state.'
            }
            action={
              <Button
                size="sm"
                disabled={busy !== null}
                onClick={() =>
                  run('branch', async () => {
                    const res = await api<{ ok: boolean; target: string; error?: string }>(
                      '/api/setup',
                      { method: 'POST', json: { action: 'init_branch' } },
                    );
                    if (res.ok) toast.success(`Готово: ${res.target}`);
                    else toast.error(res.error ?? 'Не удалось');
                  })
                }
              >
                {busy === 'branch' ? <Spinner /> : null} Создать ветку content-state
              </Button>
            }
          />

          <Step
            n={3}
            title="Импорт постоянного контекста"
            done={missingDocs.length === 0}
            detail={
              missingDocs.length === 0
                ? state.docs.map((d) => `${d.slug} (${Math.round(d.chars / 1000)}k)`).join(' · ')
                : `Не найдены: ${missingDocs.map((d) => d.slug).join(', ')}. Положите файлы в seed/ и повторите импорт.`
            }
            action={
              <Button
                size="sm"
                disabled={busy !== null}
                onClick={() =>
                  run('import', async () => {
                    const res = await api<{ imported: string[]; missing: string[] }>('/api/setup', {
                      method: 'POST',
                      json: { action: 'import_context' },
                    });
                    toast.success(`Импортировано: ${res.imported.join(', ')}`);
                  })
                }
              >
                {busy === 'import' ? <Spinner /> : null} Импортировать из seed/
              </Button>
            }
          />

          <Step
            n={4}
            title="AI provider"
            done={state.integrations.ai.live}
            detail={
              state.integrations.ai.live
                ? `${state.integrations.ai.provider} · planner ${state.integrations.ai.models.planner} · review ${state.integrations.ai.models.review} · vision ${state.integrations.ai.models.vision}`
                : `${state.integrations.ai.reason}. Планирование недели, weekly review и правки карточек работают; свободная генерация текста и чтение скриншотов — нет.`
            }
          />

          <Step n={5} title="Команда" done detail="Owner создан автоматически. Пригласите остальных.">
            <div className="flex items-center gap-1.5">
              <Input
                placeholder="email@team.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <Select
                className="w-[110px]"
                value={role}
                onChange={(e) => setRole(e.target.value as Role)}
              >
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
                    toast.success('Приглашён');
                  })
                }
              >
                Invite
              </Button>
            </div>
          </Step>
        </div>

        <Card className="mt-5 flex items-center justify-between p-4">
          <div>
            <p className="text-[12.5px] font-medium">Всё готово</p>
            <p className="text-[11.5px] text-[var(--color-ink-3)]">
              Откройте Week и напишите «Новая неделя, обнови план».
            </p>
          </div>
          <Link href="/week">
            <Button
              variant="primary"
              size="md"
              onClick={() =>
                void api('/api/setup', { method: 'POST', json: { action: 'complete' } })
              }
            >
              Открыть Week <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </Link>
        </Card>
      </div>
    </div>
  );
}

function Step({
  n,
  title,
  detail,
  done,
  action,
  children,
}: {
  n: number;
  title: string;
  detail: string;
  done: boolean;
  action?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <span
          className={cn(
            'mt-[1px] flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold',
            done ? 'bg-[#eefaf5] text-[#087f55]' : 'bg-[#fdf6ec] text-[#b54708]',
          )}
        >
          {done ? <Check className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="text-[10px] font-semibold text-[var(--color-ink-3)] numeric">
              {n}
            </span>
            <h2 className="text-[13px] font-semibold tracking-tight">{title}</h2>
          </div>
          <p className="mt-1 text-[11.5px] leading-relaxed text-[var(--color-ink-2)]">{detail}</p>
          {action || children ? <div className="mt-2.5">{action ?? children}</div> : null}
        </div>
      </div>
    </Card>
  );
}
