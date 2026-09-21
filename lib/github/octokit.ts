import { Octokit } from 'octokit';
import type { FileWrite, GitTarget } from './types';

/**
 * Writes durable snapshots to a dedicated data branch (default: content-state)
 * so content commits never trigger a deployment of `main`.
 *
 * Uses the Git data API (blob → tree → commit → ref) so a whole snapshot lands
 * as a single commit rather than one commit per file.
 */
export class GithubTarget implements GitTarget {
  readonly kind = 'github' as const;
  readonly describe: string;
  private readonly octokit: Octokit;

  constructor(
    token: string,
    private readonly owner: string,
    private readonly repo: string,
    private readonly branch: string,
  ) {
    this.octokit = new Octokit({ auth: token });
    this.describe = `${owner}/${repo}@${branch}`;
  }

  async ensureBranch(): Promise<void> {
    try {
      await this.octokit.rest.repos.getBranch({
        owner: this.owner,
        repo: this.repo,
        branch: this.branch,
      });
      return;
    } catch (err: any) {
      if (err?.status !== 404) throw err;
    }

    const { data: repo } = await this.octokit.rest.repos.get({
      owner: this.owner,
      repo: this.repo,
    });
    const { data: base } = await this.octokit.rest.git.getRef({
      owner: this.owner,
      repo: this.repo,
      ref: `heads/${repo.default_branch}`,
    });
    await this.octokit.rest.git.createRef({
      owner: this.owner,
      repo: this.repo,
      ref: `refs/heads/${this.branch}`,
      sha: base.object.sha,
    });
  }

  async commit(message: string, files: FileWrite[]): Promise<string> {
    if (!files.length) return '';
    await this.ensureBranch();

    const { data: ref } = await this.octokit.rest.git.getRef({
      owner: this.owner,
      repo: this.repo,
      ref: `heads/${this.branch}`,
    });
    const headSha = ref.object.sha;
    const { data: headCommit } = await this.octokit.rest.git.getCommit({
      owner: this.owner,
      repo: this.repo,
      commit_sha: headSha,
    });

    const blobs = await Promise.all(
      files.map(async (f) => {
        const { data } = await this.octokit.rest.git.createBlob({
          owner: this.owner,
          repo: this.repo,
          content: Buffer.from(f.content, 'utf8').toString('base64'),
          encoding: 'base64',
        });
        return { path: f.path, sha: data.sha };
      }),
    );

    const { data: tree } = await this.octokit.rest.git.createTree({
      owner: this.owner,
      repo: this.repo,
      base_tree: headCommit.tree.sha,
      tree: blobs.map((b) => ({
        path: b.path,
        mode: '100644' as const,
        type: 'blob' as const,
        sha: b.sha,
      })),
    });

    const { data: commit } = await this.octokit.rest.git.createCommit({
      owner: this.owner,
      repo: this.repo,
      message,
      tree: tree.sha,
      parents: [headSha],
    });

    await this.octokit.rest.git.updateRef({
      owner: this.owner,
      repo: this.repo,
      ref: `heads/${this.branch}`,
      sha: commit.sha,
    });

    return commit.sha;
  }

  async readFile(path: string): Promise<string | null> {
    try {
      const { data } = await this.octokit.rest.repos.getContent({
        owner: this.owner,
        repo: this.repo,
        path,
        ref: this.branch,
      });
      if (Array.isArray(data) || data.type !== 'file') return null;
      return Buffer.from(data.content, 'base64').toString('utf8');
    } catch {
      return null;
    }
  }
}
