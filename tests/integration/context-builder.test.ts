import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, tempStore } from '../helpers';
import type { Store } from '@/lib/store';
import { buildContextBundle, renderContextBundle, sections, selectSections } from '@/lib/ai/context-builder';
import { seedDemo } from '@/lib/services/demo';
import { recordLearning } from '@/lib/services/learnings';
import { currentWeekId } from '@/lib/domain/week';

let store: Store;
let dir: string;
let workspaceId: string;

beforeEach(async () => {
  ({ store, dir, workspaceId } = await tempStore());
});
afterEach(async () => cleanup(dir));

describe('context builder', () => {
  it('loads the seeded strategic documents into every bundle', async () => {
    const bundle = await buildContextBundle(store, { kind: 'workspace' });
    expect(bundle.base.master).toMatch(/Sweater Man/);
    expect(bundle.base.funnel).toMatch(/FUNNEL|Telegram|воронк/i);
    expect(bundle.base.production).toMatch(/раскадровк|CapCut/i);
  });

  it('includes the production pipeline so backstage ideas stay grounded', async () => {
    const rendered = renderContextBundle(await buildContextBundle(store, { kind: 'workspace' }));
    expect(rendered).toMatch(/PRODUCTION_PIPELINE/);
    expect(rendered).toMatch(/CapCut/);
  });

  it('carries week state, core videos and backlog into a week-scoped bundle', async () => {
    const weekId = currentWeekId();
    await seedDemo(store, workspaceId, weekId);

    const bundle = await buildContextBundle(store, { kind: 'week', weekId });
    expect(bundle.task.units.length).toBeGreaterThan(0);
    expect(bundle.task.upcomingCoreVideos.map((v) => v.id)).toContain('V027');
    expect(bundle.task.backlog.length).toBeGreaterThan(0);

    const rendered = renderContextBundle(bundle);
    expect(rendered).toMatch(/UPCOMING CORE VIDEOS/);
    expect(rendered).toMatch(/V027/);
    expect(rendered).toMatch(/BACKLOG/);
  });

  it('narrows a card-scoped bundle to that card and keeps it smaller', async () => {
    const weekId = currentWeekId();
    await seedDemo(store, workspaceId, weekId);
    const [unit] = await store.listUnits({ weekId });

    const weekBundle = await buildContextBundle(store, { kind: 'week', weekId });
    const unitBundle = await buildContextBundle(store, { kind: 'content_unit', unitId: unit.id });

    expect(unitBundle.task.unit?.id).toBe(unit.id);
    expect(unitBundle.task.backlog).toHaveLength(0);
    expect(unitBundle.meta.charsUsed).toBeLessThan(weekBundle.meta.charsUsed);

    const rendered = renderContextBundle(unitBundle);
    expect(rendered).toMatch(/SELECTED CONTENT UNIT/);
    expect(rendered).toMatch(/менять можно ТОЛЬКО/);
  });

  it('surfaces evidence-based learnings with their confidence', async () => {
    await recordLearning(store, workspaceId, {
      category: 'production',
      observation: 'Large custom carousels exceed the effort budget.',
      evidence: ['CU-1', 'CU-2', 'CU-3'],
      confidence: 'HIGH',
      action: 'Prefer Story or ≤4 cards.',
    });
    const rendered = renderContextBundle(await buildContextBundle(store, { kind: 'workspace' }));
    expect(rendered).toMatch(/\[HIGH\] Large custom carousels/);
    expect(rendered).toMatch(/evidence: CU-1; CU-2; CU-3/);
  });

  it('never grows without bound — the bundle respects its budget', async () => {
    const weekId = currentWeekId();
    await seedDemo(store, workspaceId, weekId);
    for (let i = 0; i < 60; i += 1) {
      await recordLearning(store, workspaceId, {
        category: 'content',
        observation: `Observation number ${i} about content performance`,
        evidence: [`CU-${i}`],
      });
    }
    const bundle = await buildContextBundle(store, { kind: 'week', weekId });
    expect(bundle.memory.learnings.length).toBeLessThanOrEqual(12);
    // The budget is a guide for doc selection, not a hard cap on task data,
    // but the whole bundle must stay in the same order of magnitude.
    expect(bundle.meta.charsUsed).toBeLessThan(bundle.meta.charBudget * 2);
  });
});

describe('document section selection', () => {
  const doc = `# Title\nintro\n\n## Alpha\na body\n\n## Beta\nb body\n\n## Gamma\ng body`;

  it('splits on level-two headings', () => {
    expect(sections(doc).map((s) => s.heading)).toEqual(['(preamble)', 'Alpha', 'Beta', 'Gamma']);
  });

  it('returns the document untouched when it fits', () => {
    expect(selectSections(doc, 10_000, [/Alpha/])).toBe(doc);
  });

  it('keeps preferred sections first when the budget is tight, in original order', () => {
    const out = selectSections(doc, 40, [/Gamma/]);
    expect(out).toMatch(/Gamma/);
    expect(out).toMatch(/разделов опущено/);
  });
});
