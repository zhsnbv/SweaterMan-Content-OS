import { z } from 'zod';
import {
  ANALYTICS_WINDOWS,
  BACKLOG_STATUSES,
  CONFIDENCE_LEVELS,
  CONTENT_TYPES,
  CORE_VIDEO_STAGES,
  EFFORTS,
  LEARNING_CATEGORIES,
  METRIC_KEYS,
  PLATFORMS,
  PUBLISH_STATUSES,
  REVIEW_RESULTS,
  ROLES,
  SLOT_TYPES,
  STRATEGY_CHANGE_STATUSES,
  UNIT_STATUSES,
} from './enums';

export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');
export const weekId = z.string().regex(/^\d{4}-W\d{2}$/, 'expected YYYY-Www');
export const isoDateTime = z.string().datetime({ offset: true }).or(z.string().datetime());

export const platformEnum = z.enum(PLATFORMS);
export const contentTypeEnum = z.enum(CONTENT_TYPES);
export const slotTypeEnum = z.enum(SLOT_TYPES);
export const unitStatusEnum = z.enum(UNIT_STATUSES);
export const publishStatusEnum = z.enum(PUBLISH_STATUSES);
export const effortEnum = z.enum(EFFORTS);
export const analyticsWindowEnum = z.enum(ANALYTICS_WINDOWS);
export const confidenceEnum = z.enum(CONFIDENCE_LEVELS);
export const roleEnum = z.enum(ROLES);

/* ------------------------------------------------------------------ *
 * Platform variant
 * ------------------------------------------------------------------ */

export const platformVariantSchema = z.object({
  id: z.string(),
  content_unit_id: z.string(),
  platform: platformEnum,
  surface: z.string(),
  format: z.string(),
  /** Copy that can be pasted as-is. No placeholders, no "[insert hook]". */
  ready_to_use_copy: z.string().default(''),
  hook: z.string().default(''),
  visual_instruction: z.string().default(''),
  cta: z.string().default(''),
  publish_status: publishStatusEnum.default('not_published'),
  publish_url: z.string().default(''),
  published_at: z.string().nullable().default(null),
  position: z.number().int().default(0),
});
export type PlatformVariant = z.infer<typeof platformVariantSchema>;

/* ------------------------------------------------------------------ *
 * Content unit — the central entity. One idea, many platform variants.
 * ------------------------------------------------------------------ */

export const assetRefSchema = z.object({
  label: z.string(),
  url: z.string().default(''),
  kind: z.string().default('asset'),
});
export type AssetRef = z.infer<typeof assetRefSchema>;

export const analyticsStatusSchema = z.object({
  '24h_due': z.boolean().default(false),
  '24h_complete': z.boolean().default(false),
  '72h_due': z.boolean().default(false),
  '72h_complete': z.boolean().default(false),
  '7d_due': z.boolean().default(false),
  '7d_complete': z.boolean().default(false),
  '30d_due': z.boolean().default(false),
  '30d_complete': z.boolean().default(false),
});
export type AnalyticsStatus = z.infer<typeof analyticsStatusSchema>;

export const emptyAnalyticsStatus = (): AnalyticsStatus =>
  analyticsStatusSchema.parse({});

export const contentUnitSchema = z.object({
  id: z.string(),
  workspace_id: z.string(),
  week_id: weekId,
  date: isoDate,
  scheduled_time: z.string().nullable().default(null),
  title: z.string(),
  slot_type: slotTypeEnum.default('custom'),
  content_type: contentTypeEnum,
  /** Where the idea came from: core_video_research, storyboard, backlog, comment, … */
  source: z.string().default(''),
  related_core_video_id: z.string().nullable().default(null),
  objective: z.string().default(''),
  hypothesis: z.string().default(''),
  /**
   * NOT a views forecast. A readable "if X happens, it means Y" statement.
   */
  expected_signal: z.string().default(''),
  estimated_effort: effortEnum.default('S'),
  status: unitStatusEnum.default('idea'),
  owner: z.string().default(''),
  platforms: z.array(platformVariantSchema).default([]),
  assets: z.array(assetRefSchema).default([]),
  references: z.array(z.string()).default([]),
  figma_url: z.string().default(''),
  notes: z.string().default(''),
  user_feedback: z.array(z.string()).default([]),
  ai_reasoning_short: z.string().default(''),
  revision_number: z.number().int().default(1),
  analytics_status: analyticsStatusSchema.default(() => emptyAnalyticsStatus()),
  position: z.number().int().default(0),
  created_at: z.string(),
  updated_at: z.string(),
});
export type ContentUnit = z.infer<typeof contentUnitSchema>;

/* ------------------------------------------------------------------ *
 * Core video
 * ------------------------------------------------------------------ */

