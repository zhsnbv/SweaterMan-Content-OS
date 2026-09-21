import { z } from 'zod';
import { ctx, jsonError } from '@/lib/server';
import { updateUnit } from '@/lib/services/units';
import { queueSync } from '@/lib/github/sync';
import { EFFORTS, CONTENT_TYPES, UNIT_STATUSES, SLOT_TYPES } from '@/lib/domain/enums';

export const dynamic = 'force-dynamic';

const patchSchema = z.object({
  title: z.string().optional(),
  date: z.string().optional(),
  scheduled_time: z.string().nullable().optional(),
  content_type: z.enum(CONTENT_TYPES).optional(),
  slot_type: z.enum(SLOT_TYPES).optional(),
  objective: z.string().optional(),
  hypothesis: z.string().optional(),
  expected_signal: z.string().optional(),
  estimated_effort: z.enum(EFFORTS).optional(),
  status: z.enum(UNIT_STATUSES).optional(),
  owner: z.string().optional(),
  notes: z.string().optional(),
  figma_url: z.string().optional(),
  related_core_video_id: z.string().nullable().optional(),
  platforms: z.array(z.any()).optional(),
});

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { store } = await ctx();
  const [unit, revisions, comments, reports] = await Promise.all([
    store.getUnit(id),
    store.listRevisions(id),
    store.listComments(id),
    store.listReports({ unitId: id }),
  ]);
  if (!unit) return jsonError('Not found', 404);
  return Response.json({ unit, revisions, comments, reports });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError('Invalid patch');

  const { store, workspaceId, actor } = await ctx();
  try {
    const result = await updateUnit(store, id, parsed.data as never, {
      actor,
      reason: 'manual edit',
    });
    queueSync(store, workspaceId, { kind: 'unit', unitId: id }, `content: edit ${id}`);
    return Response.json({
      unit: result.unit,
      diff: result.diffs,
      diff_summary: result.diffSummary,
    });
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : 'Update failed', 500);
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { store, workspaceId } = await ctx();
  const unit = await store.getUnit(id);
  if (!unit) return jsonError('Not found', 404);
  if (unit.platforms.some((p) => p.publish_status === 'published')) {
    return jsonError('Опубликованную карточку удалить нельзя — это история. Переведите её в skipped.', 409);
  }
  await store.deleteUnit(id);
  queueSync(store, workspaceId, { kind: 'week', weekId: unit.week_id }, `content: remove ${id}`);
  return Response.json({ ok: true });
}
