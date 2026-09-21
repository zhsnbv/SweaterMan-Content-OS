import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, tempStore } from '../helpers';
import type { Store } from '@/lib/store';
import { collectFiles, syncToGithub } from '@/lib/github/sync';
import { LocalGitTarget } from '@/lib/github/local';
import { seedDemo } from '@/lib/services/demo';
import { currentWeekId } from '@/lib/domain/week';
import { runWeeklyReview } from '@/lib/services/review';
import { confirmReport, createReport, markPublished } from '@/lib/services/analytics';

let store: Store;
let dir: string;
let workspaceId: string;

beforeEach(async () => {
  process.env.GITHUB_SYNC = 'local';
  ({ store, dir, workspaceId } = await tempStore());
});
afterEach(async () => cleanup(dir));

const target = () => new LocalGitTarget(path.join(dir, 'snapshot'));
const read = (p: string) => fs.readFile(path.join(dir, 'snapshot', p), 'utf8');

describe('content-state snapshot layout', () => {
  it('writes the structure the brief specifies', async () => {
    const weekId = currentWeekId();
    await seedDemo(store, workspaceId, weekId);
    await syncToGithub(store, workspaceId, { kind: 'full' }, 'content: full snapshot', target());

    const paths = (await collectFiles(store, { kind: 'full' })).map((f) => f.path);
    expect(paths).toContain('.content-os/context/MASTER_CONTEXT.md');
    expect(paths).toContain('.content-os/context/FUNNEL_PLAYBOOK.md');
    expect(paths).toContain('.content-os/context/PRODUCTION_PIPELINE.md');
    expect(paths).toContain('.content-os/context/strategy_state.json');
    expect(paths).toContain(`.content-os/weeks/${weekId}/plan.json`);
    expect(paths).toContain('.content-os/backlog/topics.json');
    expect(paths).toContain('.content-os/core-videos/V027.json');
    expect(paths).toContain('.content-os/memory/learnings.jsonl');
    expect(paths).toContain('.content-os/memory/decisions.jsonl');
    expect(paths).toContain('.content-os/schemas/README.md');
    expect(paths.some((p) => /\.content-os\/content-units\/CU-.*\.json/.test(p))).toBe(true);

    // the files really landed on disk
    expect(await read('.content-os/context/MASTER_CONTEXT.md')).toMatch(/Sweater Man/);
    expect(JSON.parse(await read('.content-os/core-videos/V027.json')).id).toBe('V027');
  });

  it('commits everything as one commit and logs it', async () => {
    await seedDemo(store, workspaceId, currentWeekId());
    const res = await syncToGithub(store, workspaceId, { kind: 'full' }, 'content: one commit', target());

    expect(res.ok).toBe(true);
    expect(res.sha).toBeTruthy();
    expect(res.files.length).toBeGreaterThan(5);

    const log = await fs.readFile(path.join(dir, 'snapshot', '_commits.log'), 'utf8');
    expect(log.trim().split('\n')).toHaveLength(1);
    expect(log).toMatch(/content: one commit/);
  });

  it('writes the review as both markdown and json', async () => {
    const weekId = currentWeekId();
    await seedDemo(store, workspaceId, weekId);
    await runWeeklyReview(store, workspaceId, weekId);
    await syncToGithub(store, workspaceId, { kind: 'review', weekId }, `review: complete ${weekId}`, target());

    const md = await read(`.content-os/weeks/${weekId}/review.md`);
    expect(md).toMatch(/WHAT WE WANTED TO TEST/);
    expect(md).toMatch(/RESULT:/);
    expect(md).toMatch(/NEXT WEEK CHANGES/);
    expect(JSON.parse(await read(`.content-os/weeks/${weekId}/review.json`)).week_id).toBe(weekId);

    // the review checkpoint also refreshes the strategy layer in the branch
    expect(await read('.content-os/context/strategy_state.json')).toMatch(/current_focus/);
    expect(await read('.content-os/context/MASTER_CONTEXT.md')).toMatch(/Sweater Man/);
  });

  it('keeps screenshots out of the repo and stores only their path', async () => {
    const weekId = currentWeekId();
    await seedDemo(store, workspaceId, weekId);
    const [unit] = await store.listUnits({ weekId });
    const platform = unit.platforms[0].platform;
    await markPublished(store, unit.id, platform, 'https://example/p');

    const url = await store.putAttachment(
      `analytics/${unit.id}/24h/shot.png`,
      Buffer.from('BINARY-IMAGE-BYTES'),
      'image/png',
    );
    const report = await createReport(store, {
      unitId: unit.id,
      platform,
      window: '24h',
      screenshots: [url],
      extracted: [{ key: 'views', value: 1000, raw: '1K' }],
    });
    await confirmReport(store, report.id, [{ key: 'views', value: 1000, raw: '1K' }]);

    const files = await collectFiles(store, { kind: 'analytics', unitId: unit.id });
    const blob = files.map((f) => f.content).join('\n');
    expect(blob).not.toContain('BINARY-IMAGE-BYTES');
    expect(blob).toContain('screenshot_paths');
    expect(blob).toContain('analytics/');
  });

  it('records a failure so the UI can offer a retry', async () => {
    await seedDemo(store, workspaceId, currentWeekId());
    const broken = {
      kind: 'local' as const,
      describe: 'broken',
      ensureBranch: async () => undefined,
      commit: async () => {
        throw new Error('network is down');
      },
      readFile: async () => null,
    };

    const res = await syncToGithub(store, workspaceId, { kind: 'full' }, 'content: will fail', broken);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/network is down/);

    const log = await store.listSyncLog(5);
    expect(log[0].status).toBe('failed');
    expect(log[0].error).toMatch(/network is down/);
  });

  it('includes revision history alongside a unit', async () => {
    const weekId = currentWeekId();
    await seedDemo(store, workspaceId, weekId);
    const [unit] = await store.listUnits({ weekId });
    const { updateUnit } = await import('@/lib/services/units');
    await updateUnit(store, unit.id, { title: 'changed' }, { reason: 'test', actor: 'Owner' });

    const files = await collectFiles(store, { kind: 'unit', unitId: unit.id });
    const revisions = files.find((f) => f.path.endsWith('.revisions.json'));
    expect(revisions).toBeDefined();
    expect(JSON.parse(revisions!.content)).toHaveLength(1);
  });
});