export const coreVideoSchema = z.object({
  id: z.string(),
  workspace_id: z.string(),
  working_title: z.string(),
  topic: z.string().default(''),
  cluster: z.string().default(''),
  planned_publish_date: isoDate.nullable().default(null),
  status: z.string().default('active'),
  script: z.string().default(''),
  storyboard_text: z.string().default(''),
  storyboard_url: z.string().default(''),
  figma_url: z.string().default(''),
  references: z.array(z.string()).default([]),
  production_stage: z.enum(CORE_VIDEO_STAGES).default('idea'),
  available_assets: z.array(assetRefSchema).default([]),
  production_notes: z.string().default(''),
  attached_files: z.array(assetRefSchema).default([]),
  created_at: z.string(),
  updated_at: z.string(),
});
export type CoreVideo = z.infer<typeof coreVideoSchema>;

/* ------------------------------------------------------------------ *
 * Backlog
 * ------------------------------------------------------------------ */

export const backlogItemSchema = z.object({
  id: z.string(),
  workspace_id: z.string(),
  title: z.string(),
  source: z.string().default(''),
  cluster: z.string().default(''),
  why_interesting: z.string().default(''),
  suggested_test: z.string().default(''),
  status: z.enum(BACKLOG_STATUSES).default('RAW'),
  /** Free-text evidence entries; each should point at a unit or a report. */
  evidence: z.array(z.string()).default([]),
  notes: z.string().default(''),
  created_at: z.string(),
  updated_at: z.string(),
});
export type BacklogItem = z.infer<typeof backlogItemSchema>;

/* ------------------------------------------------------------------ *
 * Weeks
 * ------------------------------------------------------------------ */

export const weekPlanSchema = z.object({
  id: weekId,
  workspace_id: z.string(),
  start_date: isoDate,
  end_date: isoDate,
  /** Short note from the planner explaining the shape of this week. */
  planning_note: z.string().default(''),
  generated_by: z.string().default(''),
  created_at: z.string(),
  updated_at: z.string(),
});
export type WeekPlan = z.infer<typeof weekPlanSchema>;

/* ------------------------------------------------------------------ *
 * Comments / chat
 * ------------------------------------------------------------------ */

export const commentSchema = z.object({
  id: z.string(),
  content_unit_id: z.string(),
  author: z.string(),
  author_role: roleEnum.default('EDITOR'),
  message: z.string(),
  ai_invoked: z.boolean().default(false),
  ai_response: z.string().default(''),
  revision_id: z.string().nullable().default(null),
  created_at: z.string(),
});
export type Comment = z.infer<typeof commentSchema>;

export const chatMessageSchema = z.object({
  id: z.string(),
  thread_id: z.string(),
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string(),
  /** Names of tools the assistant called while producing this message. */
  tool_calls: z.array(z.object({ name: z.string(), summary: z.string() })).default([]),
  created_at: z.string(),
});
export type ChatMessage = z.infer<typeof chatMessageSchema>;

export const chatThreadSchema = z.object({
  id: z.string(),
  workspace_id: z.string(),
  scope: z.enum(['workspace', 'week', 'content_unit', 'core_video']),
  scope_ref: z.string().nullable().default(null),
  title: z.string().default(''),
  created_at: z.string(),
});
export type ChatThread = z.infer<typeof chatThreadSchema>;

/* ------------------------------------------------------------------ *
 * Revisions — every AI mutation is reversible.
 * ------------------------------------------------------------------ */

export const revisionSchema = z.object({
  id: z.string(),
  content_unit_id: z.string(),
  revision_number: z.number().int(),
  /** Full snapshot of the unit *before* the change. */
  snapshot: z.record(z.string(), z.any()),
  diff_summary: z.string().default(''),
  changed_fields: z.array(z.string()).default([]),
  reason: z.string().default(''),
  actor: z.string().default('ai'),
  created_at: z.string(),
});
export type Revision = z.infer<typeof revisionSchema>;

/* ------------------------------------------------------------------ *
 * Analytics
 * ------------------------------------------------------------------ */

export const metricValueSchema = z.object({
  key: z.enum(METRIC_KEYS),
  /** null means "not visible in the screenshot" — never invented. */
  value: z.number().nullable(),
  raw: z.string().default(''),
});
export type MetricValue = z.infer<typeof metricValueSchema>;

export const analyticsReportSchema = z.object({
  id: z.string(),
  content_unit_id: z.string(),
  platform: platformEnum,
  window: analyticsWindowEnum,
  publish_url: z.string().default(''),
  screenshots: z.array(z.string()).default([]),
  extracted_metrics: z.array(metricValueSchema).default([]),
  confirmed_metrics: z.array(metricValueSchema).default([]),
  confirmed: z.boolean().default(false),
  user_notes: z.string().default(''),
  ai_observation: z.string().default(''),
  created_at: z.string(),
  confirmed_at: z.string().nullable().default(null),
});
export type AnalyticsReport = z.infer<typeof analyticsReportSchema>;

/* ------------------------------------------------------------------ *
 * Learnings — append-only, always carrying evidence.
 * ------------------------------------------------------------------ */

