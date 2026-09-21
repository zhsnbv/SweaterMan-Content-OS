export type FileWrite = { path: string; content: string };

export interface GitTarget {
  readonly kind: 'github' | 'local';
  readonly describe: string;
  /** Creates the data branch from the default branch if it does not exist. */
  ensureBranch(): Promise<void>;
  /** Commits all files in one commit. Returns the commit sha (or a local id). */
  commit(message: string, files: FileWrite[]): Promise<string>;
  readFile(path: string): Promise<string | null>;
}
