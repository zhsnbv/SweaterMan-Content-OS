import type { Store } from '@/lib/store';
import { backlogItemSchema, coreVideoSchema, weekPlanSchema } from '@/lib/domain/schema';
import { currentWeekId, weekDates, weekEnd, weekStart } from '@/lib/domain/week';
import { format } from 'date-fns';
import { createUnit } from './units';
import { buildWeekSkeleton, planningNote } from './planner';

/**
 * Development seed: one core video (V027) and a sample week built by the real
 * planner, not by hand — so the demo shows exactly what the system produces.
 * `resetContent()` clears all of it while keeping the persistent context docs.
 */
export async function seedDemo(
  store: Store,
  workspaceId: string,
  weekId = currentWeekId(),
): Promise<{ weekId: string; coreVideoId: string; units: number }> {
  const now = new Date().toISOString();
  const dates = weekDates(weekId);

  const core = coreVideoSchema.parse({
    id: 'V027',
    workspace_id: workspaceId,
    working_title: 'Почему осьминоги бьют рыб, с которыми охотятся',
    topic: 'Совместная охота осьминогов и рыб, и удары без очевидной выгоды',
    cluster: 'animals_nature',
    planned_publish_date: dates[3],
    status: 'active',
    production_stage: 'assets',
    script: '',
    storyboard_text: [
      'СЦЕНА 1. Риф, общий план. Осьминог и групер плывут рядом.',
      'Sweater Man (слева, небольшой, рука у подбородка): «Они охотятся вместе. Это не метафора, это задокументировано.»',
      'Нужно: фон рифа, осьминог, групер.',
      '',
      'СЦЕНА 2. Крупный план щупальца.',
      'Sweater Man: «А потом осьминог бьёт напарника. Без причины, которую мы смогли бы назвать.»',
      'Нужно: щупальце крупно, групер с мультяшными глазами.',
      '',
      'СЦЕНА 3. Групер отлетает, крестики в глазах.',
      'Sweater Man (справа): «Учёные до сих пор спорят зачем. Версии: выгнать конкурента, перераспределить добычу или просто потому что можно.»',
      'Нужно: вариация групера «удивлённый», инфо-врезка.',
    ].join('\n'),
    storyboard_url: '',
    figma_url: '',
    references: ['Bayer et al., партнёрская охота осьминогов — перепроверить перед публикацией'],
    available_assets: [
      { label: 'background master: коралловый риф', url: '', kind: 'background' },
      { label: 'осьминог master + 4 вариации', url: '', kind: 'character' },
      { label: 'групер: нейтральный / удивлённый / отлетающий', url: '', kind: 'character' },
      { label: 'брак генерации: осьминог с шестью глазами', url: '', kind: 'reject' },
    ],
    production_notes:
      'Ассеты сгенерированы, ведущий отснят и вырезан. Осталась сборка сцен и CapCut.',
    attached_files: [],
    created_at: now,
    updated_at: now,
  });
  await store.saveCoreVideo(core);

  const backlogSeed = [
    {
      title: 'Почему вороны узнают лица людей годами',
      cluster: 'animals_nature',
      why_interesting:
        'Reputation reversal по знакомому объекту (H1). Вороны уже были в V003 и V025 — тема не выжата.',
      suggested_test: 'Story poll: «Ворона запомнит твоё лицо? Да / Нет»',
      status: 'PROMISING' as const,
    },
    {
      title: 'Что на самом деле случилось с последним мамонтом',
      cluster: 'prehistory_evolution',
      why_interesting: 'Deep time даёт меньше reach, но subs/1k ~1,7–1,8× канала (H4).',
      suggested_test: 'YouTube Community quiz: когда вымер последний мамонт.',
      status: 'RAW' as const,
    },
    {
      title: 'Пожар, который переписал город — глазами человека внутри',
      cluster: 'history',
      why_interesting: 'H3: история = модель редкого мега-хита (V001). Нужно 2 ролика.',
      suggested_test: 'Опрос: три события на выбор.',
      status: 'RAW' as const,
    },
  ];

  for (const b of backlogSeed) {
    await store.saveBacklogItem(
      backlogItemSchema.parse({
        ...b,
        id: `IDEA-${b.title.toLowerCase().replace(/[^a-zа-я0-9]+/gi, '-').slice(0, 30)}`,
        workspace_id: workspaceId,
        source: 'demo_seed',
        evidence: [],
        notes: '',
        created_at: now,
        updated_at: now,
      }),
    );
  }

  const inputs = {
    weekId,
    coreVideos: [core],
    backlog: await store.listBacklog(),
    learnings: await store.listLearnings(),
    previousUnits: [],
    salesLevel: (await store.getStrategyState()).sales_level,
  };
  const proposed = buildWeekSkeleton(inputs);

  await store.saveWeek(
    weekPlanSchema.parse({
      id: weekId,
      workspace_id: workspaceId,
      start_date: format(weekStart(weekId), 'yyyy-MM-dd'),
      end_date: format(weekEnd(weekId), 'yyyy-MM-dd'),
      planning_note: planningNote(proposed, inputs),
      generated_by: 'demo_seed',
      created_at: now,
      updated_at: now,
    }),
  );

  for (const u of proposed) {
    await createUnit(store, workspaceId, weekId, u as never);
  }

  return { weekId, coreVideoId: core.id, units: proposed.length };
}
