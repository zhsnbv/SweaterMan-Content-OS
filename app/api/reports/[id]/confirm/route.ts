import { z } from 'zod';
import { ctx, jsonError } from '@/lib/server';
import { baselineObservation, confirmReport } from '@/lib/services/analytics';
import { queueSync } from '@/lib/github/sync';
import { METRIC_KEYS } from '@/lib/domain/enums';

export const dynamic = 'force-dynamic';

const body = z.object({
  metrics: z.array(
    z.object({
      key: z.enum(METRIC_KEYS),
      value: z.number().nullable(),
      raw: z.string().default(''),
    }),
  ),
  user_notes: z.string().optional(),
});

/** Only metrics the user has seen and confirmed enter the learning engine. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError('Invalid metrics payload');

  const { store, workspaceId } = await ctx();
  try {
    const { report, unit } = await confirmReport(
      store,
      id,
      parsed.data.metrics,
      parsed.data.user_notes,
    );
    const peers = (await store.listReports()).filter(
      (r) => r.content_unit_id !== report.content_unit_id,
    );
    const observation = baselineObservation(report, peers);
    const withObservation = { ...report, ai_observation: observation };
    await store.saveReport(withObservation);

    queueSync(
      store,
      workspaceId,
      { kind: 'analytics', unitId: report.content_unit_id },
      `analytics: add confirmed ${report.window} report for ${report.content_unit_id}`,
    );
    return Response.json({ report: withObservation, unit });
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : 'Confirm failed', 500);
  }
}
