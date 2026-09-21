import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import type { Store } from './types';
import type {
  AnalyticsReport,
  BacklogItem,
  ChatMessage,
  ChatThread,
  Comment,
  ContentUnit,
  ContextDoc,
  CoreVideo,
  Learning,
  Member,
  Revision,
  StrategyChange,
  StrategyState,
  Summary,
  SyncLogEntry,
  WeekPlan,
  WeeklyReview,
  Workspace,
} from '@/lib/domain/schema';
import { DEFAULT_WORKSPACE_ID, defaultStrategyState, defaultWorkspace } from './defaults';

type Collections = {
  workspace: Workspace;
  members: Member[];
  context_docs: ContextDoc[];
  strategy_state: StrategyState;
  weeks: WeekPlan[];
  units: ContentUnit[];
  revisions: Revision[];
  comments: Comment[];
  core_videos: CoreVideo[];
  backlog: BacklogItem[];
  reports: AnalyticsReport[];
  learnings: Learning[];
  reviews: WeeklyReview[];
  summaries: Summary[];
  strategy_changes: StrategyChange[];
  threads: ChatThread[];
  messages: ChatMessage[];
  sync_log: SyncLogEntry[];
};

const EMPTY = (): Collections => ({
  workspace: defaultWorkspace(),
  members: [],
  context_docs: [],
  strategy_state: defaultStrategyState(),
  weeks: [],
  units: [],
  revisions: [],
  comments: [],
  core_videos: [],
  backlog: [],
  reports: [],
  learnings: [],
  reviews: [],
  summaries: [],
  strategy_changes: [],
  threads: [],
  messages: [],
  sync_log: [],
});

/**
 * File-backed store used when Supabase credentials are absent (local dev, CI,
 * tests). Same interface as the Supabase store, so nothing above it changes.
 * Writes are serialised through a promise chain to avoid interleaved
 * read-modify-write on the single JSON document.
 */
export class LocalStore implements Store {
  readonly kind = 'local' as const;
  private readonly file: string;
  private readonly attachmentDir: string;
  private cache: Collections | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(dir: string) {
    // Paths are runtime-configured (CONTENT_OS_DATA_DIR); this adapter is the
    // credential-free fallback and its data dir is never part of the bundle.
    this.file = path.join(/* turbopackIgnore: true */ dir, 'store.json');
    this.attachmentDir = path.join(/* turbopackIgnore: true */ dir, 'attachments');
  }

  private async load(): Promise<Collections> {
    if (this.cache) return this.cache;
    try {
      const raw = await fs.readFile(this.file, 'utf8');
      this.cache = { ...EMPTY(), ...(JSON.parse(raw) as Collections) };
    } catch {
      this.cache = EMPTY();
    }
    return this.cache;
  }

