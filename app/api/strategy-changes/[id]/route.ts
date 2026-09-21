import { z } from 'zod';
import { ctx, jsonError } from '@/lib/server';
import { queueSync } from '@/lib/github/sync';

export const dynamic = 'force-dynamic';

/**
 * Owner decision on a proposed change to a fundamental document.
 * Approving applies the change by appending it to the doc with an audit note —
 * the AI can never do this on its own.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = z
    .object({ decision: z.enum(['APPROVED', 'REJECTED']), decided_by: z.string().default('Owner') })
    .safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError('Invalid body');

  const { store, workspaceId } = await ctx();
  const changes = await store.listStrategyChanges();
  const change = changes.find((c) => c.id === id);
  if (!change) return jsonError('Not found', 404);
  if (change.status !== 'PROPOSED') return jsonError('Already decided', 409);

  const next = {
    ...change,
    status: parsed.data.decision,
    decided_at: new Date().toISOString(),
    decided_by: parsed.data.decided_by,
  };
  await store.saveStrategyChange(next);

  if (parsed.data.decision === 'APPROVED') {
    const doc = await store.getContextDoc(change.target_doc);
    if (doc) {
      const stamp = new Date().toISOString().slice(0, 10);
      await store.saveContextDoc({
        ...doc,
        body: `${doc.body}\n\n---\n\n## APPROVED CHANGE — ${stamp}\n\n**Обоснование:** ${change.rationale}\n\n${change.proposed_change}\n\n_Evidence: ${change.evidence.join('; ') || '—'} · approved by ${parsed.data.decided_by}_\n`,
        updated_at: new Date().toISOString(),
      });
    }
  }

  queueSync(store, workspaceId, { kind: 'context' }, `memory: ${parsed.data.decision.toLowerCase()} strategy change for ${change.target_doc}`);
  return Response.json({ change: next });
}
