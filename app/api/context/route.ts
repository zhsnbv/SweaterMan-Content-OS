import { z } from 'zod';
import { ctx, jsonError } from '@/lib/server';
import { ensureBootstrapped } from '@/lib/services/bootstrap';
import { queueSync } from '@/lib/github/sync';

export const dynamic = 'force-dynamic';

export async function GET() {
  const { store } = await ctx();
  return Response.json({
    docs: await store.listContextDocs(),
    strategyState: await store.getStrategyState(),
    strategyChanges: await store.listStrategyChanges(),
  });
}

const body = z.object({
  action: z.enum(['reimport', 'update_doc', 'update_strategy_state']),
  slug: z.string().optional(),
  body: z.string().optional(),
  /** Editing an immutable doc requires an explicit owner override. */
  owner_override: z.boolean().default(false),
  strategy_state: z.record(z.string(), z.any()).optional(),
});

export async function POST(req: Request) {
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError('Invalid body');

  const { store, workspaceId } = await ctx();

  if (parsed.data.action === 'reimport') {
    const result = await ensureBootstrapped(store, { force: true });
    queueSync(store, workspaceId, { kind: 'context' }, 'content: re-import persistent context');
    return Response.json(result);
  }

  if (parsed.data.action === 'update_strategy_state') {
    const current = await store.getStrategyState();
    const next = {
      ...current,
      ...(parsed.data.strategy_state ?? {}),
      updated_at: new Date().toISOString(),
    };
    await store.saveStrategyState(next as never);
    queueSync(store, workspaceId, { kind: 'context' }, 'memory: update strategy state');
    return Response.json({ strategyState: next });
  }

  const slug = parsed.data.slug as never;
  const doc = await store.getContextDoc(slug);
  if (!doc) return jsonError('Unknown doc', 404);
  if (doc.immutable && !parsed.data.owner_override) {
    return jsonError(
      'Это фундаментальный документ. Изменение требует подтверждения Owner (owner_override).',
      403,
    );
  }

  const next = {
    ...doc,
    body: parsed.data.body ?? doc.body,
    updated_at: new Date().toISOString(),
  };
  await store.saveContextDoc(next);
  queueSync(store, workspaceId, { kind: 'context' }, `context: update ${doc.slug}`);
  return Response.json({ doc: next });
}