  private async persist(): Promise<void> {
    if (!this.cache) return;
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    // The temp name must be unique per write, not per process: two store
    // instances pointed at the same directory (a reopened store, a background
    // sync, a dev-server reload) would otherwise rename the same file and one
    // of them would fail with ENOENT.
    const tmp = `${this.file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
    try {
      await fs.writeFile(tmp, JSON.stringify(this.cache, null, 2), 'utf8');
      await fs.rename(tmp, this.file);
    } catch (err) {
      await fs.rm(tmp, { force: true }).catch(() => undefined);
      throw err;
    }
  }

  /** Serialise every mutation so concurrent requests cannot lose writes. */
  private tx<T>(fn: (db: Collections) => T | Promise<T>): Promise<T> {
    const run = async (): Promise<T> => {
      const db = await this.load();
      const result = await fn(db);
      await this.persist();
      return result;
    };
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async read<T>(fn: (db: Collections) => T): Promise<T> {
    const db = await this.load();
    return fn(db);
  }

  private static upsert<T extends { id: string }>(list: T[], item: T): T {
    const i = list.findIndex((x) => x.id === item.id);
    if (i >= 0) list[i] = item;
    else list.push(item);
    return item;
  }

  /* ---------------- workspace ---------------- */

  getWorkspace() {
    return this.read((db) => db.workspace);
  }
  saveWorkspace(w: Workspace) {
    return this.tx((db) => {
      db.workspace = w;
      return w;
    });
  }
  listMembers() {
    return this.read((db) => [...db.members]);
  }
  saveMember(m: Member) {
    return this.tx((db) => LocalStore.upsert(db.members, m));
  }
  removeMember(id: string) {
    return this.tx((db) => {
      db.members = db.members.filter((m) => m.id !== id);
    });
  }

  /* ---------------- context ---------------- */

  listContextDocs() {
    return this.read((db) => [...db.context_docs]);
  }
  getContextDoc(slug: ContextDoc['slug']) {
    return this.read((db) => db.context_docs.find((d) => d.slug === slug) ?? null);
  }
  saveContextDoc(doc: ContextDoc) {
    return this.tx((db) => {
      const i = db.context_docs.findIndex((d) => d.slug === doc.slug);
      if (i >= 0) db.context_docs[i] = doc;
      else db.context_docs.push(doc);
      return doc;
    });
  }
  getStrategyState() {
    return this.read((db) => db.strategy_state);
  }
  saveStrategyState(s: StrategyState) {
    return this.tx((db) => {
      db.strategy_state = s;
      return s;
    });
  }

  /* ---------------- weeks + units ---------------- */

  listWeeks() {
    return this.read((db) => [...db.weeks].sort((a, b) => a.id.localeCompare(b.id)));
  }
  getWeek(weekId: string) {
    return this.read((db) => db.weeks.find((w) => w.id === weekId) ?? null);
  }
  saveWeek(w: WeekPlan) {
    return this.tx((db) => LocalStore.upsert(db.weeks, w));
  }
  listUnits(filter?: { weekId?: string }) {
    return this.read((db) => {
      const units = filter?.weekId ? db.units.filter((u) => u.week_id === filter.weekId) : db.units;
      return [...units].sort(
        (a, b) => a.date.localeCompare(b.date) || a.position - b.position,
      );
    });
  }
  getUnit(id: string) {
    return this.read((db) => db.units.find((u) => u.id === id) ?? null);
  }
  saveUnit(u: ContentUnit) {
    return this.tx((db) => LocalStore.upsert(db.units, u));
  }
  deleteUnit(id: string) {
    return this.tx((db) => {
      db.units = db.units.filter((u) => u.id !== id);
    });
  }

  /* ---------------- revisions + comments ---------------- */

  listRevisions(unitId: string) {
    return this.read((db) =>
      db.revisions
        .filter((r) => r.content_unit_id === unitId)
        .sort((a, b) => b.revision_number - a.revision_number),
    );
  }
  saveRevision(r: Revision) {
    return this.tx((db) => LocalStore.upsert(db.revisions, r));
  }
  listComments(unitId?: string) {
    return this.read((db) =>
      db.comments
        .filter((c) => !unitId || c.content_unit_id === unitId)
        .sort((a, b) => a.created_at.localeCompare(b.created_at)),
    );
  }
  saveComment(c: Comment) {
    return this.tx((db) => LocalStore.upsert(db.comments, c));
  }

  /* ---------------- production + ideas ---------------- */

  listCoreVideos() {
    return this.read((db) => [...db.core_videos].sort((a, b) => a.id.localeCompare(b.id)));
  }
  getCoreVideo(id: string) {
    return this.read((db) => db.core_videos.find((v) => v.id === id) ?? null);
  }
  saveCoreVideo(v: CoreVideo) {
    return this.tx((db) => LocalStore.upsert(db.core_videos, v));
  }
  listBacklog() {
    return this.read((db) => [...db.backlog]);
  }
  getBacklogItem(id: string) {
    return this.read((db) => db.backlog.find((b) => b.id === id) ?? null);
  }
  saveBacklogItem(b: BacklogItem) {
    return this.tx((db) => LocalStore.upsert(db.backlog, b));
  }

  /* ---------------- analytics ---------------- */

  listReports(filter?: { unitId?: string }) {
    return this.read((db) =>
      db.reports
        .filter((r) => !filter?.unitId || r.content_unit_id === filter.unitId)
        .sort((a, b) => a.created_at.localeCompare(b.created_at)),
    );
  }
  getReport(id: string) {
    return this.read((db) => db.reports.find((r) => r.id === id) ?? null);
  }
  saveReport(r: AnalyticsReport) {
    return this.tx((db) => LocalStore.upsert(db.reports, r));
  }

  /* ---------------- memory ---------------- */

  listLearnings() {
    return this.read((db) =>
      [...db.learnings].sort((a, b) => b.created_at.localeCompare(a.created_at)),
    );
  }
  saveLearning(l: Learning) {
    return this.tx((db) => LocalStore.upsert(db.learnings, l));
  }
  listReviews() {
    return this.read((db) => [...db.reviews].sort((a, b) => a.week_id.localeCompare(b.week_id)));
  }
  getReview(weekId: string) {
    return this.read((db) => db.reviews.find((r) => r.week_id === weekId) ?? null);
  }
  saveReview(r: WeeklyReview) {
    return this.tx((db) => {
      const i = db.reviews.findIndex((x) => x.week_id === r.week_id);
      if (i >= 0) db.reviews[i] = r;
      else db.reviews.push(r);
      return r;
    });
  }
  listSummaries() {
    return this.read((db) => [...db.summaries]);
  }
  saveSummary(s: Summary) {
    return this.tx((db) => LocalStore.upsert(db.summaries, s));
  }

  /* ---------------- strategy governance ---------------- */

  listStrategyChanges() {
    return this.read((db) =>
      [...db.strategy_changes].sort((a, b) => b.created_at.localeCompare(a.created_at)),
    );
  }
  saveStrategyChange(c: StrategyChange) {
    return this.tx((db) => LocalStore.upsert(db.strategy_changes, c));
  }

  /* ---------------- chat ---------------- */

  listThreads() {
    return this.read((db) => [...db.threads]);
  }
  getThread(id: string) {
    return this.read((db) => db.threads.find((t) => t.id === id) ?? null);
  }
  saveThread(t: ChatThread) {
    return this.tx((db) => LocalStore.upsert(db.threads, t));
  }
  listMessages(threadId: string) {
    return this.read((db) =>
      db.messages
        .filter((m) => m.thread_id === threadId)
        .sort((a, b) => a.created_at.localeCompare(b.created_at)),
    );
  }
  saveMessage(m: ChatMessage) {
    return this.tx((db) => LocalStore.upsert(db.messages, m));
  }

  /* ---------------- sync log ---------------- */

  listSyncLog(limit = 20) {
    return this.read((db) =>
      [...db.sync_log].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, limit),
    );
  }
  saveSyncLog(e: SyncLogEntry) {
    return this.tx((db) => {
      LocalStore.upsert(db.sync_log, e);
      if (db.sync_log.length > 200) {
        db.sync_log = db.sync_log
          .sort((a, b) => b.created_at.localeCompare(a.created_at))
          .slice(0, 200);
      }
      return e;
    });
  }

  /* ---------------- attachments ---------------- */

  async putAttachment(p: string, data: Buffer, contentType: string): Promise<string> {
    const full = path.join(this.attachmentDir, p);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, data);
    await fs.writeFile(`${full}.meta`, contentType, 'utf8');
    return `/api/attachments/${p}`;
  }

  async getAttachment(p: string) {
    const full = path.join(this.attachmentDir, p);
    try {
      const data = await fs.readFile(full);
      const contentType = await fs.readFile(`${full}.meta`, 'utf8').catch(() => 'image/png');
      return { data, contentType };
    } catch {
      return null;
    }
  }

  async resetContent(): Promise<void> {
    await this.tx((db) => {
      const keep = { workspace: db.workspace, context_docs: db.context_docs, members: db.members };
      Object.assign(db, EMPTY(), keep);
    });
  }
}

export { DEFAULT_WORKSPACE_ID };
