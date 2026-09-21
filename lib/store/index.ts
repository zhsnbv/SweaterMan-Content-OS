import path from 'node:path';
import { env, hasSupabase } from '@/lib/env';
import { LocalStore } from './local';
import { SupabaseStore } from './supabase';
import type { Store } from './types';

let cached: Store | null = null;
let cachedKey = '';

/**
 * Resolves the store once per process. Supabase when credentials exist,
 * otherwise a file-backed store so the app is fully usable out of the box.
 */
export function getStore(): Store {
  const key = hasSupabase() ? `supabase:${env.supabaseUrl}` : `local:${env.dataDir}`;
  if (cached && cachedKey === key) return cached;
  cached = hasSupabase()
    ? new SupabaseStore(env.supabaseUrl, env.supabaseServiceKey)
    : // dev-only fallback; its data dir is runtime config, not bundled content
      new LocalStore(path.resolve(/* turbopackIgnore: true */ process.cwd(), env.dataDir));
  cachedKey = key;
  return cached;
}

/** Test helper: build an isolated local store. */
export function createLocalStore(dir: string): Store {
  return new LocalStore(dir);
}

export type { Store };
