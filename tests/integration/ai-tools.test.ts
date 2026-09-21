import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, tempStore } from '../helpers';
import type { Store } from '@/lib/store';
import { TOOLS, TOOLS_BY_NAME, toolsForScope, type ToolContext } from '@/lib/ai/tools';
import { seedDemo } from '@/lib/services/demo';
import { currentWeekId, weekDates } from '@/lib/domain/week';
import { flushSyncs } from '@/lib/github/sync';

let store: Store;
let dir: string;
let workspaceId: string;

beforeEach(async () => {
  process.env.AI_PROVIDER = 'mock';
  process.env.GITHUB_SYNC = 'local';
  ({ store, dir, workspaceId } = await tempStore());
});
afterEach(async () => cleanup(dir));

const ctx = (scope: ToolContext['scope']): ToolContext => ({
  store,
  workspaceId,
  actor: 'Owner',
  scope,
  calls: [],
});

const call = async (name: string, input: unknown, scope: ToolContext['scope'] = { kind: 'workspace' }) => {
  const tool = TOOLS_BY_NAME.get(name);
  if (!tool) throw new Error(`no tool ${name}`);
  return tool.execute(ctx(scope), tool.inputSchema.parse(input));
};

describe('tool registry', () => {
  it('exposes every tool the brief requires', () => {
    const required = [
      'get_workspace_context',
      'get_current_week',
      'get_previous_week',
      'get_core_videos',
      'get_backlog',
      'get_relevant_learnings',
      'create_week_plan',
      'update_week_plan',
      'create_content_unit',
      'update_content_unit',
      'move_content_unit',
      'update_platform_variant',
      'record_user_feedback',
      'add_backlog_item',
      'update_backlog_item',
      'get_analytics',
      'run_weekly_review',
      'record_learning',
      'update_strategy_state',
      'sync_to_github',
    ];
    const names = TOOLS.map((t) => t.name);
    for (const r of required) expect(names).toContain(r);
  });

  it('gives every tool a description and a schema', () => {
    for (const t of TOOLS) {
      expect(t.description.length).toBeGreaterThan(20);
      expect(t.inputSchema).toBeDefined();
    }
  });

  it('hides week-level tools from a card-scoped chat', () => {
    const names = toolsForScope({ kind: 'content_unit', unitId: 'CU-1' }).map((t) => t.name);
    expect(names).not.toContain('create_week_plan');
    expect(names).not.toContain('create_content_unit');
    expect(names).toContain('update_content_unit');
  });
});

