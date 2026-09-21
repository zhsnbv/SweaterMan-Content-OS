import type { Store } from '@/lib/store';
import { getAiConfig } from './config';
import { buildContextBundle, renderContextBundle, type Scope } from './context-builder';
import { systemPrompt } from './prompts';
import { toolsForScope, type ToolContext } from './tools';
import type { AiProvider } from './provider';
import { MockProvider } from './providers/mock';
import { SdkProvider } from './providers/sdk';
import { chatMessageSchema, chatThreadSchema, type ChatMessage } from '@/lib/domain/schema';
import { uid } from '@/lib/domain/ids';

export function getProvider(): AiProvider {
  const config = getAiConfig();
  return config.live ? new SdkProvider(config) : new MockProvider();
}

export type RunAgentInput = {
  store: Store;
  workspaceId: string;
  actor: string;
  scope: Scope;
  message: string;
  threadId?: string;
  /** Weekly review and deeper analysis get the heavier model. */
  role?: 'planner' | 'review';
};

export type RunAgentOutput = {
  text: string;
  toolCalls: Array<{ name: string; summary: string }>;
  threadId: string;
  contextChars: number;
  provider: string;
};

/**
 * The single entry point for every AI interaction.
 *
 * AI MEMORY RULE: scope → Context Builder → durable read → only then respond.
 * Chat history is convenience, never the source of truth: the bundle is rebuilt
 * from storage on every single call, so a brand-new browser session with an
 * empty thread produces the same quality of answer as a long-running one.
 */
export async function runAgent(input: RunAgentInput): Promise<RunAgentOutput> {
  const { store, workspaceId, actor, scope, message } = input;

  // 1. scope → 2. build context from durable state
  const bundle = await buildContextBundle(store, scope);
  const contextBlock = renderContextBundle(bundle);

  // 3. thread bookkeeping (for display only — not used as context)
  const threadId = await ensureThread(store, workspaceId, scope, input.threadId);
  const history = await store.listMessages(threadId);

  await store.saveMessage(
    chatMessageSchema.parse({
      id: uid('msg'),
      thread_id: threadId,
      role: 'user',
      content: message,
      tool_calls: [],
      created_at: new Date().toISOString(),
    }),
  );

  const ctx: ToolContext = { store, workspaceId, actor, scope, calls: [] };
  const provider = getProvider();

  // Only the last few turns are replayed; everything substantive is in the bundle.
  const recent = history.slice(-6).map((m) => ({
    role: m.role === 'assistant' ? ('assistant' as const) : ('user' as const),
    content: m.content,
  }));

  const result = await provider.run({
    system: systemPrompt(scope, contextBlock, actor),
    messages: [...recent, { role: 'user', content: message }],
    tools: toolsForScope(scope),
    ctx,
    role: input.role ?? 'planner',
  });

  await store.saveMessage(
    chatMessageSchema.parse({
      id: uid('msg'),
      thread_id: threadId,
      role: 'assistant',
      content: result.text,
      tool_calls: result.toolCalls,
      created_at: new Date().toISOString(),
    }),
  );

  return {
    text: result.text,
    toolCalls: result.toolCalls,
    threadId,
    contextChars: contextBlock.length,
    provider: provider.name,
  };
}

async function ensureThread(
  store: Store,
  workspaceId: string,
  scope: Scope,
  threadId?: string,
): Promise<string> {
  if (threadId) {
    const existing = await store.getThread(threadId);
    if (existing) return existing.id;
  }

  const scopeRef =
    scope.kind === 'content_unit'
      ? scope.unitId
      : scope.kind === 'week'
        ? scope.weekId
        : scope.kind === 'core_video'
          ? scope.coreVideoId
          : scope.kind === 'report'
            ? scope.unitId
            : null;

  const threads = await store.listThreads();
  const match = threads.find(
    (t) => t.scope === normalizeScope(scope.kind) && t.scope_ref === scopeRef,
  );
  if (match) return match.id;

  const thread = chatThreadSchema.parse({
    id: uid('thr'),
    workspace_id: workspaceId,
    scope: normalizeScope(scope.kind),
    scope_ref: scopeRef,
    title: scopeRef ?? 'workspace',
    created_at: new Date().toISOString(),
  });
  await store.saveThread(thread);
  return thread.id;
}

function normalizeScope(kind: Scope['kind']): 'workspace' | 'week' | 'content_unit' | 'core_video' {
  if (kind === 'report') return 'content_unit';
  return kind;
}

export async function threadMessages(
  store: Store,
  scope: Scope,
): Promise<ChatMessage[]> {
  const scopeRef =
    scope.kind === 'content_unit'
      ? scope.unitId
      : scope.kind === 'week'
        ? scope.weekId
        : scope.kind === 'core_video'
          ? scope.coreVideoId
          : null;
  const threads = await store.listThreads();
  const match = threads.find(
    (t) => t.scope === normalizeScope(scope.kind) && t.scope_ref === scopeRef,
  );
  return match ? store.listMessages(match.id) : [];
}
