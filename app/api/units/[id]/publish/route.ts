import { z } from 'zod';
import { ctx, jsonError } from '@/lib/server';
import { markPublished } from '@/lib/services/analytics';
import { queueSync } from '@/lib/github/sync';
import { PLATFORMS } from '@/lib/domain/enums';

export const dynamic = 'force-dynamic';

const body = z.object({
  platform: z.enum(PLATFORMS),
  surface: z.string().optional(),
  publish_url: z.string().default(''),
  published_at: z.string().optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError('Invalid body');

  const { store, workspaceId, actor } = await ctx();
  try {
    const { unit, publishedAt } = await markPublished(
      store,
      id,
      parsed.data.platform,
      parsed.data.publish_url,
      { surface: parsed.data.surface, publishedAt: parsed.data.published_at, actor },
    );
    queueSync(store, workspaceId, { kind: 'unit', unitId: id }, `content: mark ${id} published on ${parsed.data.platform}`);
    return Response.json({ unit, published_at: publishedAt });
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : 'Publish failed', 500);
  }
}
