'use client';

import * as React from 'react';
import { Send, X, Sparkles, Wrench } from 'lucide-react';
import type { ChatMessage } from '@/lib/domain/schema';
import { Button, Drawer, Spinner, Textarea } from '@/components/ui/primitives';
import { api } from '@/components/data';
import { relativeTime } from '@/lib/utils';

const SUGGESTIONS = [
  'Новая неделя, обнови план',
  'Сделай weekly review',
  'Добавь две идеи для теста новых тем',
  'Что мы поняли за последние четыре недели?',
];

/**
 * Workspace-level copilot. Its scope is the whole week, so it can plan,
 * review, touch the backlog and record learnings — unlike the card chat.
 */
export function CopilotDrawer({
  open,
  weekId,
  onClose,
  onChanged,
  providerLabel,
}: {
  open: boolean;
  weekId: string;
  onClose: () => void;
  onChanged: () => void;
  providerLabel: string;
}) {
  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const [input, setInput] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  const load = React.useCallback(async () => {
    const res = await api<{ messages: ChatMessage[] }>(`/api/ai/chat?kind=week&ref=${weekId}`);
    setMessages(res.messages);
  }, [weekId]);

  React.useEffect(() => {
    if (open) void load();
  }, [open, load]);

  React.useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, busy]);

  const send = async (text?: string) => {
    const message = (text ?? input).trim();
    if (!message || busy) return;
    setInput('');
    setBusy(true);
    setMessages((m) => [
      ...m,
      {
        id: `tmp-${Date.now()}`,
        thread_id: '',
        role: 'user',
        content: message,
        tool_calls: [],
        created_at: new Date().toISOString(),
      },
    ]);
    try {
      await api('/api/ai/chat', {
        method: 'POST',
        json: { message, scope: { kind: 'week', weekId } },
      });
      await load();
      onChanged();
    } catch (e) {
      setMessages((m) => [
        ...m,
        {
          id: `err-${Date.now()}`,
          thread_id: '',
          role: 'assistant',
          content: `Ошибка: ${e instanceof Error ? e.message : 'AI недоступен'}`,
          tool_calls: [],
          created_at: new Date().toISOString(),
        },
      ]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer open={open} onClose={onClose} width="w-[460px]">
      <div className="flex items-center justify-between border-b border-[var(--color-line)] px-4 py-3">
        <div>
          <h2 className="flex items-center gap-1.5 text-[13px] font-semibold tracking-tight">
            <Sparkles className="h-3.5 w-3.5 text-[var(--color-accent)]" />
            AI Copilot
          </h2>
          <p className="text-[10.5px] text-[var(--color-ink-3)]">
            {weekId} · {providerLabel}
          </p>
        </div>
        <Button variant="ghost" size="xs" onClick={onClose}>
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        {!messages.length ? (
          <div className="space-y-2">
            <p className="text-[12px] text-[var(--color-ink-2)]">
              Контекст собирается заново из хранилища при каждом запросе — загружать документы не
              нужно.
            </p>
            <div className="flex flex-col gap-1">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="rounded-md border border-[var(--color-line)] px-2.5 py-1.5 text-left text-[12px] text-[var(--color-ink-2)] hover:bg-[var(--color-surface-2)]"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {messages.map((m) => (
          <div key={m.id}>
            <div className="mb-0.5 flex items-center gap-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-ink-3)]">
                {m.role === 'user' ? 'Вы' : 'Copilot'}
              </span>
              <span className="text-[10px] text-[var(--color-ink-3)]">
                {relativeTime(m.created_at)}
              </span>
            </div>
            <pre
              className={
                m.role === 'user'
                  ? 'whitespace-pre-wrap rounded-md bg-[var(--color-surface-2)] px-2.5 py-2 font-sans text-[12px] leading-relaxed text-[var(--color-ink)]'
                  : 'whitespace-pre-wrap font-sans text-[12px] leading-relaxed text-[var(--color-ink-2)]'
              }
            >
              {m.content}
            </pre>
            {m.tool_calls?.length ? (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {m.tool_calls.map((t, i) => (
                  <span
                    key={i}
                    title={t.summary}
                    className="inline-flex items-center gap-1 rounded border border-[var(--color-line)] bg-[var(--color-surface-2)] px-1.5 py-0.5 font-mono text-[9.5px] text-[var(--color-ink-3)]"
                  >
                    <Wrench className="h-2.5 w-2.5" />
                    {t.name}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        ))}

        {busy ? (
          <div className="flex items-center gap-1.5 text-[11.5px] text-[var(--color-ink-3)]">
            <Spinner /> собираю контекст и выполняю…
          </div>
        ) : null}
      </div>

      <div className="shrink-0 border-t border-[var(--color-line)] p-3">
        <div className="flex items-end gap-1.5">
          <Textarea
            rows={2}
            placeholder="«Новая неделя, обнови план»"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <Button variant="primary" size="md" onClick={() => send()} disabled={busy || !input.trim()}>
            {busy ? <Spinner /> : <Send className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </div>
    </Drawer>
  );
}
