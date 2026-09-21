import { ctx } from '@/lib/server';

export const dynamic = 'force-dynamic';

/** Serves screenshots from the local attachment store in credential-free mode. */
export async function GET(_req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const { store } = await ctx();
  const file = await store.getAttachment(path.join('/'));
  if (!file) return new Response('Not found', { status: 404 });
  return new Response(new Uint8Array(file.data), {
    headers: { 'content-type': file.contentType, 'cache-control': 'private, max-age=3600' },
  });
}
