import { z } from 'zod';
import { ctx, jsonError } from '@/lib/server';
import { restoreRevision } from '@/lib/services/units';
import { queueSync } from '@/lib/github/sync';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { store } = await ctx();
  return Response.json({ revisions: await store.listRevisions(id) });
}

/** Undo / restore a previous revision. The restore is itself a revision. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = z
    .object({ revision_id: z.string().optional() })
    .safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return jsonError('Invalid body');

  const { store, workspaceId, actor } = await ctx();
  try {
    const result = await restoreRevision(store, id, parsed.data.revision_id ?? '', actor);
    queueSync(store, workspaceId, { kind: 'unit', unitId: id }, `content: restore revision of ${id}`);
    return Response.json({
      unit: result.unit,
      diff_summary: result.diffSummary,
    });
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : 'Restore failed', 500);
  }
}
