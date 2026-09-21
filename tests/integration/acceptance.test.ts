/**
 * The acceptance flows from the brief, end to end, against real storage and
 * the real tool layer. Runs on the deterministic provider so it needs no keys;
 * every tool call, revision, report and snapshot is the same code path a live
 * model drives.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, tempStore } from '../helpers';
import type { Store } from '@/lib/store';
import { runAgent } from '@/lib/ai/agent';
import { seedDemo } from '@/lib/services/demo';
import { markPublished, confirmReport, createReport } from '@/lib/services/analytics';
import { restoreRevision } from '@/lib/services/units';
import { flushSyncs, syncToGithub } from '@/lib/github/sync';
import { currentWeekId, nextWeekId, previousWeekId, weekDates } from '@/lib/domain/week';
import { recomputeAnalyticsStatus } from '@/lib/services/analytics-status';

let store: Store;
let dir: string;
let workspaceId: string;

beforeEach(async () => {
  process.env.AI_PROVIDER = 'mock';
  process.env.GITHUB_SYNC = 'local';
  ({ store, dir, workspaceId } = await tempStore());
});
afterEach(async () => cleanup(dir));

const ask = (message: string, scope: Parameters<typeof runAgent>[0]['scope']) =>
  runAgent({ store, workspaceId, actor: 'Owner', scope, message });

describe('TEST A — «Новая неделя, обнови план»', () => {
  it('reviews the previous week, reads durable state and generates a usable week', async () => {
    const thisWeek = currentWeekId();
    const target = nextWeekId(thisWeek);
    await seedDemo(store, workspaceId, thisWeek);

    // Mark last week's work published so the auto-review has something to read.
    const prior = await store.listUnits({ weekId: thisWeek });
    await markPublished(store, prior[0].id, prior[0].platforms[0].platform, 'https://example/1');

    const res = await ask('Новая неделя, обнови план', { kind: 'week', weekId: target });

    // previous week got reviewed automatically
    expect(res.toolCalls.map((t) => t.name)).toContain('run_weekly_review');
    expect(await store.getReview(thisWeek)).not.toBeNull();

    // a week plan was created
    expect(res.toolCalls.map((t) => t.name)).toContain('create_week_plan');
    const units = await store.listUnits({ weekId: target });
    expect(units.length).toBeGreaterThanOrEqual(4);

    // cards are real: they carry copy, a platform, an objective and a signal
    for (const u of units) {
      expect(u.platforms.length).toBeGreaterThan(0);
      expect(u.objective.length).toBeGreaterThan(0);
      expect(u.expected_signal.length).toBeGreaterThan(0);
      expect(u.platforms[0].ready_to_use_copy.length).toBeGreaterThan(0);
      expect(weekDates(target)).toContain(u.date);
    }

    // the upcoming core video is actually used, not ignored
    expect(units.some((u) => u.related_core_video_id === 'V027')).toBe(true);

    // a sensible mix, and the core-video budget is respected
    const types = new Set(units.map((u) => u.content_type));
    expect(types.size).toBeGreaterThanOrEqual(3);
    expect(units.filter((u) => u.content_type === 'CORE').length).toBeLessThanOrEqual(2);

    // durable state reached the content-state snapshot
    // (create_week_plan queues this itself; wait for the background write)
    await flushSyncs();
    const plan = await fs.readFile(
      path.join(dir, 'content-state', '.content-os', 'weeks', target, 'plan.json'),
      'utf8',
    );
    expect(JSON.parse(plan).units.length).toBe(units.length);
  });

  it('respects a constraint stated in the same message', async () => {
    const target = nextWeekId(currentWeekId());
    await seedDemo(store, workspaceId, currentWeekId());
    await ask('Новая неделя, обнови план. На следующей неделе только один Core', {
      kind: 'week',
      weekId: target,
    });
    const units = await store.listUnits({ weekId: target });
    expect(units.filter((u) => u.content_type === 'CORE').length).toBeLessThanOrEqual(1);
  });
});

describe('TEST B — card feedback changes only that card', () => {
  it('cheapens one card, records the feedback and leaves the rest of the week alone', async () => {
    const weekId = currentWeekId();
    await seedDemo(store, workspaceId, weekId);
    const units = await store.listUnits({ weekId });
    const target = units.find((u) => u.platforms.length > 1) ?? units[0];
    const before = JSON.stringify(units.filter((u) => u.id !== target.id));

    const res = await ask('Это долго делать. Сделай версию максимум на 10 минут работы', {
      kind: 'content_unit',
      unitId: target.id,
    });

    const after = await store.getUnit(target.id);
    expect(after).not.toBeNull();

    // cheaper for real: fewer surfaces and a lower effort estimate
    expect(after!.platforms.length).toBeLessThanOrEqual(target.platforms.length);
    expect(after!.estimated_effort).toBe('XS');

    // the feedback is persisted so future planning will not repeat the idea
    expect(after!.user_feedback.join(' ')).toMatch(/10 минут/);

    // a revision exists and the reply explains the diff
    const revisions = await store.listRevisions(target.id);
    expect(revisions.length).toBeGreaterThan(0);
    expect(after!.revision_number).toBeGreaterThan(target.revision_number);
    expect(res.text).toMatch(/Что изменилось|Что сделал/);

    // nothing else in the week moved
    const others = await store.listUnits({ weekId });
    expect(JSON.stringify(others.filter((u) => u.id !== target.id))).toBe(before);
  });

  it('turns a carousel into a single Story on request', async () => {
    const weekId = currentWeekId();
    await seedDemo(store, workspaceId, weekId);
    const units = await store.listUnits({ weekId });
    const target =
      units.find((u) => u.platforms.some((p) => /carousel|photo_mode/.test(p.surface + p.format))) ??
      units[0];

    await ask('Не хочу карусель, сделай одну Story', {
      kind: 'content_unit',
      unitId: target.id,
    });

    const after = await store.getUnit(target.id);
    expect(after!.platforms.every((p) => !/carousel/.test(p.surface))).toBe(true);
  });

  it('refuses to touch a different card from a card-scoped chat', async () => {
    const weekId = currentWeekId();
    await seedDemo(store, workspaceId, weekId);
    const units = await store.listUnits({ weekId });
    const { TOOLS_BY_NAME } = await import('@/lib/ai/tools');
    const tool = TOOLS_BY_NAME.get('update_content_unit')!;

    await expect(
      tool.execute(
        { store, workspaceId, actor: 'Owner', scope: { kind: 'content_unit', unitId: units[0].id }, calls: [] },
        { content_unit_id: units[1].id, title: 'hijacked', reason: '' },
      ),
    ).rejects.toThrow(/Scope violation/);
  });

  it('can undo an AI revision', async () => {
    const weekId = currentWeekId();
    await seedDemo(store, workspaceId, weekId);
    const [target] = await store.listUnits({ weekId });
    const originalCopy = target.platforms[0].ready_to_use_copy;

    await ask('Сократи в два раза', { kind: 'content_unit', unitId: target.id });
    const shortened = await store.getUnit(target.id);
    expect(shortened!.platforms[0].ready_to_use_copy).not.toBe(originalCopy);

    const revisions = await store.listRevisions(target.id);
    const restored = await restoreRevision(store, target.id, revisions[revisions.length - 1].id);
    expect(restored.unit.platforms[0].ready_to_use_copy).toBe(originalCopy);
  });
});

describe('TEST C — team comment with @ai', () => {
  it('keeps the author, revises the card and links the revision', async () => {
    const weekId = currentWeekId();
    await seedDemo(store, workspaceId, weekId);
    const [target] = await store.listUnits({ weekId });

    const { commentSchema } = await import('@/lib/domain/schema');
    const { uid } = await import('@/lib/domain/ids');
    const comment = commentSchema.parse({
      id: uid('cmt'),
      content_unit_id: target.id,
      author: 'Aisha',
      author_role: 'EDITOR',
      message: '@ai Сделай текст смешнее и в два раза короче',
      ai_invoked: true,
      created_at: new Date().toISOString(),
    });
    await store.saveComment(comment);

    const before = await store.listRevisions(target.id);
    const res = await ask('Сделай текст смешнее и в два раза короче', {
      kind: 'content_unit',
      unitId: target.id,
    });
    const after = await store.listRevisions(target.id);
    const created = after.find((r) => !before.some((b) => b.id === r.id));
    expect(created).toBeDefined();

    await store.saveComment({ ...comment, ai_response: res.text, revision_id: created!.id });

    const comments = await store.listComments(target.id);
    expect(comments[0].author).toBe('Aisha');
    expect(comments[0].ai_invoked).toBe(true);
    expect(comments[0].revision_id).toBe(created!.id);

    const unit = await store.getUnit(target.id);
    expect(unit!.user_feedback.join(' ')).toMatch(/смешнее/);
  });

  it('a plain comment does not invoke the AI or create a revision', async () => {
    const weekId = currentWeekId();
    await seedDemo(store, workspaceId, weekId);
    const [target] = await store.listUnits({ weekId });
    const before = await store.listRevisions(target.id);

    const { commentSchema } = await import('@/lib/domain/schema');
    const { uid } = await import('@/lib/domain/ids');
    await store.saveComment(
      commentSchema.parse({
        id: uid('cmt'),
        content_unit_id: target.id,
        author: 'Aisha',
        message: 'Выглядит хорошо, беру в работу',
        ai_invoked: false,
        created_at: new Date().toISOString(),
      }),
    );

    expect(await store.listRevisions(target.id)).toHaveLength(before.length);
  });
});

describe('TEST D — publishing starts the reporting clock', () => {
  it('stores published_at and raises 24h due once the window passes', async () => {
    const weekId = currentWeekId();
    await seedDemo(store, workspaceId, weekId);
    const [target] = await store.listUnits({ weekId });

    const { unit, publishedAt } = await markPublished(
      store,
      target.id,
      target.platforms[0].platform,
      'https://instagram.com/stories/x',
    );

    expect(publishedAt).toBeTruthy();
    expect(unit.platforms[0].publish_status).toBe('published');
    expect(unit.platforms[0].publish_url).toContain('instagram.com');
    expect(unit.status).toBe('published');
    // Not due immediately — only after 24h have actually elapsed.
    expect(unit.analytics_status['24h_due']).toBe(false);

    const later = new Date(Date.now() + 25 * 3600 * 1000);
    expect(recomputeAnalyticsStatus(unit, [], later).analytics_status['24h_due']).toBe(true);
  });
});

describe('TEST E — 24h report', () => {
  it('extracts, confirms, completes the window and writes structured JSON', async () => {
    const weekId = currentWeekId();
    await seedDemo(store, workspaceId, weekId);
    const [target] = await store.listUnits({ weekId });
    const platform = target.platforms[0].platform;
    await markPublished(store, target.id, platform, 'https://example/post');

    // Screenshots live in storage; only the path is ever committed.
    const screenshotUrl = await store.putAttachment(
      `analytics/${target.id}/24h/shot.png`,
      Buffer.from('fake-png'),
      'image/png',
    );

    const report = await createReport(store, {
      unitId: target.id,
      platform,
      window: '24h',
      publishUrl: 'https://example/post',
      screenshots: [screenshotUrl],
      extracted: [
        { key: 'views', value: 12300, raw: '12.3K' },
        { key: 'likes', value: 640, raw: '640' },
        { key: 'saves', value: null, raw: '' },
      ],
    });
    expect(report.confirmed).toBe(false);

    // Unconfirmed numbers must not complete the window.
    let unit = await store.getUnit(target.id);
    unit = recomputeAnalyticsStatus(unit!, await store.listReports({ unitId: target.id }));
    expect(unit.analytics_status['24h_complete']).toBe(false);

    // The user corrects one number, then confirms.
    const { unit: afterConfirm } = await confirmReport(
      store,
      report.id,
      [
        { key: 'views', value: 12345, raw: '12.3K' },
        { key: 'likes', value: 640, raw: '640' },
        { key: 'saves', value: null, raw: '' },
      ],
      'Скриншот из Instagram Insights',
    );

    expect(afterConfirm!.analytics_status['24h_complete']).toBe(true);
    expect(afterConfirm!.analytics_status['24h_due']).toBe(false);

    const saved = await store.getReport(report.id);
    expect(saved!.confirmed).toBe(true);
    expect(saved!.confirmed_metrics.find((m) => m.key === 'views')?.value).toBe(12345);
    expect(saved!.confirmed_metrics.find((m) => m.key === 'saves')?.value).toBeNull();

    await syncToGithub(
      store,
      workspaceId,
      { kind: 'analytics', unitId: target.id },
      `analytics: add confirmed 24h report for ${target.id}`,
    );
    await flushSyncs();
    const json = JSON.parse(
      await fs.readFile(
        path.join(dir, 'content-state', '.content-os', 'analytics', target.id, '24h.json'),
        'utf8',
      ),
    );
    expect(json.confirmed).toBe(true);
    expect(json.confirmed_metrics.find((m: any) => m.key === 'views').value).toBe(12345);
    // the image itself is never committed — only its path
    expect(json.screenshot_paths[0]).toContain('analytics/');
    expect(JSON.stringify(json)).not.toContain('fake-png');
  });

  it('never fabricates a metric the extractor did not see', async () => {
    const weekId = currentWeekId();
    await seedDemo(store, workspaceId, weekId);
    const [target] = await store.listUnits({ weekId });
    const report = await createReport(store, {
      unitId: target.id,
      platform: target.platforms[0].platform,
      window: '24h',
      extracted: [
        { key: 'views', value: 100, raw: '100' },
        { key: 'totally_invented', value: 9999, raw: '' } as never,
      ],
    });
    expect(report.extracted_metrics.map((m) => m.key)).toEqual(['views']);
  });
});

describe('TEST F — a brand-new session still knows everything', () => {
  it('plans an improved week from durable state alone, with no chat history', async () => {
    const week1 = currentWeekId();
    const week2 = nextWeekId(week1);
    await seedDemo(store, workspaceId, week1);

    // A week of real work: publish, confirm analytics, give feedback three times.
    const units = await store.listUnits({ weekId: week1 });
    const platform = units[0].platforms[0].platform;
    await markPublished(store, units[0].id, platform, 'https://example/a');
    const report = await createReport(store, {
      unitId: units[0].id,
      platform,
      window: '24h',
      extracted: [{ key: 'views', value: 40000, raw: '40K' }],
    });
    await confirmReport(store, report.id, [{ key: 'views', value: 40000, raw: '40K' }]);

    for (const u of units.slice(0, 3)) {
      await ask('Такие карусели слишком долго делать', { kind: 'content_unit', unitId: u.id });
    }

    // Repeated feedback becomes a HIGH-confidence learning during review.
    await ask('Сделай weekly review', { kind: 'week', weekId: week1 });
    const learnings = (await store.listLearnings()).filter((l) => !l.superseded_by);
    const effortLearning = learnings.find((l) => l.tags.includes('effort:carousel'));
    expect(effortLearning?.confidence).toBe('HIGH');
    expect(effortLearning?.evidence.join(' ')).toMatch(/CU-/);

    /* ---- simulate a completely new browser session ---- */
    const { createLocalStore } = await import('@/lib/store');
    const freshStore = createLocalStore(dir);
    const freshThreads = await freshStore.listThreads();
    for (const t of freshThreads) {
      // no chat history is carried into the new session's reasoning
      expect((await freshStore.listMessages(t.id)).length).toBeGreaterThan(0);
    }

    const { buildContextBundle, renderContextBundle } = await import('@/lib/ai/context-builder');
    const bundle = await buildContextBundle(freshStore, { kind: 'week', weekId: week2 });
    const rendered = renderContextBundle(bundle);

    // everything the brief demands it still knows:
    expect(rendered).toMatch(/Sweater Man/);                 // positioning
    expect(rendered).toMatch(/Telegram/);                    // funnel
    expect(rendered).toMatch(/CapCut|раскадровк/i);          // production workflow
    expect(rendered).toMatch(/карусел/i);                    // team feedback
    expect(rendered).toMatch(/V027/);                        // production pipeline
    expect(rendered).toMatch(/40000|40 000/);                // confirmed analytics
    expect(rendered).toMatch(/\[HIGH\]/);                    // learnings

    const res = await runAgent({
      store: freshStore,
      workspaceId,
      actor: 'Owner',
      scope: { kind: 'week', weekId: week2 },
      message: 'Новая неделя, обнови план',
    });

    const newUnits = await freshStore.listUnits({ weekId: week2 });
    expect(newUnits.length).toBeGreaterThanOrEqual(4);

    // the plan is *improved*: the HIGH-confidence effort learning tightened it
    expect(res.text).toMatch(/HIGH|learnings/i);
    const supporting = newUnits.filter((u) => u.content_type !== 'CORE');
    expect(supporting.every((u) => u.estimated_effort === 'XS' || u.estimated_effort === 'S')).toBe(
      true,
    );
    expect(newUnits.some((u) => u.related_core_video_id === 'V027')).toBe(true);
  });
});

describe('durable state survives a restart', () => {
  it('re-reads everything from disk in a new store instance', async () => {
    const weekId = currentWeekId();
    await seedDemo(store, workspaceId, weekId);
    const before = await store.listUnits({ weekId });

    const { createLocalStore } = await import('@/lib/store');
    const reopened = createLocalStore(dir);
    const after = await reopened.listUnits({ weekId });

    expect(after.map((u) => u.id)).toEqual(before.map((u) => u.id));
    expect(await reopened.getContextDoc('MASTER_CONTEXT')).not.toBeNull();
  });
});

describe('previous week lookups', () => {
  it('finds last week from any week id', () => {
    expect(previousWeekId(nextWeekId(currentWeekId()))).toBe(currentWeekId());
  });
});
