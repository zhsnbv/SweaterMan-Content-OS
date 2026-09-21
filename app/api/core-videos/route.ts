import { z } from 'zod';
import { ctx, jsonError } from '@/lib/server';
import { coreVideoSchema } from '@/lib/domain/schema';
import { coreVideoId, nextCoreVideoNumber } from '@/lib/domain/ids';
import { queueSync } from '@/lib/github/sync';
import { CORE_VIDEO_STAGES } from '@/lib/domain/enums';

export const dynamic = 'force-dynamic';

const body = z.object({
  working_title: z.string().min(1),
  topic: z.string().default(''),
  cluster: z.string().default(''),
  planned_publish_date: z.string().nullable().default(null),
  production_stage: z.enum(CORE_VIDEO_STAGES).default('idea'),
  storyboard_text: z.string().default(''),
  storyboard_url: z.string().default(''),
  figma_url: z.string().default(''),
  script: z.string().default(''),
  production_notes: z.string().default(''),
});

export async function GET() {
  const { store } = await ctx();
  return Response.json({ coreVideos: await store.listCoreVideos() });
}

export async function POST(req: Request) {
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError('Invalid body');

  const { store, workspaceId } = await ctx();
  const existing = await store.listCoreVideos();
  const id = coreVideoId(nextCoreVideoNumber(existing.map((v) => v.id)));
  const now = new Date().toISOString();

  const video = coreVideoSchema.parse({
    ...parsed.data,
    id,
    workspace_id: workspaceId,
    references: [],
    available_assets: [],
    attached_files: [],
    created_at: now,
    updated_at: now,
  });
  await store.saveCoreVideo(video);
  queueSync(store, workspaceId, { kind: 'full' }, `content: add core video ${id}`);
  return Response.json({ coreVideo: video });
}
