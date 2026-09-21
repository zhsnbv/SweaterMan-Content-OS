'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { Check, RefreshCw, AlertTriangle } from 'lucide-react';
import type { SyncLogEntry } from '@/lib/domain/schema';
import { cn, relativeTime } from '@/lib/utils';
import { api } from '@/components/data';
import { Spinner } from '@/components/ui/primitives';

type SyncState = 'idle' | 'pending' | 'ok' | 'failed';

const STYLE: Record<SyncState, string> = {
  ok: 'border-[#c9ece0] bg-[#eefaf5] text-[#087f55]',
  failed: 'border-[#fecdca] bg-[#fef3f2] text-[#b42318]',
  pending: 'border-[var(--color-line)] text-[var(--color-ink-3)]',
  idle: 'border-[var(--color-line)] text-[var(--color-ink-3)]',
};

const LABEL: Record<SyncState, string> = {
  ok: 'Synced',
  failed: 'Sync failed — retry',
  pending: 'Syncing…',
  idle: 'Sync',
};

const ICON: Record<SyncState, React.ReactNode> = {
  ok: <Check className="h-3 w-3" />,
  failed: <AlertTriangle className="h-3 w-3" />,
  pending: <Spinner />,
  idle: <RefreshCw className="h-3 w-3" />,
};

export function SyncStatus({
  log,
  target,
  onRefresh,
}: {
  log: SyncLogEntry[];
  target: string;
  onRefresh: () => void;
}) {
  const [busy, setBusy] = React.useState(false);
  const latest = log.length ? log[0] : null;
  const state: SyncState = busy ? 'pending' : latest ? latest.status : 'idle';

  const retry = async () => {
    setBusy(true);
    try {
      const res = await api<{ ok: boolean; error: string | null }>('/api/sync', {
        method: 'POST',
        json: { message: 'content: manual sync' },
      });
      if (res.ok) toast.success('Snapshot сохранён');
      else toast.error(`Sync failed: ${res.error}`);
      onRefresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      onClick={retry}
      disabled={busy}
      title={`${target}${latest ? ` · ${latest.message} · ${relativeTime(latest.created_at)}` : ''}`}
      className={cn(
        'flex items-center gap-1 rounded-md border px-1.5 py-1 text-[10.5px] font-medium transition-colors',
        STYLE[state],
      )}
    >
      {ICON[state]}
      <span>{LABEL[state]}</span>
    </button>
  );
}
