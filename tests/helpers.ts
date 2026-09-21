import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createLocalStore, type Store } from '@/lib/store';
import { ensureBootstrapped } from '@/lib/services/bootstrap';
import { DEFAULT_WORKSPACE_ID } from '@/lib/store/defaults';
import { flushSyncs } from '@/lib/github/sync';

export async function tempStore(): Promise<{ store: Store; dir: string; workspaceId: string }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'content-os-test-'));
  // Point the whole process at this directory so background syncs triggered by
  // AI tools land inside the sandbox rather than in the developer's workspace.
  process.env.CONTENT_OS_DATA_DIR = dir;
  const store = createLocalStore(dir);
  await ensureBootstrapped(store);
  return { store, dir, workspaceId: DEFAULT_WORKSPACE_ID };
}

/** Wait for fire-and-forget syncs before touching the filesystem. */
export async function cleanup(dir: string): Promise<void> {
  await flushSyncs();
  delete process.env.CONTENT_OS_DATA_DIR;
  await fs.rm(dir, { recursive: true, force: true });
}
