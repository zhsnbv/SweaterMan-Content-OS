import { env, hasAiKey } from '@/lib/env';

export type AiRole = 'planner' | 'review' | 'vision';

/**
 * Defaults are resolved here, never hardcoded in business logic, so swapping
 * a model is an env change. Business code asks for a role, not a model name.
 */
const FALLBACKS: Record<string, Record<AiRole, string>> = {
  anthropic: {
    planner: 'claude-sonnet-5',
    review: 'claude-opus-5',
    vision: 'claude-sonnet-5',
  },
  openai: {
    planner: 'gpt-5',
    review: 'gpt-5',
    vision: 'gpt-5',
  },
};

export type AiConfig = {
  provider: 'anthropic' | 'openai' | 'mock';
  models: Record<AiRole, string>;
  /** True when a real model will be called; false means the deterministic engine. */
  live: boolean;
  reason: string;
};

export function getAiConfig(): AiConfig {
  const requested = env.aiProvider as AiConfig['provider'];
  const provider: AiConfig['provider'] =
    requested === 'openai' || requested === 'anthropic' || requested === 'mock'
      ? requested
      : 'anthropic';

  const live = provider !== 'mock' && hasAiKey();
  const base = FALLBACKS[provider] ?? FALLBACKS.anthropic;

  return {
    provider: live ? provider : 'mock',
    models: {
      planner: env.modelPlanner || base.planner,
      review: env.modelReview || base.review,
      vision: env.modelVision || base.vision,
    },
    live,
    reason: live
      ? `${provider} (${env.modelPlanner || base.planner})`
      : provider === 'mock'
        ? 'AI_PROVIDER=mock — детерминированный движок'
        : `нет ключа для ${provider} — работает детерминированный движок`,
  };
}
