import { ctx, jsonError } from '@/lib/server';
import { baselineObservation, createReport } from '@/lib/services/analytics';
import { getProvider } from '@/lib/ai/agent';
import { ANALYTICS_WINDOWS, PLATFORMS, type AnalyticsWindow, type Platform } from '@/lib/domain/enums';
import { uid } from '@/lib/domain/ids';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { store } = await ctx();
  return Response.json({ reports: await store.listReports({ unitId: id }) });
}

/**
 * Screenshot upload + extraction. Nothing is saved as confirmed here — the
 * user reviews the extracted numbers on the confirmation screen first.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { store } = await ctx();

  const form = await req.formData().catch(() => null);
  if (!form) return jsonError('Expected multipart/form-data');

  const platform = String(form.get('platform') ?? '') as Platform;
  const window = String(form.get('window') ?? '') as AnalyticsWindow;
  if (!PLATFORMS.includes(platform)) return jsonError('Unknown platform');
  if (!ANALYTICS_WINDOWS.includes(window)) return jsonError('Unknown window');

  const unit = await store.getUnit(id);
  if (!unit) return jsonError('Not found', 404);

  const files = form.getAll('screenshots').filter((f): f is File => f instanceof File);
  const stored: string[] = [];
  const images: Array<{ data: Buffer; contentType: string }> = [];

  for (const file of files) {
    const data = Buffer.from(await file.arrayBuffer());
    const ext = (file.name.split('.').pop() ?? 'png').toLowerCase();
    const path = `analytics/${id}/${window}/${uid()}.${ext}`;
    // Storage holds the image; the repo will only ever hold this path.
    const url = await store.putAttachment(path, data, file.type || 'image/png');
    stored.push(url);
    images.push({ data, contentType: file.type || 'image/png' });
  }

  const provider = getProvider();
  const { metrics, note } = images.length
    ? await provider.extractMetrics({ images, platform, window })
    : { metrics: [], note: 'Скриншот не загружен — впишите показатели вручную.' };

  const publishUrl =
    String(form.get('publish_url') ?? '') ||
    unit.platforms.find((p) => p.platform === platform)?.publish_url ||
    '';

  const report = await createReport(store, {
    unitId: id,
    platform,
    window,
    publishUrl,
    screenshots: stored,
    extracted: metrics,
    userNotes: String(form.get('user_notes') ?? ''),
  });

  const peers = (await store.listReports()).filter((r) => r.content_unit_id !== id);
  return Response.json({
    report,
    note,
    preview_observation: baselineObservation(report, peers),
  });
}
