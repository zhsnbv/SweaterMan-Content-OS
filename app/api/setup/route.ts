import { z } from 'zod';
import { ctx, integrationStatus, jsonError } from '@/lib/server';
import { ensureBootstrapped, markSetupComplete } from '@/lib/services/bootstrap';
import { getGitTarget, syncToGithub } from '@/lib/github/sync';
import { uid } from '@/lib/domain/ids';
import { ROLES } from '@/lib/domain/enums';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET() {
  const { store } = await ctx();
  const workspace = await store.getWorkspace();
  const docs = await store.listContextDocs();
  return Response.json({
    workspace,
    integrations: await integrationStatus(),
    docs: docs.map((d) => ({
      slug: d.slug,
      imported: !d.body.startsWith(`# ${d.slug} — не импортирован`),
      chars: d.body.length,
    })),
  });
}

const body = z.object({
  action: z.enum(['import_context', 'init_branch', 'add_member', 'complete']),
  email: z.string().optional(),
  name: z.string().optional(),
  role: z.enum(ROLES).optional(),
});

export async function POST(req: Request) {
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError('Invalid body');
  const { store, workspaceId } = await ctx();

  switch (parsed.data.action) {
    case 'import_context': {
      const result = await ensureBootstrapped(store, { force: true });
      return Response.json(result);
    }
    case 'init_branch': {
      try {
        const target = getGitTarget();
        await target.ensureBranch();
        const sync = await syncToGithub(
          store,
          workspaceId,
          { kind: 'full' },
          'content: initialize content-state branch',
        );
        return Response.json({ ok: sync.ok, target: target.describe, error: sync.error });
      } catch (err) {
        return jsonError(err instanceof Error ? err.message : 'Branch init failed', 500);
      }
    }
    case 'add_member': {
      if (!parsed.data.email) return jsonError('email required');
      await store.saveMember({
        id: uid('mem'),
        workspace_id: workspaceId,
        email: parsed.data.email,
        name: parsed.data.name ?? parsed.data.email.split('@')[0],
        role: parsed.data.role ?? 'EDITOR',
        created_at: new Date().toISOString(),
      });
      return Response.json({ members: await store.listMembers() });
    }
    case 'complete': {
      await markSetupComplete(store);
      return Response.json({ ok: true });
    }
  }
}
