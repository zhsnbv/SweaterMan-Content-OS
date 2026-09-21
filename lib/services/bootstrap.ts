import fs from 'node:fs/promises';
import path from 'node:path';
import type { Store } from '@/lib/store';
import { DEFAULT_WORKSPACE_ID } from '@/lib/store/defaults';
import { contextDocSchema, type ContextDoc } from '@/lib/domain/schema';
import { env } from '@/lib/env';
import { uid } from '@/lib/domain/ids';

type SeedSource = {
  slug: ContextDoc['slug'];
  title: string;
  /** [directory, filename] — the directory is static so only it gets traced. */
  files: Array<['seed' | 'context', string]>;
};

/**
 * Where each persistent context doc comes from on first import.
 * seed/ holds documents the team produced; context/ holds ones this app owns.
 */
const SOURCES: SeedSource[] = [
  { slug: 'MASTER_CONTEXT', title: 'Master Context', files: [['seed', 'MASTER_CONTEXT.md']] },
  {
    slug: 'PERFORMANCE_INSIGHTS',
    title: 'Performance Insights',
    files: [['seed', 'PERFORMANCE_INSIGHTS.md']],
  },
  { slug: 'FUNNEL_PLAYBOOK', title: 'Funnel Playbook', files: [['seed', 'FUNNEL_PLAYBOOK.md']] },
  {
    slug: 'PRODUCTION_PIPELINE',
    title: 'Production Pipeline',
    // Owned by this app, with a seed/ override if the team supplies their own.
    files: [
      ['context', 'PRODUCTION_PIPELINE.md'],
      ['seed', 'PRODUCTION_PIPELINE.md'],
    ],
  },
];

const PLACEHOLDER = (slug: string) => `# ${slug} — не импортирован

Этот документ ещё не загружен в Content OS.

**Что сделать:** положите файл \`${slug}.md\` в папку \`seed/\` в корне репозитория и откройте
**Settings → Re-import context**, либо вставьте содержимое прямо на странице **Context**.

Пока документа нет, планировщик работает с неполным контекстом и будет честно
писать об этом в ответах вместо того, чтобы додумывать стратегию.
`;

/*
 * Two readers with literal path prefixes rather than one generic helper:
 * the bundler can then trace exactly `seed/` and `context/` into the
 * deployment instead of the entire project tree.
 */
async function readSeed(name: string): Promise<string | null> {
  try {
    return await fs.readFile(path.join(process.cwd(), 'seed', name), 'utf8');
  } catch {
    return null;
  }
}

async function readContextDir(name: string): Promise<string | null> {
  try {
    return await fs.readFile(path.join(process.cwd(), 'context', name), 'utf8');
  } catch {
    return null;
  }
}

async function readFirst(files: SeedSource['files']): Promise<string | null> {
  for (const [root, name] of files) {
    const body = root === 'seed' ? await readSeed(name) : await readContextDir(name);
    if (body !== null) return body;
  }
  return null;
}

/**
 * Idempotent. Runs on first request and on demand from Settings.
 * Never overwrites a doc that already exists unless `force` is set, because
 * the strategic documents are the one thing the app must not clobber.
 */
export async function ensureBootstrapped(
  store: Store,
  opts: { force?: boolean } = {},
): Promise<{ workspaceId: string; imported: string[]; missing: string[] }> {
  const workspace = await store.getWorkspace();
  if (!workspace.id || workspace.created_at === new Date(0).toISOString()) {
    await store.saveWorkspace({
      id: DEFAULT_WORKSPACE_ID,
      name: 'Sweater Man',
      setup_complete: workspace.setup_complete,
      created_at: new Date().toISOString(),
    });
  }

  const imported: string[] = [];
  const missing: string[] = [];

  for (const source of SOURCES) {
    const existing = await store.getContextDoc(source.slug);
    if (existing && !opts.force) continue;

    const body = await readFirst(source.files);
    if (!body) missing.push(source.slug);

    await store.saveContextDoc(
      contextDocSchema.parse({
        slug: source.slug,
        title: source.title,
        body: body ?? PLACEHOLDER(source.slug),
        // PERFORMANCE_INSIGHTS is a data report and may be re-imported freely;
        // the other three are fundamental and approval-gated.
        immutable: source.slug !== 'PERFORMANCE_INSIGHTS',
        updated_at: new Date().toISOString(),
      }),
    );
    imported.push(source.slug);
  }

  const members = await store.listMembers();
  if (!members.length) {
    await store.saveMember({
      id: uid('mem'),
      workspace_id: DEFAULT_WORKSPACE_ID,
      email: 'owner@sweaterman.local',
      name: env.devUser,
      role: 'OWNER',
      created_at: new Date().toISOString(),
    });
  }

  return { workspaceId: DEFAULT_WORKSPACE_ID, imported, missing };
}

export async function markSetupComplete(store: Store): Promise<void> {
  const w = await store.getWorkspace();
  await store.saveWorkspace({ ...w, setup_complete: true });
}
