'use client';

import * as React from 'react';
import type {
  AnalyticsReport,
  BacklogItem,
  ContentUnit,
  ContextDoc,
  CoreVideo,
  Learning,
  Member,
  StrategyChange,
  StrategyState,
  SyncLogEntry,
  WeekPlan,
  WeeklyReview,
  Workspace,
} from '@/lib/domain/schema';

export type AppState = {
  workspaceId: string;
  workspace: Workspace;
  weekId: string;
  week: WeekPlan | null;
  units: ContentUnit[];
  weeks: string[];
  coreVideos: CoreVideo[];
  backlog: BacklogItem[];
  learnings: Learning[];
  reviews: WeeklyReview[];
  syncLog: SyncLogEntry[];
  contextDocs: ContextDoc[];
  strategyState: StrategyState;
  strategyChanges: StrategyChange[];
  members: Member[];
  reports: AnalyticsReport[];
  integrations: {
    supabase: boolean;
    github: boolean;
    githubTarget: string;
    storeKind: string;
    ai: { live: boolean; provider: string; reason: string; models: Record<string, string> };
  };
};

export function useAppState(weekId?: string) {
  const [state, setState] = React.useState<AppState | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const refresh = React.useCallback(
    async (nextWeek?: string) => {
      const week = nextWeek ?? weekId;
      try {
        const res = await fetch(`/api/state${week ? `?week=${week}` : ''}`, { cache: 'no-store' });
        if (!res.ok) throw new Error(`state ${res.status}`);
        setState(await res.json());
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Не удалось загрузить состояние');
      } finally {
        setLoading(false);
      }
    },
    [weekId],
  );

  React.useEffect(() => {
    // Data fetch: state is set after the await, so no cascading render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  return { state, loading, error, refresh, setState };
}

export async function api<T = any>(
  path: string,
  init?: RequestInit & { json?: unknown },
): Promise<T> {
  const { json, ...rest } = init ?? {};
  const res = await fetch(path, {
    ...rest,
    headers: json ? { 'content-type': 'application/json', ...(rest.headers ?? {}) } : rest.headers,
    body: json ? JSON.stringify(json) : rest.body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? `${res.status}`);
  return data as T;
}
