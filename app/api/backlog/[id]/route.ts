import { z } from 'zod';
import { ctx, jsonError } from '@/lib/server';
import { queueSync } from '@/lib/github/sync';
import { BACKLOG_STATUSES } from '@/lib/domain/enums';

export const dynamic = 'force-dynamic';

const patch = z.object({
  title: z.string().optional(),
  status: z.enum(BACKLOG_STATUSES).optional(),
  why_interesting: z.string().optional(),
  suggested_test: z.string().optional(),
  cluster: z.string().optional(),
  notes: z.string().optional(),
  add_evidence: z.string().optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = patch.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError('Invalid patch');

  const { store, workspaceId } = await ctx();
  const item = await store.getBacklogItem(id);
  if (!item) return jsonError('Not found', 404);

  const { add_evidence, ...rest } = parsed.data;
  const evidence = add_evidence ? [...item.evidence, add_evidence] : item.evidence;

  // Same guard as the AI tool: one signal is never enough for CORE_CANDIDATE.
  let status = rest.status ?? item.status;
  let guard = '';
  if (status === 'CORE_CANDIDATE' && evidence.length < 2) {
    status = 'PROMISING';
    guard = 'Для CORE_CANDIDATE нужно ≥2 подтверждения. Сохранено как PROMISING.';
  }

  const next = { ...item, ...rest, status, evidence, updated_at: new Date().toISOString() };
  await store.saveBacklogItem(next);
  queueSync(store, workspaceId, { kind: 'memory' }, `content: update backlog ${id}`);
  return Response.json({ item: next, guard });
}
