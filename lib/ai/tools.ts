import { z } from 'zod';
import type { Store } from '@/lib/store';
import type { Scope } from './context-builder';
import { buildContextBundle, previousWeekSnapshot, renderContextBundle } from './context-builder';
import {
  createUnit,
  moveUnit,
  updatePlatformVariant,
  updateUnit,
  type UnitPatch,
} from '@/lib/services/units';
import { recordLearning } from '@/lib/services/learnings';
import { runWeeklyReview } from '@/lib/services/review';
import { buildWeekSkeleton, planningNote } from '@/lib/services/planner';
import { queueSync } from '@/lib/github/sync';
import { weekDates, weekEnd, weekStart } from '@/lib/domain/week';
import { format } from 'date-fns';
import { backlogItemSchema, strategyChangeSchema, weekPlanSchema } from '@/lib/domain/schema';
import { slugId, uid } from '@/lib/domain/ids';
import {
  BACKLOG_STATUSES,
  CONFIDENCE_LEVELS,
  CONTENT_TYPES,
  EFFORTS,
  LEARNING_CATEGORIES,
  PLATFORMS,
  SLOT_TYPES,
  UNIT_STATUSES,
} from '@/lib/domain/enums';

export type ToolContext = {
  store: Store;
  workspaceId: string;
  actor: string;
  /** Hard boundary: a card-scoped chat may only touch that card. */
  scope: Scope;
  /** Names of tools that actually ran, for the activity log. */
  calls: Array<{ name: string; summary: string }>;
};

export type ToolDef<I extends z.ZodTypeAny = z.ZodTypeAny> = {
  name: string;
  description: string;
  inputSchema: I;
  /** Read-only tools never mutate and never trigger a sync. */
  readOnly: boolean;
  execute: (ctx: ToolContext, input: z.infer<I>) => Promise<unknown>;
};

/** Erased form used by the registry; `defineTool` keeps input types inferred. */
export type AnyToolDef = Omit<ToolDef, 'execute'> & {
  execute: (ctx: ToolContext, input: any) => Promise<unknown>;
};

export function defineTool<I extends z.ZodTypeAny>(def: ToolDef<I>): AnyToolDef {
  return def as unknown as AnyToolDef;
}

function assertUnitInScope(ctx: ToolContext, unitId: string): void {
  if (ctx.scope.kind === 'content_unit' && ctx.scope.unitId !== unitId) {
    throw new Error(
      `Scope violation: this chat is scoped to ${ctx.scope.unitId} and may not modify ${unitId}.`,
    );
  }
}

const variantInput = z.object({
  platform: z.enum(PLATFORMS),
  surface: z.string().describe('e.g. story, reel, carousel, shorts, community_poll, bot_broadcast'),
  format: z.string().default(''),
  hook: z.string().default(''),
  ready_to_use_copy: z.string().default('').describe('Copy that can be pasted as-is. No placeholders.'),
  visual_instruction: z.string().default(''),
  cta: z.string().default(''),
});

const unitFields = {
  title: z.string().optional(),
  date: z.string().optional().describe('YYYY-MM-DD, must be inside the week'),
  slot_type: z.enum(SLOT_TYPES).optional(),
  content_type: z.enum(CONTENT_TYPES).optional(),
  source: z.string().optional(),
  related_core_video_id: z.string().nullable().optional(),
  objective: z.string().optional(),
  hypothesis: z.string().optional(),
  expected_signal: z
    .string()
    .optional()
    .describe('NOT a views forecast. "If X happens it means Y."'),
  estimated_effort: z.enum(EFFORTS).optional(),
  status: z.enum(UNIT_STATUSES).optional(),
  notes: z.string().optional(),
  ai_reasoning_short: z.string().optional(),
  platforms: z.array(variantInput).optional().describe('Full replacement of the variant set'),
};

/* ------------------------------------------------------------------ *
 * Tool definitions
 * ------------------------------------------------------------------ */

