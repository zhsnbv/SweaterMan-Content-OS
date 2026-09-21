import 'server-only';
import { getStore, type Store } from '@/lib/store';
import { ensureBootstrapped } from '@/lib/services/bootstrap';
import { env, hasGithub, hasSupabase } from '@/lib/env';
import { getAiConfig } from '@/lib/ai/config';
import { DEFAULT_WORKSPACE_ID } from '@/lib/store/defaults';

let bootPromise: Promise<unknown> | null = null;

/**
 * Every server entry point goes through here: it guarantees the workspace and
 * the persistent context docs exist before anything reads them.
 */
export async function ctx(): Promise<{ store: Store; workspaceId: string; actor: string }> {
  const store = getStore();
  bootPromise ??= ensureBootstrapped(store);
  await bootPromise;
  return { store, workspaceId: DEFAULT_WORKSPACE_ID, actor: await currentActor(store) };
}

/**
 * V1 auth: Supabase Auth when configured, otherwise a single local owner so
 * the app is usable immediately. The role gate below is the same either way.
 */
async function currentActor(store: Store): Promise<string> {
  if (!hasSupabase()) return env.devUser;
  const members = await store.listMembers();
  return members.find((m) => m.role === 'OWNER')?.name ?? env.devUser;
}

export async function integrationStatus() {
  const ai = getAiConfig();
  return {
    supabase: hasSupabase(),
    github: hasGithub(),
    githubTarget: hasGithub()
      ? `${env.githubOwner}/${env.githubRepo}@${env.githubBranch}`
      : 'local snapshot',
    ai: { live: ai.live, provider: ai.provider, reason: ai.reason, models: ai.models },
    storeKind: getStore().kind,
  };
}

export function jsonError(message: string, status = 400): Response {
  return Response.json({ error: message }, { status });
}
