import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { FileWrite, GitTarget } from './types';

/**
 * Stand-in for the GitHub data branch used when no token is configured.
 * Writes the exact same tree to disk, so the snapshot format is exercised in
 * dev and tests and nothing about the layout is guesswork on the day a token
 * finally appears.
 */
export class LocalGitTarget implements GitTarget {
  readonly kind = 'local' as const;
  readonly describe: string;
  private readonly root: string;
  private readonly logFile: string;

  constructor(root: string) {
    this.root = root;
    this.logFile = path.join(root, '_commits.log');
    this.describe = 'local snapshot (.localdata/content-state)';
  }

  async ensureBranch(): Promise<void> {
    await fs.mkdir(this.root, { recursive: true });
  }

  async commit(message: string, files: FileWrite[]): Promise<string> {
    await this.ensureBranch();
    for (const f of files) {
      const full = path.join(this.root, f.path);
      await fs.mkdir(path.dirname(full), { recursive: true });
      await fs.writeFile(full, f.content, 'utf8');
    }
    const sha = createHash('sha1')
      .update(`${message}:${files.map((f) => f.path).join(',')}:${Date.now()}`)
      .digest('hex')
      .slice(0, 12);
    await fs.appendFile(
      this.logFile,
      `${new Date().toISOString()} ${sha} ${message} (${files.length} files)\n`,
      'utf8',
    );
    return sha;
  }

  async readFile(p: string): Promise<string | null> {
    try {
      return await fs.readFile(path.join(this.root, p), 'utf8');
    } catch {
      return null;
    }
  }
}
