import { ctx, integrationStatus } from '@/lib/server';
import { currentWeekId } from '@/lib/domain/week';
import { recomputeAnalyticsStatus } from '@/lib/services/analytics-status';

export const dynamic = 'force-dynamic';

/**
 * One read endpoint for the whole app shell. Keeps the client simple: it
 * refetches this after any mutation rather than patching local state by hand.
 */
export async function GET(req: Request) {
  const { store, workspaceId } = await ctx();
  const url = new URL(req.url);
  const weekId = url.searchParams.get('week') ?? currentWeekId();

  const [week, rawUnits, weeks, coreVideos, backlog, learnings, reviews, syncLog, contextDocs, strategyState, strategyChanges, members, workspace, allReports] =
    await Promise.all([
      store.getWeek(weekId),
      store.listUnits({ weekId }),
      store.listWeeks(),
      store.listCoreVideos(),
      store.listBacklog(),
      store.listLearnings(),
      store.listReviews(),
      store.listSyncLog(8),
      store.listContextDocs(),
      store.getStrategyState(),
      store.listStrategyChanges(),
      store.listMembers(),
      store.getWorkspace(),
      store.listReports(),
    ]);

  // Due flags are time-derived, so recompute them on read rather than trusting
  // whatever was stored when the card was last written.
  const units = await Promise.all(
    rawUnits.map(async (u) => {
      const reports = allReports.filter((r) => r.content_unit_id === u.id);
      const next = recomputeAnalyticsStatus(u, reports);
      if (JSON.stringify(next.analytics_status) !== JSON.stringify(u.analytics_status)) {
        await store.saveUnit(next);
      }
      return next;
    }),
  );

  return Response.json({
    workspaceId,
    workspace,
    weekId,
    week,
    units,
    weeks: weeks.map((w) => w.id),
    coreVideos,
    backlog,
    learnings,
    reviews,
    syncLog,
    contextDocs,
    strategyState,
    strategyChanges,
    members,
    reports: allReports,
    integrations: await integrationStatus(),
  });
}
