import path from 'node:path';
import { env, hasGithub } from '@/lib/env';
import type { Store } from '@/lib/store';
import { uid } from '@/lib/domain/ids';
import { renderReviewMarkdown } from '@/lib/services/review';
import type { FileWrite, GitTarget } from './types';
import { GithubTarget } from './octokit';
import { LocalGitTarget } from './local';

const ROOT = '.content-os';

export function getGitTarget(): GitTarget {
  return hasGithub()
    ? new GithubTarget(env.githubToken, env.githubOwner, env.githubRepo, env.githubBranch)
    : new LocalGitTarget(path.resolve(process.cwd(), env.dataDir, 'content-state'));
}

/**
 * In-flight background syncs.
 *
 * `queueSync` deliberately does not block the user on a network round trip,
 * but a promise that outlives its request is a liability: it can still be
 * writing when the process shuts down or the data directory disappears.
 * Anything that needs a quiet point — a test, a script, a graceful shutdown —
 * awaits `flushSyncs()`.
 */
const inFlight = new Set<Promise<unknown>>();

export function flushSyncs(): Promise<unknown> {
  return Promise.allSettled([...inFlight]);
}

export function pendingSyncCount(): number {
  return inFlight.size;
}

export type SyncScope =
  | { kind: 'week'; weekId: string }
  | { kind: 'unit'; unitId: string }
  | { kind: 'analytics'; unitId: string }
  | { kind: 'review'; weekId: string }
  | { kind: 'memory' }
  | { kind: 'context' }
  | { kind: 'full' };

const json = (v: unknown): string => `${JSON.stringify(v, null, 2)}\n`;

/**
 * Builds the file set for a sync scope. Screenshots are never committed as
 * blobs — only their storage path plus the structured metrics.
 */
export async function collectFiles(store: Store, scope: SyncScope): Promise<FileWrite[]> {
  const files: FileWrite[] = [];
  const wantAll = scope.kind === 'full';

  // A weekly review is the natural checkpoint for the strategy layer, so the
  // branch always holds a recent copy of the context even if nobody ever runs
  // a manual full sync.
  if (wantAll || scope.kind === 'context' || scope.kind === 'review') {
    for (const doc of await store.listContextDocs()) {
      files.push({ path: `${ROOT}/context/${doc.slug}.md`, content: doc.body });
    }
    files.push({
      path: `${ROOT}/context/strategy_state.json`,
      content: json(await store.getStrategyState()),
    });
  }

  if (wantAll || scope.kind === 'week' || scope.kind === 'unit' || scope.kind === 'analytics') {
    const weekIds =
      scope.kind === 'week'
        ? [scope.weekId]
        : scope.kind === 'unit' || scope.kind === 'analytics'
          ? [(await store.getUnit(scope.unitId))?.week_id].filter((x): x is string => Boolean(x))
          : (await store.listWeeks()).map((w) => w.id);

    for (const weekId of weekIds) {
      const week = await store.getWeek(weekId);
      const units = await store.listUnits({ weekId });
      if (week) {
        files.push({
          path: `${ROOT}/weeks/${weekId}/plan.json`,
          content: json({
            ...week,
            units: units.map((u) => ({
              id: u.id,
              date: u.date,
              title: u.title,
              content_type: u.content_type,
              slot_type: u.slot_type,
              estimated_effort: u.estimated_effort,
              status: u.status,
              platforms: u.platforms.map((p) => `${p.platform}/${p.surface}`),
            })),
          }),
        });
      }
      for (const u of units) {
        files.push({ path: `${ROOT}/content-units/${u.id}.json`, content: json(u) });
      }
    }
  }

  if (wantAll || scope.kind === 'unit') {
    if (scope.kind === 'unit') {
      const unit = await store.getUnit(scope.unitId);
      if (unit) {
        files.push({ path: `${ROOT}/content-units/${unit.id}.json`, content: json(unit) });
        const revisions = await store.listRevisions(unit.id);
        files.push({
          path: `${ROOT}/content-units/${unit.id}.revisions.json`,
          content: json(
            revisions.map((r) => ({
              revision_number: r.revision_number,
              created_at: r.created_at,
              actor: r.actor,
              reason: r.reason,
              changed_fields: r.changed_fields,
              diff_summary: r.diff_summary,
            })),
          ),
        });
        const comments = await store.listComments(unit.id);
        if (comments.length) {
          files.push({
            path: `${ROOT}/content-units/${unit.id}.comments.json`,
            content: json(comments),
          });
        }
      }
    }
  }

  if (wantAll || scope.kind === 'analytics') {
    const unitIds =
      scope.kind === 'analytics'
        ? [scope.unitId]
        : Array.from(new Set((await store.listReports()).map((r) => r.content_unit_id)));
    for (const unitId of unitIds) {
      for (const r of await store.listReports({ unitId })) {
        files.push({
          path: `${ROOT}/analytics/${unitId}/${r.window}.json`,
          content: json({
            content_unit_id: r.content_unit_id,
            platform: r.platform,
            window: r.window,
            publish_url: r.publish_url,
            // paths into Supabase Storage, not the images themselves
            screenshot_paths: r.screenshots,
            extracted_metrics: r.extracted_metrics,
            confirmed_metrics: r.confirmed_metrics,
            confirmed: r.confirmed,
            confirmed_at: r.confirmed_at,
            user_notes: r.user_notes,
            ai_observation: r.ai_observation,
          }),
        });
      }
    }
  }

  if (wantAll || scope.kind === 'review') {
    const weekIds =
      scope.kind === 'review' ? [scope.weekId] : (await store.listReviews()).map((r) => r.week_id);
    for (const weekId of weekIds) {
      const review = await store.getReview(weekId);
      if (review) {
        files.push({
          path: `${ROOT}/weeks/${weekId}/review.md`,
          content: renderReviewMarkdown(review),
        });
        files.push({ path: `${ROOT}/weeks/${weekId}/review.json`, content: json(review) });
      }
    }
  }

  if (wantAll || scope.kind === 'memory' || scope.kind === 'review') {
    const learnings = await store.listLearnings();
    files.push({
      path: `${ROOT}/memory/learnings.jsonl`,
      content: `${learnings.map((l) => JSON.stringify(l)).join('\n')}\n`,
    });
    const changes = await store.listStrategyChanges();
    files.push({
      path: `${ROOT}/memory/decisions.jsonl`,
      content: `${changes.map((c) => JSON.stringify(c)).join('\n')}\n`,
    });
    for (const s of await store.listSummaries()) {
      files.push({ path: `${ROOT}/memory/summaries/${s.key}.md`, content: s.body });
    }
  }

  if (wantAll) {
    files.push({
      path: `${ROOT}/core-videos/index.json`,
      content: json(await store.listCoreVideos()),
    });
    for (const v of await store.listCoreVideos()) {
      files.push({ path: `${ROOT}/core-videos/${v.id}.json`, content: json(v) });
    }
    files.push({ path: `${ROOT}/backlog/topics.json`, content: json(await store.listBacklog()) });
    files.push({ path: `${ROOT}/schemas/README.md`, content: SCHEMA_README });
  } else {
    // Core videos and backlog are small and change constantly — always include.
    files.push({ path: `${ROOT}/backlog/topics.json`, content: json(await store.listBacklog()) });
    files.push({
      path: `${ROOT}/core-videos/index.json`,
      content: json(await store.listCoreVideos()),
    });
  }

  // De-duplicate by path, last write wins.
  const seen = new Map<string, FileWrite>();
  for (const f of files) seen.set(f.path, f);
  return [...seen.values()];
}

