import { z } from 'zod';
import { ctx, jsonError } from '@/lib/server';
import { queueSync } from '@/lib/github/sync';
import { CORE_VIDEO_STAGES } from '@/lib/domain/enums';

export const dynamic = 'force-dynamic';

const patch = z.object({
  working_title: z.string().optional(),
  topic: z.string().optional(),
  cluster: z.string().optional(),
  planned_publish_date: z.string().nullable().optional(),
  production_stage: z.enum(CORE_VIDEO_STAGES).optional(),
  script: z.string().optional(),
  storyboard_text: z.string().optional(),
  storyboard_url: z.string().optional(),
  figma_url: z.string().optional(),
  production_notes: z.string().optional(),
  available_assets: z
    .array(z.object({ label: z.string(), url: z.string().default(''), kind: z.string().default('asset') }))
    .optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = patch.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError('Invalid patch');

  const { store, workspaceId } = await ctx();
  const video = await store.getCoreVideo(id);
  if (!video) return jsonError('Not found', 404);

  const next = { ...video, ...parsed.data, updated_at: new Date().toISOString() };
  await store.saveCoreVideo(next);
  queueSync(store, workspaceId, { kind: 'full' }, `content: update core video ${id}`);
  return Response.json({ coreVideo: next });
}
