import { z } from 'zod';
import { ctx, jsonError } from '@/lib/server';
import { runAgent } from '@/lib/ai/agent';
import { threadMessages } from '@/lib/ai/agent';
import type { Scope } from '@/lib/ai/context-builder';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const body = z.object({
  message: z.string().min(1),
  scope: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('workspace') }),
    z.object({ kind: z.literal('week'), weekId: z.string() }),
    z.object({ kind: z.literal('content_unit'), unitId: z.string() }),
    z.object({ kind: z.literal('core_video'), coreVideoId: z.string() }),
  ]),
  role: z.enum(['planner', 'review']).optional(),
});

export async function POST(req: Request) {
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError('Invalid request body');

  const { store, workspaceId, actor } = await ctx();
  try {
    const result = await runAgent({
      store,
      workspaceId,
      actor,
      scope: parsed.data.scope as Scope,
      message: parsed.data.message,
      role: parsed.data.role,
    });
    return Response.json(result);
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : 'AI request failed', 500);
  }
}

export async function GET(req: Request) {
  const { store } = await ctx();
  const url = new URL(req.url);
  const kind = url.searchParams.get('kind') ?? 'workspace';
  const ref = url.searchParams.get('ref');

  const scope: Scope =
    kind === 'content_unit' && ref
      ? { kind: 'content_unit', unitId: ref }
      : kind === 'week' && ref
        ? { kind: 'week', weekId: ref }
        : { kind: 'workspace' };

  return Response.json({ messages: await threadMessages(store, scope) });
}
