import { z } from 'zod';
import { ctx, jsonError } from '@/lib/server';
import { seedDemo } from '@/lib/services/demo';

export const dynamic = 'force-dynamic';

/** Development seed data — one core video and a sample week. Easily cleared. */
export async function POST(req: Request) {
  const parsed = z
    .object({ action: z.enum(['seed', 'clear']) })
    .safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError('Invalid body');

  const { store, workspaceId } = await ctx();
  if (parsed.data.action === 'clear') {
    await store.resetContent();
    return Response.json({ ok: true, cleared: true });
  }
  const result = await seedDemo(store, workspaceId);
  return Response.json({ ok: true, ...result });
}