export const TOOLS: AnyToolDef[] = [
  defineTool({
    name: 'get_workspace_context',
    description:
      'Read the persistent strategic context: MASTER_CONTEXT, FUNNEL_PLAYBOOK, PRODUCTION_PIPELINE, strategy_state, relevant learnings. Call this when you need grounding beyond what is already in the prompt.',
    inputSchema: z.object({}),
    readOnly: true,
    execute: async (ctx) => {
      const bundle = await buildContextBundle(ctx.store, { kind: 'workspace' });
      return { context: renderContextBundle(bundle) };
    },
  }),
  defineTool({
    name: 'get_current_week',
    description: 'Return the plan and all content units for a week (defaults to the chat scope).',
    inputSchema: z.object({ week_id: z.string().optional() }),
    readOnly: true,
    execute: async (ctx, input) => {
      const weekId = input.week_id ?? scopeWeekId(ctx);
      if (!weekId) return { error: 'No week in scope' };
      const [week, units] = await Promise.all([
        ctx.store.getWeek(weekId),
        ctx.store.listUnits({ weekId }),
      ]);
      return { week_id: weekId, week, units };
    },
  }),
  defineTool({
    name: 'get_previous_week',
    description:
      'Return the previous week: its units, whether it was published, and whether a weekly review already exists.',
    inputSchema: z.object({ week_id: z.string().optional() }),
    readOnly: true,
    execute: async (ctx, input) => {
      const weekId = input.week_id ?? scopeWeekId(ctx);
      if (!weekId) return { error: 'No week in scope' };
      const snap = await previousWeekSnapshot(ctx.store, weekId);
      return {
        week_id: snap.weekId,
        units: snap.units,
        review_exists: Boolean(snap.review),
        review: snap.review,
      };
    },
  }),
  defineTool({
    name: 'get_core_videos',
    description:
      'List core videos with production stage and available assets. Use this to build supporting content from material that already exists.',
    inputSchema: z.object({ upcoming_only: z.boolean().default(true) }),
    readOnly: true,
    execute: async (ctx, input) => {
      const all = await ctx.store.listCoreVideos();
      return {
        core_videos: input.upcoming_only
          ? all.filter((v) => v.production_stage !== 'published')
          : all,
      };
    },
  }),
  defineTool({
    name: 'get_backlog',
    description: 'List backlog topic ideas with their statuses and evidence.',
    inputSchema: z.object({ status: z.enum(BACKLOG_STATUSES).optional() }),
    readOnly: true,
    execute: async (ctx, input) => {
      const items = await ctx.store.listBacklog();
      return { backlog: input.status ? items.filter((b) => b.status === input.status) : items };
    },
  }),
  defineTool({
    name: 'get_relevant_learnings',
    description:
      'Return evidence-based learnings ranked by relevance. Each carries evidence and a confidence level — respect them; do not treat LOW as proven.',
    inputSchema: z.object({
      categories: z.array(z.enum(LEARNING_CATEGORIES)).optional(),
      limit: z.number().int().min(1).max(30).default(12),
    }),
    readOnly: true,
    execute: async (ctx, input) => {
      const { rankLearnings } = await import('@/lib/services/learnings');
      const all = await ctx.store.listLearnings();
      return { learnings: rankLearnings(all, { categories: input.categories, limit: input.limit }) };
    },
  }),
  defineTool({
    name: 'get_analytics',
    description:
      'Return analytics reports. Only reports with confirmed=true carry numbers the user has verified; never treat extracted-but-unconfirmed numbers as facts.',
    inputSchema: z.object({
      content_unit_id: z.string().optional(),
      confirmed_only: z.boolean().default(true),
    }),
    readOnly: true,
    execute: async (ctx, input) => {
      const reports = await ctx.store.listReports(
        input.content_unit_id ? { unitId: input.content_unit_id } : undefined,
      );
      return { reports: input.confirmed_only ? reports.filter((r) => r.confirmed) : reports };
    },
  }),

  /* ---------------- mutations ---------------- */

  defineTool({
    name: 'create_week_plan',
    description:
      'Create (or replace) the calendar for a week. Provide the full set of content units. Use the weekly rhythm as a template, not a law — skip or move a slot when the data says so.',
    inputSchema: z.object({
      week_id: z.string(),
      planning_note: z.string().default(''),
      replace_existing: z.boolean().default(false),
      units: z
        .array(
          z.object({
            title: z.string(),
            date: z.string(),
            content_type: z.enum(CONTENT_TYPES),
            slot_type: z.enum(SLOT_TYPES).default('custom'),
            source: z.string().default(''),
            related_core_video_id: z.string().nullable().default(null),
            objective: z.string().default(''),
            hypothesis: z.string().default(''),
            expected_signal: z.string().default(''),
            estimated_effort: z.enum(EFFORTS).default('S'),
            ai_reasoning_short: z.string().default(''),
            platforms: z.array(variantInput).default([]),
          }),
        )
        .default([]),
    }),
    readOnly: false,
    execute: async (ctx, input) => {
      const weekId = input.week_id;
      const dates = weekDates(weekId);
      const existing = await ctx.store.listUnits({ weekId });

      const survivors: typeof existing = [];
      if (input.replace_existing) {
        for (const u of existing) {
          // Published work is history and is never wiped by a regeneration.
          const published = u.platforms.some((p) => p.publish_status === 'published');
          if (published) survivors.push(u);
          else await ctx.store.deleteUnit(u.id);
        }
      } else {
        survivors.push(...existing);
      }

      // A card that survived because it was already published must not be
      // proposed a second time — otherwise every regeneration duplicates it.
      const taken = new Set(survivors.map((u) => normalizeTitle(u.title)));

      const now = new Date().toISOString();
      const week = weekPlanSchema.parse({
        id: weekId,
        workspace_id: ctx.workspaceId,
        start_date: format(weekStart(weekId), 'yyyy-MM-dd'),
        end_date: format(weekEnd(weekId), 'yyyy-MM-dd'),
        planning_note: input.planning_note,
        generated_by: ctx.actor,
        created_at: (await ctx.store.getWeek(weekId))?.created_at ?? now,
        updated_at: now,
      });
      await ctx.store.saveWeek(week);

      const created = [];
      let skipped = 0;
      for (const u of input.units) {
        if (taken.has(normalizeTitle(u.title))) {
          skipped += 1;
          continue;
        }
        taken.add(normalizeTitle(u.title));
        const date = dates.includes(u.date) ? u.date : dates[0];
        created.push(
          await createUnit(ctx.store, ctx.workspaceId, weekId, { ...u, date } as never),
        );
      }

      ctx.calls.push({
        name: 'create_week_plan',
        summary: `${weekId}: ${created.length} карточек${skipped ? `, пропущено дублей: ${skipped}` : ''}`,
      });
      queueSync(ctx.store, ctx.workspaceId, { kind: 'week', weekId }, `content: generate plan for ${weekId}`);
      return {
        week,
        created_ids: created.map((c) => c.id),
        count: created.length,
        kept_published: survivors.map((u) => u.id),
        skipped_duplicates: skipped,
      };
    },
  }),
  defineTool({
    name: 'update_week_plan',
    description: 'Update the planning note of a week without touching its cards.',
    inputSchema: z.object({ week_id: z.string(), planning_note: z.string() }),
    readOnly: false,
    execute: async (ctx, input) => {
      const week = await ctx.store.getWeek(input.week_id);
      if (!week) throw new Error(`Week not found: ${input.week_id}`);
      const next = { ...week, planning_note: input.planning_note, updated_at: new Date().toISOString() };
      await ctx.store.saveWeek(next);
      ctx.calls.push({ name: 'update_week_plan', summary: input.week_id });
      queueSync(ctx.store, ctx.workspaceId, { kind: 'week', weekId: input.week_id }, `content: update plan note for ${input.week_id}`);
      return { week: next };
    },
  }),
  defineTool({
    name: 'create_content_unit',
    description: 'Add one content unit to a week. One idea, one or more platform variants.',
    inputSchema: z.object({
      week_id: z.string(),
      title: z.string(),
      date: z.string(),
      content_type: z.enum(CONTENT_TYPES),
      slot_type: z.enum(SLOT_TYPES).default('custom'),
      source: z.string().default(''),
      related_core_video_id: z.string().nullable().default(null),
      objective: z.string().default(''),
      hypothesis: z.string().default(''),
      expected_signal: z.string().default(''),
      estimated_effort: z.enum(EFFORTS).default('S'),
      ai_reasoning_short: z.string().default(''),
      platforms: z.array(variantInput).default([]),
    }),
    readOnly: false,
    execute: async (ctx, input) => {
      if (ctx.scope.kind === 'content_unit') {
        throw new Error('Scope violation: a card-scoped chat cannot create new cards.');
      }
      const unit = await createUnit(ctx.store, ctx.workspaceId, input.week_id, input as never);
      ctx.calls.push({ name: 'create_content_unit', summary: `${unit.id} — ${unit.title}` });
      queueSync(ctx.store, ctx.workspaceId, { kind: 'unit', unitId: unit.id }, `content: add ${unit.id}`);
      return { unit };
    },
  }),
  defineTool({
    name: 'update_content_unit',
    description:
      'Change ONE content unit. Every change is snapshotted as a revision and is reversible. In a card-scoped chat this is the main tool — change only the card in scope.',
    inputSchema: z.object({
      content_unit_id: z.string(),
      reason: z.string().default('').describe('Short reason, shown in the revision history'),
      ...unitFields,
    }),
    readOnly: false,
    execute: async (ctx, input) => {
      assertUnitInScope(ctx, input.content_unit_id);
      const { content_unit_id, reason, ...patch } = input;
      const result = await updateUnit(ctx.store, content_unit_id, patch as UnitPatch, {
        reason,
        actor: ctx.actor,
      });
      ctx.calls.push({
        name: 'update_content_unit',
        summary: `${content_unit_id}: ${result.diffs.length} изменений`,
      });
      queueSync(
        ctx.store,
        ctx.workspaceId,
        { kind: 'unit', unitId: content_unit_id },
        `content: revise ${content_unit_id} from user feedback`,
      );
      return {
        unit: result.unit,
        diff: result.diffs,
        diff_summary: result.diffSummary,
        revision_number: result.unit.revision_number,
      };
    },
  }),
  defineTool({
    name: 'move_content_unit',
    description: 'Move a card to another day inside its week.',
    inputSchema: z.object({ content_unit_id: z.string(), date: z.string() }),
    readOnly: false,
    execute: async (ctx, input) => {
      assertUnitInScope(ctx, input.content_unit_id);
      const result = await moveUnit(ctx.store, input.content_unit_id, input.date, {
        actor: ctx.actor,
      });
      ctx.calls.push({
        name: 'move_content_unit',
        summary: `${input.content_unit_id} → ${input.date}`,
      });
      queueSync(
        ctx.store,
        ctx.workspaceId,
        { kind: 'unit', unitId: input.content_unit_id },
        `content: move ${input.content_unit_id} to ${input.date}`,
      );
      return { unit: result.unit, diff_summary: result.diffSummary };
    },
  }),
  defineTool({
    name: 'update_platform_variant',
    description:
      'Change one platform variant of a card (its copy, hook, visual instruction or CTA) without touching the others.',
    inputSchema: z.object({
      content_unit_id: z.string(),
      platform: z.enum(PLATFORMS),
      surface: z.string().optional(),
      reason: z.string().default(''),
      patch: z.object({
        surface: z.string().optional(),
        format: z.string().optional(),
        hook: z.string().optional(),
        ready_to_use_copy: z.string().optional(),
        visual_instruction: z.string().optional(),
        cta: z.string().optional(),
      }),
    }),
    readOnly: false,
    execute: async (ctx, input) => {
      assertUnitInScope(ctx, input.content_unit_id);
      const result = await updatePlatformVariant(
        ctx.store,
        input.content_unit_id,
        { platform: input.platform, surface: input.surface },
        input.patch,
        { reason: input.reason, actor: ctx.actor },
      );
      ctx.calls.push({
        name: 'update_platform_variant',
        summary: `${input.content_unit_id} / ${input.platform}`,
      });
      queueSync(
        ctx.store,
        ctx.workspaceId,
        { kind: 'unit', unitId: input.content_unit_id },
        `content: revise ${input.content_unit_id} ${input.platform} variant`,
      );
      return { unit: result.unit, diff: result.diffs, diff_summary: result.diffSummary };
    },
  }),
  defineTool({
    name: 'record_user_feedback',
    description:
      'Persist what the user or a teammate said about a card, so future planning never repeats a rejected idea. Always call this when acting on feedback.',
    inputSchema: z.object({ content_unit_id: z.string(), feedback: z.string() }),
    readOnly: false,
    execute: async (ctx, input) => {
      assertUnitInScope(ctx, input.content_unit_id);
      const result = await updateUnit(
        ctx.store,
        input.content_unit_id,
        {},
        { userFeedback: input.feedback, actor: ctx.actor, reason: 'record feedback' },
      );
      ctx.calls.push({ name: 'record_user_feedback', summary: input.content_unit_id });
      return { user_feedback: result.unit.user_feedback };
    },
  }),
  defineTool({
    name: 'add_backlog_item',
    description: 'Add a topic idea to the backlog with a suggested cheap test.',
    inputSchema: z.object({
      title: z.string(),
      source: z.string().default(''),
      cluster: z.string().default(''),
      why_interesting: z.string().default(''),
      suggested_test: z.string().default(''),
      status: z.enum(BACKLOG_STATUSES).default('RAW'),
    }),
    readOnly: false,
    execute: async (ctx, input) => {
      const now = new Date().toISOString();
      const item = backlogItemSchema.parse({
        ...input,
        id: slugId('IDEA', input.title),
        workspace_id: ctx.workspaceId,
        evidence: [],
        created_at: now,
        updated_at: now,
      });
      await ctx.store.saveBacklogItem(item);
      ctx.calls.push({ name: 'add_backlog_item', summary: item.title });
      queueSync(ctx.store, ctx.workspaceId, { kind: 'memory' }, `content: add backlog idea ${item.id}`);
      return { item };
    },
  }),
  defineTool({
    name: 'update_backlog_item',
    description:
      'Change a backlog item status and add evidence. One good poll is NOT proof — moving to CORE_CANDIDATE needs more than a single signal.',
    inputSchema: z.object({
      id: z.string(),
      status: z.enum(BACKLOG_STATUSES).optional(),
      evidence: z.string().optional(),
      notes: z.string().optional(),
    }),
    readOnly: false,
    execute: async (ctx, input) => {
      const item = await ctx.store.getBacklogItem(input.id);
      if (!item) throw new Error(`Backlog item not found: ${input.id}`);

      const evidence = input.evidence ? [...item.evidence, input.evidence] : item.evidence;
      let status = input.status ?? item.status;
      let guard = '';
      if (status === 'CORE_CANDIDATE' && evidence.length < 2) {
        status = 'PROMISING';
        guard =
          'Понижено до PROMISING: для CORE_CANDIDATE нужно больше одного подтверждения. Один удачный опрос доказательством не является.';
      }

      const next = {
        ...item,
        status,
        evidence,
        notes: input.notes ?? item.notes,
        updated_at: new Date().toISOString(),
      };
      await ctx.store.saveBacklogItem(next);
      ctx.calls.push({ name: 'update_backlog_item', summary: `${item.id} → ${status}` });
      queueSync(ctx.store, ctx.workspaceId, { kind: 'memory' }, `content: update backlog ${item.id}`);
      return { item: next, guard };
    },
  }),
  defineTool({
    name: 'run_weekly_review',
    description:
      'Produce the weekly review for a week: per-unit what we wanted to test / what happened / YES-NO-TOO EARLY, then the weekly summary. Saves it durably and turns repeated feedback into learnings.',
    inputSchema: z.object({
      week_id: z.string(),
      content_summary: z.string().optional(),
      production_summary: z.string().optional(),
      funnel_summary: z.string().optional(),
      backlog_summary: z.string().optional(),
      user_feedback_summary: z.string().optional(),
      next_week_changes: z.string().optional(),
    }),
    readOnly: false,
    execute: async (ctx, input) => {
      const { week_id, ...narrative } = input;
      const { review, learnings } = await runWeeklyReview(ctx.store, ctx.workspaceId, week_id, {
        generatedBy: ctx.actor,
        narrative: narrative as never,
      });
      ctx.calls.push({ name: 'run_weekly_review', summary: week_id });
      queueSync(ctx.store, ctx.workspaceId, { kind: 'review', weekId: week_id }, `review: complete ${week_id}`);
      return { review, new_learnings: learnings };
    },
  }),
  defineTool({
    name: 'record_learning',
    description:
      'Append an evidence-based learning. Evidence is mandatory. One data point is LOW confidence; several comparable results may be MEDIUM; only a repeated pattern is HIGH. Repeated team feedback counts as evidence.',
    inputSchema: z.object({
      category: z.enum(LEARNING_CATEGORIES),
      observation: z.string(),
      evidence: z.array(z.string()).min(1),
      confidence: z.enum(CONFIDENCE_LEVELS).optional(),
      action: z.string().default(''),
      tags: z.array(z.string()).default([]),
      source_units: z.array(z.string()).default([]),
    }),
    readOnly: false,
    execute: async (ctx, input) => {
      const learning = await recordLearning(ctx.store, ctx.workspaceId, {
        category: input.category,
        observation: input.observation,
        evidence: input.evidence,
        confidence: input.confidence,
        action: input.action,
        tags: input.tags,
        sourceUnits: input.source_units,
      });
      ctx.calls.push({
        name: 'record_learning',
        summary: `[${learning.confidence}] ${learning.observation.slice(0, 60)}`,
      });
      queueSync(ctx.store, ctx.workspaceId, { kind: 'memory' }, 'memory: update operational learnings');
      return { learning };
    },
  }),
  defineTool({
    name: 'update_strategy_state',
    description:
      'Update the OPERATIONAL strategy state (current focus, active experiments, content mix intent, sales level). This is the layer that is allowed to change weekly. It is NOT MASTER_CONTEXT or FUNNEL_PLAYBOOK.',
    inputSchema: z.object({
      current_focus: z.string().optional(),
      active_experiments: z.array(z.string()).optional(),
      content_mix_intent: z.string().optional(),
      sales_level: z.enum(['none', 'micro', 'soft', 'direct']).optional(),
      effort_budget_note: z.string().optional(),
      open_questions: z.array(z.string()).optional(),
      notes: z.string().optional(),
    }),
    readOnly: false,
    execute: async (ctx, input) => {
      const current = await ctx.store.getStrategyState();
      const next = {
        ...current,
        ...Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)),
        updated_at: new Date().toISOString(),
      };
      await ctx.store.saveStrategyState(next);
      ctx.calls.push({ name: 'update_strategy_state', summary: 'operational state updated' });
      queueSync(ctx.store, ctx.workspaceId, { kind: 'context' }, 'memory: update strategy state');
      return { strategy_state: next };
    },
  }),
  defineTool({
    name: 'propose_strategy_change',
    description:
      'Propose a change to a FUNDAMENTAL document (MASTER_CONTEXT, FUNNEL_PLAYBOOK, PRODUCTION_PIPELINE). You may never edit these directly. The proposal waits for the Owner to approve it.',
    inputSchema: z.object({
      target_doc: z.enum(['MASTER_CONTEXT', 'FUNNEL_PLAYBOOK', 'PRODUCTION_PIPELINE']),
      rationale: z.string(),
      proposed_change: z.string(),
      evidence: z.array(z.string()).default([]),
    }),
    readOnly: false,
    execute: async (ctx, input) => {
      const change = strategyChangeSchema.parse({
        ...input,
        id: uid('sc'),
        workspace_id: ctx.workspaceId,
        status: 'PROPOSED',
        created_at: new Date().toISOString(),
        decided_at: null,
        decided_by: null,
      });
      await ctx.store.saveStrategyChange(change);
      ctx.calls.push({ name: 'propose_strategy_change', summary: input.target_doc });
      queueSync(ctx.store, ctx.workspaceId, { kind: 'memory' }, `memory: propose strategy change to ${input.target_doc}`);
      return {
        change,
        note: 'Предложение сохранено. Оно НЕ применено — изменить фундаментальный документ может только Owner на странице CONTEXT.',
      };
    },
  }),
  defineTool({
    name: 'sync_to_github',
    description: 'Force a durable snapshot commit of the content state to the data branch.',
    inputSchema: z.object({ message: z.string().default('content: manual sync') }),
    readOnly: false,
    execute: async (ctx, input) => {
      const { syncToGithub } = await import('@/lib/github/sync');
      const result = await syncToGithub(ctx.store, ctx.workspaceId, { kind: 'full' }, input.message);
      ctx.calls.push({
        name: 'sync_to_github',
        summary: result.ok ? `${result.files.length} файлов` : `ошибка: ${result.error}`,
      });
      return result;
    },
  }),
];

export const TOOLS_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

/** Tools a card-scoped chat is allowed to see. Keeps the model on task. */
const UNIT_SCOPE_TOOLS = new Set([
  'get_workspace_context',
  'get_current_week',
  'get_relevant_learnings',
  'get_analytics',
  'get_core_videos',
  'update_content_unit',
  'update_platform_variant',
  'move_content_unit',
  'record_user_feedback',
  'record_learning',
]);

export function toolsForScope(scope: Scope): AnyToolDef[] {
  if (scope.kind === 'content_unit') {
    return TOOLS.filter((t) => UNIT_SCOPE_TOOLS.has(t.name));
  }
  return TOOLS;
}

/** Loose title match so a regenerated slot recognises its published twin. */
function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function scopeWeekId(ctx: ToolContext): string | null {
  if (ctx.scope.kind === 'week') return ctx.scope.weekId;
  return null;
}

export { buildWeekSkeleton, planningNote };
