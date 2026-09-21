import { z } from 'zod';
import { ctx, jsonError } from '@/lib/server';
import { backlogItemSchema } from '@/lib/domain/schema';
import { slugId } from '@/lib/domain/ids';
import { queueSync } from '@/lib/github/sync';
import { BACKLOG_STATUSES } from '@/lib/domain/enums';

export const dynamic = 'force-dynamic';

const body = z.object({
  title: z.string().min(1),
  source: z.string().default('manual'),
  cluster: z.string().default(''),
  why_interesting: z.string().default(''),
  suggested_test: z.string().default(''),
  status: z.enum(BACKLOG_STATUSES).default('RAW'),
  notes: z.string().default(''),
});

export async function GET() {
  const { store } = await ctx();
  return Response.json({ backlog: await store.listBacklog() });
}

export async function POST(req: Request) {
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError('Invalid body');

  const { store, workspaceId } = await ctx();
  const now = new Date().toISOString();
  const item = backlogItemSchema.parse({
    ...parsed.data,
    id: slugId('IDEA', parsed.data.title),
    workspace_id: workspaceId,
    evidence: [],
    created_at: now,
    updated_at: now,
  });
  await store.saveBacklogItem(item);
  queueSync(store, workspaceId, { kind: 'memory' }, `content: add backlog idea ${item.id}`);
  return Response.json({ item });
}
