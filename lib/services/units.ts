import type { Store } from '@/lib/store';
import {
  contentUnitSchema,
  emptyAnalyticsStatus,
  platformVariantSchema,
  type ContentUnit,
  type PlatformVariant,
  type Revision,
} from '@/lib/domain/schema';
import { contentUnitId, uid } from '@/lib/domain/ids';
import { diffUnits, summarizeDiff, type FieldDiff } from './diff';
import { weekDates } from '@/lib/domain/week';
import { recomputeAnalyticsStatus } from './analytics-status';

export type UnitPatch = Partial<
  Pick<
    ContentUnit,
    | 'title'
    | 'date'
    | 'scheduled_time'
    | 'slot_type'
    | 'content_type'
    | 'source'
    | 'related_core_video_id'
    | 'objective'
    | 'hypothesis'
    | 'expected_signal'
    | 'estimated_effort'
    | 'status'
    | 'owner'
    | 'notes'
    | 'figma_url'
    | 'ai_reasoning_short'
    | 'assets'
    | 'references'
  >
> & {
  /** Full replacement of the variant set. Omit to leave variants untouched. */
  platforms?: Array<Partial<PlatformVariant> & { platform: PlatformVariant['platform']; surface: string }>;
};

export type MutationResult = {
  unit: ContentUnit;
  revision: Revision | null;
  diffs: FieldDiff[];
  diffSummary: string;
};

function nowIso(): string {
  return new Date().toISOString();
}

export function normalizeVariants(
  unitId: string,
  input: UnitPatch['platforms'],
  existing: PlatformVariant[] = [],
): PlatformVariant[] {
  if (!input) return existing;
  return input.map((v, i) => {
    const prior = existing.find((e) => e.platform === v.platform && e.surface === v.surface);
    return platformVariantSchema.parse({
      ...(prior ?? {}),
      ...v,
      id: prior?.id ?? v.id ?? uid('pv'),
      content_unit_id: unitId,
      position: v.position ?? i,
    });
  });
}

/** Allocates the next free CU id inside a week. */
export async function nextUnitId(store: Store, weekId: string): Promise<string> {
  const units = await store.listUnits({ weekId });
  const used = new Set(units.map((u) => u.id));
  for (let i = 1; i < 100; i += 1) {
    const id = contentUnitId(weekId, i);
    if (!used.has(id)) return id;
  }
  return contentUnitId(weekId, units.length + 1);
}

export async function createUnit(
  store: Store,
  workspaceId: string,
  weekId: string,
  input: UnitPatch & { title: string; content_type: ContentUnit['content_type']; date?: string },
): Promise<ContentUnit> {
  const id = await nextUnitId(store, weekId);
  const dates = weekDates(weekId);
  const date = input.date && dates.includes(input.date) ? input.date : dates[0];
  const existing = await store.listUnits({ weekId });
  const ts = nowIso();

  const unit = contentUnitSchema.parse({
    ...input,
    id,
    workspace_id: workspaceId,
    week_id: weekId,
    date,
    platforms: normalizeVariants(id, input.platforms, []),
    analytics_status: emptyAnalyticsStatus(),
    position: existing.filter((u) => u.date === date).length,
    revision_number: 1,
    created_at: ts,
    updated_at: ts,
  });
  await store.saveUnit(unit);
  return unit;
}

/**
 * The single write path for content units. Always snapshots the previous
 * version into a revision first, so every AI change is reversible.
 */
export async function updateUnit(
  store: Store,
  unitId: string,
  patch: UnitPatch,
  opts: { reason?: string; actor?: string; userFeedback?: string } = {},
): Promise<MutationResult> {
  const before = await store.getUnit(unitId);
  if (!before) throw new Error(`Content unit not found: ${unitId}`);

  const platforms =
    patch.platforms === undefined
      ? before.platforms
      : normalizeVariants(unitId, patch.platforms, before.platforms);

  const candidate = contentUnitSchema.parse({
    ...before,
    ...Object.fromEntries(Object.entries(patch).filter(([k]) => k !== 'platforms')),
    platforms,
    user_feedback: opts.userFeedback
      ? [...before.user_feedback, opts.userFeedback]
      : before.user_feedback,
    updated_at: nowIso(),
  });

  const diffs = diffUnits(before, candidate);
  const feedbackOnly = diffs.length === 0 && Boolean(opts.userFeedback);

  if (!diffs.length && !feedbackOnly) {
    return { unit: before, revision: null, diffs: [], diffSummary: 'Ничего не изменилось.' };
  }

  const revision: Revision = {
    id: uid('rev'),
    content_unit_id: unitId,
    revision_number: before.revision_number,
    snapshot: before as unknown as Record<string, unknown>,
    diff_summary: summarizeDiff(diffs),
    changed_fields: diffs.map((d) => d.field),
    reason: opts.reason ?? '',
    actor: opts.actor ?? 'ai',
    created_at: nowIso(),
  };
  await store.saveRevision(revision);

  const next = { ...candidate, revision_number: before.revision_number + 1 };
  const withStatus = recomputeAnalyticsStatus(next, await store.listReports({ unitId }));
  await store.saveUnit(withStatus);

  return { unit: withStatus, revision, diffs, diffSummary: revision.diff_summary };
}

