import { ctx } from '@/lib/server';
import { syncToGithub } from '@/lib/github/sync';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET() {
  const { store } = await ctx();
  return Response.json({ log: await store.listSyncLog(20) });
}

/** Manual "retry / sync now" from the header indicator. */
export async function POST(req: Request) {
  const { store, workspaceId } = await ctx();
  const body = await req.json().catch(() => ({}));
  const message = typeof body?.message === 'string' ? body.message : 'content: full snapshot';
  const result = await syncToGithub(store, workspaceId, { kind: 'full' }, message);
  return Response.json(result);
}
