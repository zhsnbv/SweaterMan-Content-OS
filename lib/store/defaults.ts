import type { StrategyState, Workspace } from '@/lib/domain/schema';

export const DEFAULT_WORKSPACE_ID = 'ws_sweaterman';

export function defaultWorkspace(): Workspace {
  return {
    id: DEFAULT_WORKSPACE_ID,
    name: 'Sweater Man',
    created_at: new Date(0).toISOString(),
    setup_complete: false,
  };
}

/**
 * Operational state. Unlike MASTER_CONTEXT / FUNNEL_PLAYBOOK this is expected
 * to move week to week — the weekly review writes to it directly.
 */
export function defaultStrategyState(): StrategyState {
  return {
    updated_at: new Date(0).toISOString(),
    current_focus:
      'Проверить, держат ли reputation-reversal и «ч.2» reach, и запустить waitlist как постоянный soft-sell слой.',
    active_experiments: [
      'H1 reputation reversal — нужно n≥5 в серии',
      'H2 «ч.2» успешной темы',
      'Telegram deep-link теги vNNN_платформа с V027',
    ],
    content_mix_intent:
      '~3–4 audience touch на 1 authority. Commercial — регулярно, как только есть что предложить. Это ориентир, не квота.',
    sales_level: 'micro',
    telegram_reason_rotation: ['A', 'B', 'C'],
    effort_budget_note:
      '1–2 основных ролика в неделю. Supporting: 1 обязательный + ≤1 опциональный. Ежедневный постинг не делаем.',
    open_questions: [
      'Telegram BotPanel baseline всё ещё UNKNOWN',
      'Реальные часы производства на ролик неизвестны',
      'Причина роста «пола» просмотров с середины июля не установлена',
    ],
    notes: '',
  };
}
