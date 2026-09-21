/**
 * Every integration is optional. The app must boot and be usable with an
 * empty .env — it falls back to local adapters and says so in the UI.
 *
 * Values are read through getters rather than snapshotted at import time:
 * a module-load snapshot silently ignores anything that configures the
 * process after the first import (tests, scripts, runtime reconfiguration).
 */

const str = (key: string, fallback = ''): string => (process.env[key] ?? '').trim() || fallback;

export const env = {
  get supabaseUrl() {
    return str('NEXT_PUBLIC_SUPABASE_URL');
  },
  get supabaseAnonKey() {
    return str('NEXT_PUBLIC_SUPABASE_ANON_KEY');
  },
  get supabaseServiceKey() {
    return str('SUPABASE_SERVICE_ROLE_KEY');
  },

  get aiProvider() {
    return str('AI_PROVIDER', 'anthropic');
  },
  get anthropicKey() {
    return str('ANTHROPIC_API_KEY');
  },
  get openaiKey() {
    return str('OPENAI_API_KEY');
  },
  get modelPlanner() {
    return str('AI_MODEL_PLANNER');
  },
  get modelReview() {
    return str('AI_MODEL_REVIEW');
  },
  get modelVision() {
    return str('AI_MODEL_VISION');
  },

  get githubToken() {
    return str('GITHUB_TOKEN');
  },
  get githubOwner() {
    return str('GITHUB_OWNER');
  },
  get githubRepo() {
    return str('GITHUB_REPO');
  },
  get githubBranch() {
    return str('GITHUB_DATA_BRANCH', 'content-state');
  },
  /** Set to "local" to force the file-based snapshot even when a token exists. */
  get githubSyncMode() {
    return str('GITHUB_SYNC');
  },

  get dataDir() {
    return str('CONTENT_OS_DATA_DIR', '.localdata/dev');
  },
  get devUser() {
    return str('CONTENT_OS_DEV_USER', 'Owner');
  },
};

export const hasSupabase = (): boolean => Boolean(env.supabaseUrl && env.supabaseServiceKey);

export const hasGithub = (): boolean =>
  env.githubSyncMode !== 'local' &&
  Boolean(env.githubToken && env.githubOwner && env.githubRepo);

export const hasAiKey = (): boolean => {
  if (env.aiProvider === 'mock') return false;
  if (env.aiProvider === 'openai') return Boolean(env.openaiKey);
  return Boolean(env.anthropicKey);
};