describe('mutation tools', () => {
  it('creates a week and its cards, and keeps published work on regeneration', async () => {
    const weekId = currentWeekId();
    const dates = weekDates(weekId);

    await call('create_week_plan', {
      week_id: weekId,
      planning_note: 'first pass',
      units: [
        {
          title: 'Тест темы: вороны',
          date: dates[0],
          content_type: 'DISCOVERY',
          objective: 'проверить интерес',
          expected_signal: 'если отвечает больше обычного — кандидат',
          platforms: [
            {
              platform: 'instagram',
              surface: 'story',
              ready_to_use_copy: 'Вороны запоминают лица. Хочешь ролик?',
            },
          ],
        },
      ],
    });

    let units = await store.listUnits({ weekId });
    expect(units).toHaveLength(1);
    const publishedId = units[0].id;

    const { markPublished } = await import('@/lib/services/analytics');
    await markPublished(store, publishedId, 'instagram', 'https://example/x');

    await call('create_week_plan', {
      week_id: weekId,
      replace_existing: true,
      units: [
        {
          title: 'Новая карточка',
          date: dates[1],
          content_type: 'PROCESS',
          platforms: [{ platform: 'tiktok', surface: 'photo_mode', ready_to_use_copy: 'x' }],
        },
      ],
    });

    units = await store.listUnits({ weekId });
    // published history survives; the unpublished plan is replaced
    expect(units.map((u) => u.id)).toContain(publishedId);
    expect(units.some((u) => u.title === 'Новая карточка')).toBe(true);
  });

  it('does not duplicate a published card when the week is regenerated', async () => {
    const weekId = currentWeekId();
    await seedDemo(store, workspaceId, weekId);
    const before = await store.listUnits({ weekId });
    const kept = before[0];

    const { markPublished } = await import('@/lib/services/analytics');
    await markPublished(store, kept.id, kept.platforms[0].platform, 'https://example/x');

    // Regenerate with a plan that proposes the very same card again.
    const res: any = await call('create_week_plan', {
      week_id: weekId,
      replace_existing: true,
      units: before.map((u) => ({
        title: u.title,
        date: u.date,
        content_type: u.content_type,
        platforms: [{ platform: 'instagram', surface: 'story', ready_to_use_copy: 'x' }],
      })),
    });

    const after = await store.listUnits({ weekId });
    const sameTitle = after.filter((u) => u.title === kept.title);
    expect(sameTitle).toHaveLength(1);
    expect(sameTitle[0].id).toBe(kept.id);
    expect(res.kept_published).toContain(kept.id);
    expect(res.skipped_duplicates).toBe(1);
  });

  it('records a revision on every content change', async () => {
    const weekId = currentWeekId();
    await seedDemo(store, workspaceId, weekId);
    const [unit] = await store.listUnits({ weekId });

    const res: any = await call('update_content_unit', {
      content_unit_id: unit.id,
      title: 'Изменённый заголовок',
      reason: 'тест',
    });

    expect(res.diff.length).toBeGreaterThan(0);
    expect(res.diff_summary).toMatch(/Title/);
    const revisions = await store.listRevisions(unit.id);
    expect(revisions).toHaveLength(1);
    expect(revisions[0].snapshot.title).toBe(unit.title);
  });

  it('rejects a move outside the week', async () => {
    const weekId = currentWeekId();
    await seedDemo(store, workspaceId, weekId);
    const [unit] = await store.listUnits({ weekId });
    await expect(call('move_content_unit', { content_unit_id: unit.id, date: '2020-01-01' })).rejects.toThrow(
      /outside week/,
    );
  });

  it('updates one platform variant without touching the others', async () => {
    const weekId = currentWeekId();
    await seedDemo(store, workspaceId, weekId);
    const unit = (await store.listUnits({ weekId })).find((u) => u.platforms.length > 1)!;
    const untouched = unit.platforms[1];

    await call('update_platform_variant', {
      content_unit_id: unit.id,
      platform: unit.platforms[0].platform,
      surface: unit.platforms[0].surface,
      patch: { hook: 'Новый хук' },
    });

    const after = await store.getUnit(unit.id);
    expect(after!.platforms[0].hook).toBe('Новый хук');
    expect(after!.platforms[1].ready_to_use_copy).toBe(untouched.ready_to_use_copy);
  });

  it('refuses a learning with no evidence', async () => {
    await expect(
      call('record_learning', {
        category: 'content',
        observation: 'что-то показалось',
        evidence: [],
      }),
    ).rejects.toThrow();
  });

  it('downgrades CORE_CANDIDATE when a single signal is all there is', async () => {
    const weekId = currentWeekId();
    await seedDemo(store, workspaceId, weekId);
    const [item] = await store.listBacklog();

    const res: any = await call('update_backlog_item', {
      id: item.id,
      status: 'CORE_CANDIDATE',
      evidence: 'один опрос собрал много ответов',
    });

    expect(res.item.status).toBe('PROMISING');
    expect(res.guard).toMatch(/Один удачный опрос/);
  });

  it('allows CORE_CANDIDATE once evidence accumulates', async () => {
    const weekId = currentWeekId();
    await seedDemo(store, workspaceId, weekId);
    const [item] = await store.listBacklog();
    await call('update_backlog_item', { id: item.id, evidence: 'poll на CU-1' });
    const res: any = await call('update_backlog_item', {
      id: item.id,
      status: 'CORE_CANDIDATE',
      evidence: 'quiz на CU-9 подтвердил',
    });
    expect(res.item.status).toBe('CORE_CANDIDATE');
  });
});

describe('strategy drift protection', () => {
  it('lets the AI move operational state', async () => {
    const res: any = await call('update_strategy_state', { sales_level: 'soft' });
    expect(res.strategy_state.sales_level).toBe('soft');
    expect((await store.getStrategyState()).sales_level).toBe('soft');
  });

  it('only lets the AI PROPOSE a change to a fundamental document', async () => {
    const before = await store.getContextDoc('FUNNEL_PLAYBOOK');
    const res: any = await call('propose_strategy_change', {
      target_doc: 'FUNNEL_PLAYBOOK',
      rationale: 'authority работает лучше ожидаемого',
      proposed_change: 'Поднять долю authority до 1:2',
      evidence: ['CU-1', 'CU-2'],
    });

    expect(res.change.status).toBe('PROPOSED');
    expect(res.note).toMatch(/НЕ применено/);
    // the document itself is untouched
    expect((await store.getContextDoc('FUNNEL_PLAYBOOK'))!.body).toBe(before!.body);
  });

  it('marks the fundamental documents immutable', async () => {
    for (const slug of ['MASTER_CONTEXT', 'FUNNEL_PLAYBOOK', 'PRODUCTION_PIPELINE'] as const) {
      expect((await store.getContextDoc(slug))!.immutable).toBe(true);
    }
  });
});

describe('durable sync from tools', () => {
  it('queues a snapshot after a mutation', async () => {
    const weekId = currentWeekId();
    await seedDemo(store, workspaceId, weekId);
    const [unit] = await store.listUnits({ weekId });
    await call('update_content_unit', { content_unit_id: unit.id, title: 'x', reason: 'r' });
    await flushSyncs();

    const log = await store.listSyncLog(10);
    expect(log.length).toBeGreaterThan(0);
    expect(log[0].message).toMatch(/content:/);
    expect(log.some((l) => l.status === 'ok')).toBe(true);
  });
});