/**
 * Durable sync. Records a pending log entry first so the UI can show
 * "Syncing…" and, if the commit fails, "Sync failed — retry".
 */
export async function syncToGithub(
  store: Store,
  workspaceId: string,
  scope: SyncScope,
  message: string,
  target: GitTarget = getGitTarget(),
): Promise<{ ok: boolean; sha: string | null; error: string | null; files: string[] }> {
  const id = uid('sync');
  const files = await collectFiles(store, scope);

  await store.saveSyncLog({
    id,
    workspace_id: workspaceId,
    status: 'pending',
    message,
    files: files.map((f) => f.path),
    commit_sha: null,
    error: null,
    created_at: new Date().toISOString(),
  });

  try {
    const sha = await target.commit(message, files);
    await store.saveSyncLog({
      id,
      workspace_id: workspaceId,
      status: 'ok',
      message,
      files: files.map((f) => f.path),
      commit_sha: sha,
      error: null,
      created_at: new Date().toISOString(),
    });
    return { ok: true, sha, error: null, files: files.map((f) => f.path) };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await store.saveSyncLog({
      id,
      workspace_id: workspaceId,
      status: 'failed',
      message,
      files: files.map((f) => f.path),
      commit_sha: null,
      error,
      created_at: new Date().toISOString(),
    });
    return { ok: false, sha: null, error, files: files.map((f) => f.path) };
  }
}

/**
 * Fire-and-forget sync for AI mutations: the user should never wait on GitHub.
 * Failures land in the sync log and surface as "Sync failed — retry".
 */
export function queueSync(
  store: Store,
  workspaceId: string,
  scope: SyncScope,
  message: string,
): void {
  const task = syncToGithub(store, workspaceId, scope, message)
    .catch(() => undefined)
    .finally(() => inFlight.delete(task));
  inFlight.add(task);
}

const SCHEMA_README = `# .content-os schemas

Durable, human-readable snapshot of the Content OS state. This branch is the
audit trail and the backup — the running app reads and writes Postgres.

- context/            immutable strategy docs + mutable strategy_state.json
- weeks/<week>/        plan.json (calendar) + review.md / review.json
- content-units/       one JSON per card, plus .revisions.json and .comments.json
- core-videos/         production pipeline entities
- backlog/topics.json  idea pool with statuses and evidence
- analytics/<unit>/    24h.json / 72h.json / 7d.json — confirmed metrics only,
                       screenshots referenced by storage path, never committed
- memory/              learnings.jsonl, decisions.jsonl, summaries/

Nothing here is deleted by the app. Revisions and analytics are append-only.
`;