/** Move a card to another day (drag & drop, or `move_content_unit`). */
export async function moveUnit(
  store: Store,
  unitId: string,
  date: string,
  opts: { actor?: string; position?: number } = {},
): Promise<MutationResult> {
  const unit = await store.getUnit(unitId);
  if (!unit) throw new Error(`Content unit not found: ${unitId}`);
  const dates = weekDates(unit.week_id);
  if (!dates.includes(date)) {
    throw new Error(`Date ${date} is outside week ${unit.week_id}`);
  }
  const siblings = (await store.listUnits({ weekId: unit.week_id })).filter(
    (u) => u.date === date && u.id !== unitId,
  );
  const result = await updateUnit(store, unitId, { date }, { actor: opts.actor ?? 'user', reason: 'move' });
  if (result.unit.position !== (opts.position ?? siblings.length)) {
    const repositioned = { ...result.unit, position: opts.position ?? siblings.length };
    await store.saveUnit(repositioned);
    return { ...result, unit: repositioned };
  }
  return result;
}

export async function updatePlatformVariant(
  store: Store,
  unitId: string,
  selector: { platform: PlatformVariant['platform']; surface?: string },
  patch: Partial<PlatformVariant>,
  opts: { reason?: string; actor?: string; userFeedback?: string } = {},
): Promise<MutationResult> {
  const unit = await store.getUnit(unitId);
  if (!unit) throw new Error(`Content unit not found: ${unitId}`);
  const idx = unit.platforms.findIndex(
    (v) => v.platform === selector.platform && (!selector.surface || v.surface === selector.surface),
  );
  if (idx < 0) {
    throw new Error(
      `No ${selector.platform}${selector.surface ? `/${selector.surface}` : ''} variant on ${unitId}`,
    );
  }
  const platforms = unit.platforms.map((v, i) => (i === idx ? { ...v, ...patch } : v));
  return updateUnit(store, unitId, { platforms }, opts);
}

/** Undo: restore the snapshot stored in a revision. Itself recorded as a revision. */
export async function restoreRevision(
  store: Store,
  unitId: string,
  revisionId: string,
  actor = 'user',
): Promise<MutationResult> {
  const revisions = await store.listRevisions(unitId);
  const target = revisions.find((r) => r.id === revisionId) ?? revisions[0];
  if (!target) throw new Error(`No revision to restore for ${unitId}`);
  const snapshot = contentUnitSchema.parse(target.snapshot);
  return updateUnit(
    store,
    unitId,
    {
      title: snapshot.title,
      date: snapshot.date,
      scheduled_time: snapshot.scheduled_time,
      slot_type: snapshot.slot_type,
      content_type: snapshot.content_type,
      source: snapshot.source,
      related_core_video_id: snapshot.related_core_video_id,
      objective: snapshot.objective,
      hypothesis: snapshot.hypothesis,
      expected_signal: snapshot.expected_signal,
      estimated_effort: snapshot.estimated_effort,
      status: snapshot.status,
      owner: snapshot.owner,
      notes: snapshot.notes,
      figma_url: snapshot.figma_url,
      assets: snapshot.assets,
      references: snapshot.references,
      platforms: snapshot.platforms,
    },
    { actor, reason: `restore revision #${target.revision_number}` },
  );
}

export function totalEffortLabel(units: ContentUnit[]): string {
  const weight = { XS: 0.25, S: 0.5, M: 1.5, L: 4 } as const;
  const hours = units.reduce((sum, u) => sum + weight[u.estimated_effort], 0);
  return `${hours.toFixed(1)}h est.`;
}
