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

export type ContextSlug = ContextDoc['slug'];

export interface Store {
  readonly kind: 'local' | 'supabase';

  /* workspace */
  getWorkspace(): Promise<Workspace>;
  saveWorkspace(w: Workspace): Promise<Workspace>;
  listMembers(): Promise<Member[]>;
  saveMember(m: Member): Promise<Member>;
  removeMember(id: string): Promise<void>;

  /* persistent context */
  listContextDocs(): Promise<ContextDoc[]>;
  getContextDoc(slug: ContextSlug): Promise<ContextDoc | null>;
  saveContextDoc(doc: ContextDoc): Promise<ContextDoc>;
  getStrategyState(): Promise<StrategyState>;
  saveStrategyState(s: StrategyState): Promise<StrategyState>;

  /* weeks + units */
  listWeeks(): Promise<WeekPlan[]>;
  getWeek(weekId: string): Promise<WeekPlan | null>;
  saveWeek(w: WeekPlan): Promise<WeekPlan>;
  listUnits(filter?: { weekId?: string }): Promise<ContentUnit[]>;
  getUnit(id: string): Promise<ContentUnit | null>;
  saveUnit(u: ContentUnit): Promise<ContentUnit>;
  deleteUnit(id: string): Promise<void>;

  /* revisions + comments */
  listRevisions(unitId: string): Promise<Revision[]>;
  saveRevision(r: Revision): Promise<Revision>;
  listComments(unitId?: string): Promise<Comment[]>;
  saveComment(c: Comment): Promise<Comment>;

  /* production + ideas */
  listCoreVideos(): Promise<CoreVideo[]>;
  getCoreVideo(id: string): Promise<CoreVideo | null>;
  saveCoreVideo(v: CoreVideo): Promise<CoreVideo>;
  listBacklog(): Promise<BacklogItem[]>;
  getBacklogItem(id: string): Promise<BacklogItem | null>;
  saveBacklogItem(b: BacklogItem): Promise<BacklogItem>;

  /* analytics */
  listReports(filter?: { unitId?: string }): Promise<AnalyticsReport[]>;
  getReport(id: string): Promise<AnalyticsReport | null>;
  saveReport(r: AnalyticsReport): Promise<AnalyticsReport>;

  /* memory */
  listLearnings(): Promise<Learning[]>;
  saveLearning(l: Learning): Promise<Learning>;
  listReviews(): Promise<WeeklyReview[]>;
  getReview(weekId: string): Promise<WeeklyReview | null>;
  saveReview(r: WeeklyReview): Promise<WeeklyReview>;
  listSummaries(): Promise<Summary[]>;
  saveSummary(s: Summary): Promise<Summary>;

  /* strategy governance */
  listStrategyChanges(): Promise<StrategyChange[]>;
  saveStrategyChange(c: StrategyChange): Promise<StrategyChange>;

  /* chat */
  listThreads(): Promise<ChatThread[]>;
  getThread(id: string): Promise<ChatThread | null>;
  saveThread(t: ChatThread): Promise<ChatThread>;
  listMessages(threadId: string): Promise<ChatMessage[]>;
  saveMessage(m: ChatMessage): Promise<ChatMessage>;

  /* sync log */
  listSyncLog(limit?: number): Promise<SyncLogEntry[]>;
  saveSyncLog(e: SyncLogEntry): Promise<SyncLogEntry>;

  /* attachments (screenshots etc.) */
  putAttachment(path: string, data: Buffer, contentType: string): Promise<string>;
  getAttachment(path: string): Promise<{ data: Buffer; contentType: string } | null>;

  /** Wipe everything except the persistent context docs. Used by "clear demo data". */
  resetContent(): Promise<void>;
}
