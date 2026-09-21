import { z } from 'zod';
import { ctx, jsonError } from '@/lib/server';
import { commentSchema } from '@/lib/domain/schema';
import { uid } from '@/lib/domain/ids';
import { runAgent } from '@/lib/ai/agent';
import { ROLES } from '@/lib/domain/enums';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const body = z.object({
  message: z.string().min(1),
  author: z.string().default(''),
  author_role: z.enum(ROLES).default('EDITOR'),
  /** Explicit "Send to AI" button. @ai in the text does the same. */
  send_to_ai: z.boolean().default(false),
});

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { store } = await ctx();
  return Response.json({ comments: await store.listComments(id) });
}

/**
 * A plain comment is just a comment. A comment containing @ai — or sent with
 * the Send to AI button — is routed to the card-scoped agent, and the revision
 * it produces is linked back to the comment.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError('Invalid body');

  const { store, workspaceId, actor } = await ctx();
  const unit = await store.getUnit(id);
  if (!unit) return jsonError('Not found', 404);
  if (parsed.data.author_role === 'VIEWER') {
    return jsonError('Viewers can read but not comment.', 403);
  }

  const invokesAi = parsed.data.send_to_ai || /(^|\s)@ai\b/i.test(parsed.data.message);
  const author = parsed.data.author || actor;

  const comment = commentSchema.parse({
    id: uid('cmt'),
    content_unit_id: id,
    author,
    author_role: parsed.data.author_role,
    message: parsed.data.message,
    ai_invoked: invokesAi,
    ai_response: '',
    revision_id: null,
    created_at: new Date().toISOString(),
  });
  await store.saveComment(comment);

  if (!invokesAi) return Response.json({ comment, ai: null });

  const before = await store.listRevisions(id);
  const instruction = parsed.data.message.replace(/(^|\s)@ai\b/gi, ' ').trim();

  try {
    const result = await runAgent({
      store,
      workspaceId,
      actor: author,
      scope: { kind: 'content_unit', unitId: id },
      message: instruction,
    });
    const after = await store.listRevisions(id);
    const newRevision = after.find((r) => !before.some((b) => b.id === r.id));

    const updated = {
      ...comment,
      ai_response: result.text,
      revision_id: newRevision?.id ?? null,
    };
    await store.saveComment(updated);
    return Response.json({ comment: updated, ai: result });
  } catch (err) {
    const updated = {
      ...comment,
      ai_response: `Ошибка: ${err instanceof Error ? err.message : 'AI request failed'}`,
    };
    await store.saveComment(updated);
    return Response.json({ comment: updated, ai: null });
  }
}
