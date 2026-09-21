import { z } from 'zod';
import { ctx, jsonError } from '@/lib/server';
import { runWeeklyReview } from '@/lib/services/review';
import { queueSync } from '@/lib/github/sync';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(req: Request) {
  const parsed = z
    .object({ week_id: z.string() })
    .safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError('Invalid body');

  const { store, workspaceId, actor } = await ctx();
  const { review, learnings } = await runWeeklyReview(store, workspaceId, parsed.data.week_id, {
    generatedBy: actor,
  });
  queueSync(store, workspaceId, { kind: 'review', weekId: parsed.data.week_id }, `review: complete ${parsed.data.week_id}`);
  return Response.json({ review, new_learnings: learnings });
}