export const learningSchema = z.object({
  id: z.string(),
  workspace_id: z.string(),
  created_at: z.string(),
  category: z.enum(LEARNING_CATEGORIES),
  observation: z.string(),
  evidence: z.array(z.string()).min(1),
  confidence: confidenceEnum,
  action: z.string().default(''),
  tags: z.array(z.string()).default([]),
  source_units: z.array(z.string()).default([]),
  /** Set when a later learning supersedes this one. Nothing is ever deleted. */
  superseded_by: z.string().nullable().default(null),
});
export type Learning = z.infer<typeof learningSchema>;

/* ------------------------------------------------------------------ *
 * Weekly review
 * ------------------------------------------------------------------ */

export const reviewUnitEntrySchema = z.object({
  content_unit_id: z.string(),
  title: z.string(),
  what_we_wanted_to_test: z.string(),
  what_happened: z.string(),
  result: z.enum(REVIEW_RESULTS),
  what_to_repeat: z.string().default(''),
  what_to_change: z.string().default(''),
});
export type ReviewUnitEntry = z.infer<typeof reviewUnitEntrySchema>;

export const weeklyReviewSchema = z.object({
  id: z.string(),
  workspace_id: z.string(),
  week_id: weekId,
  units: z.array(reviewUnitEntrySchema).default([]),
  content_summary: z.string().default(''),
  production_summary: z.string().default(''),
  funnel_summary: z.string().default(''),
  backlog_summary: z.string().default(''),
  user_feedback_summary: z.string().default(''),
  next_week_changes: z.string().default(''),
  generated_by: z.string().default(''),
  created_at: z.string(),
});
export type WeeklyReview = z.infer<typeof weeklyReviewSchema>;

/* ------------------------------------------------------------------ *
 * Strategy: operational state (mutable) vs fundamental docs (approval-gated)
 * ------------------------------------------------------------------ */

export const strategyStateSchema = z.object({
  updated_at: z.string(),
  /** Free-form operational knobs the weekly review is allowed to move. */
  current_focus: z.string().default(''),
  active_experiments: z.array(z.string()).default([]),
  content_mix_intent: z.string().default(''),
  sales_level: z.enum(['none', 'micro', 'soft', 'direct']).default('micro'),
  telegram_reason_rotation: z.array(z.enum(['A', 'B', 'C'])).default(['A', 'B', 'C']),
  effort_budget_note: z.string().default(''),
  open_questions: z.array(z.string()).default([]),
  notes: z.string().default(''),
});
export type StrategyState = z.infer<typeof strategyStateSchema>;

export const strategyChangeSchema = z.object({
  id: z.string(),
  workspace_id: z.string(),
  target_doc: z.enum(['MASTER_CONTEXT', 'FUNNEL_PLAYBOOK', 'PRODUCTION_PIPELINE']),
  rationale: z.string(),
  proposed_change: z.string(),
  evidence: z.array(z.string()).default([]),
  status: z.enum(STRATEGY_CHANGE_STATUSES).default('PROPOSED'),
  created_at: z.string(),
  decided_at: z.string().nullable().default(null),
  decided_by: z.string().nullable().default(null),
});
export type StrategyChange = z.infer<typeof strategyChangeSchema>;

/* ------------------------------------------------------------------ *
 * Context docs, workspace, sync log
 * ------------------------------------------------------------------ */

export const contextDocSchema = z.object({
  slug: z.enum([
    'MASTER_CONTEXT',
    'PERFORMANCE_INSIGHTS',
    'FUNNEL_PLAYBOOK',
    'PRODUCTION_PIPELINE',
  ]),
  title: z.string(),
  body: z.string(),
  updated_at: z.string(),
  /** Fundamental docs may only change through an approved strategy change. */
  immutable: z.boolean().default(true),
});
export type ContextDoc = z.infer<typeof contextDocSchema>;

export const workspaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  created_at: z.string(),
  setup_complete: z.boolean().default(false),
});
export type Workspace = z.infer<typeof workspaceSchema>;

export const memberSchema = z.object({
  id: z.string(),
  workspace_id: z.string(),
  email: z.string(),
  name: z.string(),
  role: roleEnum,
  created_at: z.string(),
});
export type Member = z.infer<typeof memberSchema>;

export const syncLogEntrySchema = z.object({
  id: z.string(),
  workspace_id: z.string(),
  status: z.enum(['pending', 'ok', 'failed']),
  message: z.string(),
  files: z.array(z.string()).default([]),
  commit_sha: z.string().nullable().default(null),
  error: z.string().nullable().default(null),
  created_at: z.string(),
});
export type SyncLogEntry = z.infer<typeof syncLogEntrySchema>;

export const summarySchema = z.object({
  id: z.string(),
  workspace_id: z.string(),
  /** e.g. 2026-09-editorial, 2026-Q4-production */
  key: z.string(),
  period: z.string(),
  kind: z.enum(['editorial', 'production', 'funnel']),
  body: z.string(),
  source_count: z.number().int().default(0),
  created_at: z.string(),
});
export type Summary = z.infer<typeof summarySchema>;
