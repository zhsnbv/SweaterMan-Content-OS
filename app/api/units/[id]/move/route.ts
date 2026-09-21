import { z } from 'zod';
import { ctx, jsonError } from '@/lib/server';
import { moveUnit } from '@/lib/services/units';
import { queueSync } from '@/lib/github/sync';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = z
    .object({ date: z.string(), position: z.number().int().optional() })
    .safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError('Invalid body');

  const { store, workspaceId, actor } = await ctx();
  try {
    const result = await moveUnit(store, id, parsed.data.date, {
      actor,
      position: parsed.data.position,
    });
    queueSync(store, workspaceId, { kind: 'unit', unitId: id }, `content: move ${id} to ${parsed.data.date}`);
    return Response.json({ unit: result.unit });
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : 'Move failed', 500);
  }
}
