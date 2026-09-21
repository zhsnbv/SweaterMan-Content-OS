import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Store } from './types';
import type {
  AnalyticsReport,
  BacklogItem,
  ChatMessage,
  ChatThread,
  Comment,
  ContentUnit,
  ContextDoc,
  CoreVideo,
  Learning,
  Member,
  MetricValue,
  PlatformVariant,
  Revision,
  StrategyChange,
  StrategyState,
  Summary,
  SyncLogEntry,
  WeekPlan,
  WeeklyReview,
  Workspace,
} from '@/lib/domain/schema';
import {
  analyticsStatusSchema,
  contentUnitSchema,
  coreVideoSchema,
  platformVariantSchema,
} from '@/lib/domain/schema';
import { DEFAULT_WORKSPACE_ID, defaultStrategyState, defaultWorkspace } from './defaults';

const BUCKET = 'content-os';

function must<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(`supabase: ${res.error.message}`);
  return res.data as T;
}

/**
 * Supabase-backed store. Instantiated with the service-role key on the server,
 * so it bypasses RLS; the RLS policies in 0002 protect direct browser access.
 */
export class SupabaseStore implements Store {
  readonly kind = 'supabase' as const;
  private readonly db: SupabaseClient;
  private readonly ws: string;

  constructor(url: string, serviceKey: string, workspaceId = DEFAULT_WORKSPACE_ID) {
    this.db = createClient(url, serviceKey, { auth: { persistSession: false } });
    this.ws = workspaceId;
  }

  /* ---------------- workspace ---------------- */

  async getWorkspace(): Promise<Workspace> {
    const { data } = await this.db.from('workspaces').select('*').eq('id', this.ws).maybeSingle();
    if (!data) return defaultWorkspace();
    return {
      id: data.id,
      name: data.name,
      setup_complete: data.setup_complete,
      created_at: data.created_at,
    };
  }

  async saveWorkspace(w: Workspace): Promise<Workspace> {
    must(
      await this.db
        .from('workspaces')
        .upsert({ id: w.id, name: w.name, setup_complete: w.setup_complete })
        .select()
        .single(),
    );
    return w;
  }

  async listMembers(): Promise<Member[]> {
    const rows = must(
      await this.db.from('workspace_members').select('*').eq('workspace_id', this.ws),
    );
    return (rows ?? []).map((r: any) => ({
      id: r.id,
      workspace_id: r.workspace_id,
      email: r.email,
      name: r.name,
      role: r.role,
      created_at: r.created_at,
    }));
  }

  async saveMember(m: Member): Promise<Member> {
    must(
      await this.db
        .from('workspace_members')
        .upsert(
          {
            id: m.id,
            workspace_id: m.workspace_id,
            email: m.email,
            name: m.name,
            role: m.role,
          },
          { onConflict: 'workspace_id,email' },
        )
        .select()
        .single(),
    );
    return m;
  }

  async removeMember(id: string): Promise<void> {
    await this.db.from('workspace_members').delete().eq('id', id);
  }

  /* ---------------- context ---------------- */

  async listContextDocs(): Promise<ContextDoc[]> {
    const rows = must(await this.db.from('context_docs').select('*').eq('workspace_id', this.ws));
    return (rows ?? []).map((r: any) => ({
      slug: r.slug,
      title: r.title,
      body: r.body,
      immutable: r.immutable,
      updated_at: r.updated_at,
    }));
  }

  async getContextDoc(slug: ContextDoc['slug']): Promise<ContextDoc | null> {
    const { data } = await this.db
      .from('context_docs')
      .select('*')
      .eq('workspace_id', this.ws)
      .eq('slug', slug)
      .maybeSingle();
    if (!data) return null;
    return {
      slug: data.slug,
      title: data.title,
      body: data.body,
      immutable: data.immutable,
      updated_at: data.updated_at,
    };
  }

  async saveContextDoc(doc: ContextDoc): Promise<ContextDoc> {
    must(
      await this.db
        .from('context_docs')
        .upsert(
          {
            workspace_id: this.ws,
            slug: doc.slug,
            title: doc.title,
            body: doc.body,
            immutable: doc.immutable,
            updated_at: doc.updated_at,
          },
          { onConflict: 'workspace_id,slug' },
        )
        .select()
        .single(),
    );
    return doc;
  }

  async getStrategyState(): Promise<StrategyState> {
    const { data } = await this.db
      .from('strategy_state')
      .select('state')
      .eq('workspace_id', this.ws)
      .maybeSingle();
    return (data?.state as StrategyState) ?? defaultStrategyState();
  }

  async saveStrategyState(s: StrategyState): Promise<StrategyState> {
    must(
      await this.db
        .from('strategy_state')
        .upsert({ workspace_id: this.ws, state: s, updated_at: s.updated_at })
        .select()
        .single(),
    );
    return s;
  }

  /* ---------------- weeks + units ---------------- */

  private static weekFromRow(r: any): WeekPlan {
    return {
      id: r.id,
      workspace_id: r.workspace_id,
      start_date: r.start_date,
      end_date: r.end_date,
      planning_note: r.planning_note ?? '',
      generated_by: r.generated_by ?? '',
      created_at: r.created_at,
      updated_at: r.updated_at,
    };
  }

  async listWeeks(): Promise<WeekPlan[]> {
    const rows = must(
      await this.db.from('weeks').select('*').eq('workspace_id', this.ws).order('id'),
    );
    return (rows ?? []).map(SupabaseStore.weekFromRow);
  }

  async getWeek(weekId: string): Promise<WeekPlan | null> {
    const { data } = await this.db
      .from('weeks')
      .select('*')
      .eq('workspace_id', this.ws)
      .eq('id', weekId)
      .maybeSingle();
    return data ? SupabaseStore.weekFromRow(data) : null;
  }

  async saveWeek(w: WeekPlan): Promise<WeekPlan> {
    must(
      await this.db
        .from('weeks')
        .upsert(
          {
            id: w.id,
            workspace_id: this.ws,
            start_date: w.start_date,
            end_date: w.end_date,
            planning_note: w.planning_note,
            generated_by: w.generated_by,
            updated_at: w.updated_at,
          },
          { onConflict: 'workspace_id,id' },
        )
        .select()
        .single(),
    );
    return w;
  }

  private static unitFromRow(r: any): ContentUnit {
    const payload = r.payload ?? {};
    return contentUnitSchema.parse({
      id: r.id,
      workspace_id: r.workspace_id,
      week_id: r.week_id,
      date: r.date,
      scheduled_time: r.scheduled_time,
      title: r.title,
      slot_type: r.slot_type,
      content_type: r.content_type,
      source: r.source ?? '',
      related_core_video_id: r.related_core_video_id,
      objective: r.objective ?? '',
      hypothesis: r.hypothesis ?? '',
      expected_signal: r.expected_signal ?? '',
      estimated_effort: r.estimated_effort,
      status: r.status,
      owner: r.owner ?? '',
      platforms: (r.platform_variants ?? [])
        .map((v: any) =>
          platformVariantSchema.parse({
            id: v.id,
            content_unit_id: v.content_unit_id,
            platform: v.platform,
            surface: v.surface,
            format: v.format ?? '',
            ready_to_use_copy: v.ready_to_use_copy ?? '',
            hook: v.hook ?? '',
            visual_instruction: v.visual_instruction ?? '',
            cta: v.cta ?? '',
            publish_status: v.publish_status,
            publish_url: v.publish_url ?? '',
            published_at: v.published_at,
            position: v.position ?? 0,
          }),
        )
        .sort((a: PlatformVariant, b: PlatformVariant) => a.position - b.position),
      assets: payload.assets ?? [],
      references: payload.references ?? [],
      figma_url: r.figma_url ?? '',
      notes: r.notes ?? '',
      user_feedback: payload.user_feedback ?? [],
      ai_reasoning_short: r.ai_reasoning_short ?? '',
      revision_number: r.revision_number,
      analytics_status: analyticsStatusSchema.parse(r.analytics_status ?? {}),
      position: r.position,
      created_at: r.created_at,
      updated_at: r.updated_at,
    });
  }

  async listUnits(filter?: { weekId?: string }): Promise<ContentUnit[]> {
    let q = this.db
      .from('content_units')
      .select('*, platform_variants(*)')
      .eq('workspace_id', this.ws);
    if (filter?.weekId) q = q.eq('week_id', filter.weekId);
    const rows = must(await q.order('date').order('position'));
    return (rows ?? []).map(SupabaseStore.unitFromRow);
  }

  async getUnit(id: string): Promise<ContentUnit | null> {
    const { data } = await this.db
      .from('content_units')
      .select('*, platform_variants(*)')
      .eq('id', id)
      .maybeSingle();
    return data ? SupabaseStore.unitFromRow(data) : null;
  }

  async saveUnit(u: ContentUnit): Promise<ContentUnit> {
    must(
      await this.db
        .from('content_units')
        .upsert({
          id: u.id,
          workspace_id: this.ws,
          week_id: u.week_id,
          date: u.date,
          scheduled_time: u.scheduled_time,
          title: u.title,
          slot_type: u.slot_type,
          content_type: u.content_type,
          source: u.source,
          related_core_video_id: u.related_core_video_id,
          objective: u.objective,
          hypothesis: u.hypothesis,
          expected_signal: u.expected_signal,
          estimated_effort: u.estimated_effort,
          status: u.status,
          owner: u.owner,
          figma_url: u.figma_url,
          notes: u.notes,
          ai_reasoning_short: u.ai_reasoning_short,
          revision_number: u.revision_number,
          position: u.position,
          analytics_status: u.analytics_status,
          payload: {
            assets: u.assets,
            references: u.references,
            user_feedback: u.user_feedback,
          },
          updated_at: u.updated_at,
        })
        .select()
        .single(),
    );

    // Replace the variant set wholesale: an AI revision may add, drop or
    // reorder variants, and the unit row is the single source of truth.
    const keepIds = u.platforms.map((p) => p.id);
    await this.db
      .from('platform_variants')
      .delete()
      .eq('content_unit_id', u.id)
      .not('id', 'in', `(${keepIds.length ? keepIds.map((x) => `"${x}"`).join(',') : '""'})`);

    if (u.platforms.length) {
      must(
        await this.db
          .from('platform_variants')
          .upsert(
            u.platforms.map((p, i) => ({
              id: p.id,
              content_unit_id: u.id,
              platform: p.platform,
              surface: p.surface,
              format: p.format,
              ready_to_use_copy: p.ready_to_use_copy,
              hook: p.hook,
              visual_instruction: p.visual_instruction,
              cta: p.cta,
              publish_status: p.publish_status,
              publish_url: p.publish_url,
              published_at: p.published_at,
              position: p.position ?? i,
            })),
          )
          .select(),
      );
    }
    return u;
  }

  async deleteUnit(id: string): Promise<void> {
    await this.db.from('content_units').delete().eq('id', id);
  }

  /* ---------------- revisions + comments ---------------- */

  async listRevisions(unitId: string): Promise<Revision[]> {
    const rows = must(
      await this.db
        .from('content_revisions')
        .select('*')
        .eq('content_unit_id', unitId)
        .order('revision_number', { ascending: false }),
    );
    return (rows ?? []).map((r: any) => ({
      id: r.id,
      content_unit_id: r.content_unit_id,
      revision_number: r.revision_number,
      snapshot: r.snapshot,
      diff_summary: r.diff_summary ?? '',
      changed_fields: r.changed_fields ?? [],
      reason: r.reason ?? '',
      actor: r.actor ?? 'ai',
      created_at: r.created_at,
    }));
  }

  async saveRevision(r: Revision): Promise<Revision> {
    must(
      await this.db
        .from('content_revisions')
        .upsert(
          {
            id: r.id,
            content_unit_id: r.content_unit_id,
            revision_number: r.revision_number,
            snapshot: r.snapshot,
            diff_summary: r.diff_summary,
            changed_fields: r.changed_fields,
            reason: r.reason,
            actor: r.actor,
          },
          { onConflict: 'content_unit_id,revision_number' },
        )
        .select()
        .single(),
    );
    return r;
  }

  async listComments(unitId?: string): Promise<Comment[]> {
    let q = this.db.from('comments').select('*');
    if (unitId) q = q.eq('content_unit_id', unitId);
    const rows = must(await q.order('created_at'));
    return (rows ?? []).map((r: any) => ({
      id: r.id,
      content_unit_id: r.content_unit_id,
      author: r.author,
      author_role: r.author_role,
      message: r.message,
      ai_invoked: r.ai_invoked,
      ai_response: r.ai_response ?? '',
      revision_id: r.revision_id,
      created_at: r.created_at,
    }));
  }

  async saveComment(c: Comment): Promise<Comment> {
    must(await this.db.from('comments').upsert(c).select().single());
    return c;
  }

  /* ---------------- production + ideas ---------------- */

  private static coreVideoFromRow(r: any): CoreVideo {
    const payload = r.payload ?? {};
    return coreVideoSchema.parse({
      id: r.id,
      workspace_id: r.workspace_id,
      working_title: r.working_title,
      topic: r.topic ?? '',
      cluster: r.cluster ?? '',
      planned_publish_date: r.planned_publish_date,
      status: r.status,
      script: r.script ?? '',
      storyboard_text: r.storyboard_text ?? '',
      storyboard_url: r.storyboard_url ?? '',
      figma_url: r.figma_url ?? '',
      references: payload.references ?? [],
      production_stage: r.production_stage,
      available_assets: payload.available_assets ?? [],
      production_notes: r.production_notes ?? '',
      attached_files: payload.attached_files ?? [],
      created_at: r.created_at,
      updated_at: r.updated_at,
    });
  }

  async listCoreVideos(): Promise<CoreVideo[]> {
    const rows = must(
      await this.db.from('core_videos').select('*').eq('workspace_id', this.ws).order('id'),
    );
    return (rows ?? []).map(SupabaseStore.coreVideoFromRow);
  }

  async getCoreVideo(id: string): Promise<CoreVideo | null> {
    const { data } = await this.db.from('core_videos').select('*').eq('id', id).maybeSingle();
    return data ? SupabaseStore.coreVideoFromRow(data) : null;
  }

  async saveCoreVideo(v: CoreVideo): Promise<CoreVideo> {
    must(
      await this.db
        .from('core_videos')
        .upsert({
          id: v.id,
          workspace_id: this.ws,
          working_title: v.working_title,
          topic: v.topic,
          cluster: v.cluster,
          planned_publish_date: v.planned_publish_date,
          status: v.status,
          production_stage: v.production_stage,
          script: v.script,
          storyboard_text: v.storyboard_text,
          storyboard_url: v.storyboard_url,
          figma_url: v.figma_url,
          production_notes: v.production_notes,
          payload: {
            references: v.references,
            available_assets: v.available_assets,
            attached_files: v.attached_files,
          },
          updated_at: v.updated_at,
        })
        .select()
        .single(),
    );
    return v;
  }

  async listBacklog(): Promise<BacklogItem[]> {
    const rows = must(
      await this.db.from('backlog_items').select('*').eq('workspace_id', this.ws),
    );
    return (rows ?? []).map((r: any) => ({
      id: r.id,
      workspace_id: r.workspace_id,
      title: r.title,
      source: r.source ?? '',
      cluster: r.cluster ?? '',
      why_interesting: r.why_interesting ?? '',
      suggested_test: r.suggested_test ?? '',
      status: r.status,
      evidence: r.evidence ?? [],
      notes: r.notes ?? '',
      created_at: r.created_at,
      updated_at: r.updated_at,
    }));
  }

  async getBacklogItem(id: string): Promise<BacklogItem | null> {
    const { data } = await this.db.from('backlog_items').select('*').eq('id', id).maybeSingle();
    if (!data) return null;
    const r = data as any;
    return {
      id: r.id,
      workspace_id: r.workspace_id,
      title: r.title,
      source: r.source ?? '',
      cluster: r.cluster ?? '',
      why_interesting: r.why_interesting ?? '',
      suggested_test: r.suggested_test ?? '',
      status: r.status,
      evidence: r.evidence ?? [],
      notes: r.notes ?? '',
      created_at: r.created_at,
      updated_at: r.updated_at,
    };
  }

  async saveBacklogItem(b: BacklogItem): Promise<BacklogItem> {
    must(
      await this.db
        .from('backlog_items')
        .upsert({ ...b, workspace_id: this.ws })
        .select()
        .single(),
    );
    return b;
  }

  /* ---------------- analytics ---------------- */

  private static reportFromRow(r: any): AnalyticsReport {
    const metrics: any[] = r.analytics_metrics ?? [];
    const pick = (kind: string): MetricValue[] =>
      metrics
        .filter((m) => m.kind === kind)
        .map((m) => ({
          key: m.key,
          value: m.value === null || m.value === undefined ? null : Number(m.value),
          raw: m.raw ?? '',
        }));
    return {
      id: r.id,
      content_unit_id: r.content_unit_id,
      platform: r.platform,
      window: r.window,
      publish_url: r.publish_url ?? '',
      screenshots: r.screenshots ?? [],
      extracted_metrics: pick('extracted'),
      confirmed_metrics: pick('confirmed'),
      confirmed: r.confirmed,
      user_notes: r.user_notes ?? '',
      ai_observation: r.ai_observation ?? '',
      created_at: r.created_at,
      confirmed_at: r.confirmed_at,
    };
  }

  async listReports(filter?: { unitId?: string }): Promise<AnalyticsReport[]> {
    let q = this.db.from('analytics_reports').select('*, analytics_metrics(*)');
    if (filter?.unitId) q = q.eq('content_unit_id', filter.unitId);
    const rows = must(await q.order('created_at'));
    return (rows ?? []).map(SupabaseStore.reportFromRow);
  }

  async getReport(id: string): Promise<AnalyticsReport | null> {
    const { data } = await this.db
      .from('analytics_reports')
      .select('*, analytics_metrics(*)')
      .eq('id', id)
      .maybeSingle();
    return data ? SupabaseStore.reportFromRow(data) : null;
  }

  async saveReport(r: AnalyticsReport): Promise<AnalyticsReport> {
    must(
      await this.db
        .from('analytics_reports')
        .upsert(
          {
            id: r.id,
            content_unit_id: r.content_unit_id,
            platform: r.platform,
            window: r.window,
            publish_url: r.publish_url,
            screenshots: r.screenshots,
            user_notes: r.user_notes,
            ai_observation: r.ai_observation,
            confirmed: r.confirmed,
            confirmed_at: r.confirmed_at,
          },
          { onConflict: 'content_unit_id,platform,window' },
        )
        .select()
        .single(),
    );
    await this.db.from('analytics_metrics').delete().eq('report_id', r.id);
    const rows = [
      ...r.extracted_metrics.map((m) => ({ ...m, kind: 'extracted' as const })),
      ...r.confirmed_metrics.map((m) => ({ ...m, kind: 'confirmed' as const })),
    ].map((m) => ({
      report_id: r.id,
      key: m.key,
      value: m.value,
      raw: m.raw,
      kind: m.kind,
    }));
    if (rows.length) must(await this.db.from('analytics_metrics').insert(rows).select());
    return r;
  }

  /* ---------------- memory ---------------- */

  async listLearnings(): Promise<Learning[]> {
    const rows = must(
      await this.db
        .from('learnings')
        .select('*')
        .eq('workspace_id', this.ws)
        .order('created_at', { ascending: false }),
    );
    return (rows ?? []).map((r: any) => ({
      id: r.id,
      workspace_id: r.workspace_id,
      created_at: r.created_at,
      category: r.category,
      observation: r.observation,
      evidence: r.evidence ?? [],
      confidence: r.confidence,
      action: r.action ?? '',
      tags: r.tags ?? [],
      source_units: r.source_units ?? [],
      superseded_by: r.superseded_by,
    }));
  }

  async saveLearning(l: Learning): Promise<Learning> {
    must(await this.db.from('learnings').upsert({ ...l, workspace_id: this.ws }).select().single());
    return l;
  }

  async listReviews(): Promise<WeeklyReview[]> {
    const rows = must(
      await this.db.from('weekly_reviews').select('*').eq('workspace_id', this.ws).order('week_id'),
    );
    return (rows ?? []).map((r: any) => ({ ...r, units: r.units ?? [] }));
  }

  async getReview(weekId: string): Promise<WeeklyReview | null> {
    const { data } = await this.db
      .from('weekly_reviews')
      .select('*')
      .eq('workspace_id', this.ws)
      .eq('week_id', weekId)
      .maybeSingle();
    return data ? { ...(data as any), units: data.units ?? [] } : null;
  }

  async saveReview(r: WeeklyReview): Promise<WeeklyReview> {
    must(
      await this.db
        .from('weekly_reviews')
        .upsert({ ...r, workspace_id: this.ws }, { onConflict: 'workspace_id,week_id' })
        .select()
        .single(),
    );
    return r;
  }

  async listSummaries(): Promise<Summary[]> {
    const rows = must(
      await this.db.from('memory_summaries').select('*').eq('workspace_id', this.ws),
    );
    return (rows ?? []) as Summary[];
  }

  async saveSummary(s: Summary): Promise<Summary> {
    must(
      await this.db
        .from('memory_summaries')
        .upsert({ ...s, workspace_id: this.ws }, { onConflict: 'workspace_id,key' })
        .select()
        .single(),
    );
    return s;
  }

  /* ---------------- strategy governance ---------------- */

  async listStrategyChanges(): Promise<StrategyChange[]> {
    const rows = must(
      await this.db
        .from('strategy_changes')
        .select('*')
        .eq('workspace_id', this.ws)
        .order('created_at', { ascending: false }),
    );
    return (rows ?? []).map((r: any) => ({ ...r, evidence: r.evidence ?? [] }));
  }

  async saveStrategyChange(c: StrategyChange): Promise<StrategyChange> {
    must(
      await this.db.from('strategy_changes').upsert({ ...c, workspace_id: this.ws }).select().single(),
    );
    return c;
  }

  /* ---------------- chat ---------------- */

  async listThreads(): Promise<ChatThread[]> {
    const rows = must(
      await this.db.from('ai_chat_threads').select('*').eq('workspace_id', this.ws),
    );
    return (rows ?? []) as ChatThread[];
  }

  async getThread(id: string): Promise<ChatThread | null> {
    const { data } = await this.db.from('ai_chat_threads').select('*').eq('id', id).maybeSingle();
    return (data as ChatThread) ?? null;
  }

  async saveThread(t: ChatThread): Promise<ChatThread> {
    must(
      await this.db.from('ai_chat_threads').upsert({ ...t, workspace_id: this.ws }).select().single(),
    );
    return t;
  }

  async listMessages(threadId: string): Promise<ChatMessage[]> {
    const rows = must(
      await this.db
        .from('ai_chat_messages')
        .select('*')
        .eq('thread_id', threadId)
        .order('created_at'),
    );
    return (rows ?? []).map((r: any) => ({ ...r, tool_calls: r.tool_calls ?? [] }));
  }

  async saveMessage(m: ChatMessage): Promise<ChatMessage> {
    must(await this.db.from('ai_chat_messages').upsert(m).select().single());
    return m;
  }

  /* ---------------- sync log ---------------- */

  async listSyncLog(limit = 20): Promise<SyncLogEntry[]> {
    const rows = must(
      await this.db
        .from('github_sync_log')
        .select('*')
        .eq('workspace_id', this.ws)
        .order('created_at', { ascending: false })
        .limit(limit),
    );
    return (rows ?? []).map((r: any) => ({ ...r, files: r.files ?? [] }));
  }

  async saveSyncLog(e: SyncLogEntry): Promise<SyncLogEntry> {
    must(
      await this.db.from('github_sync_log').upsert({ ...e, workspace_id: this.ws }).select().single(),
    );
    return e;
  }

  /* ---------------- attachments ---------------- */

  async putAttachment(p: string, data: Buffer, contentType: string): Promise<string> {
    const { error } = await this.db.storage
      .from(BUCKET)
      .upload(p, data, { contentType, upsert: true });
    if (error) throw new Error(`supabase storage: ${error.message}`);
    await this.db
      .from('attachments')
      .insert({ workspace_id: this.ws, storage_path: p, content_type: contentType });
    // Signed URL keeps the bucket private while the UI can still render it.
    const signed = await this.db.storage.from(BUCKET).createSignedUrl(p, 60 * 60 * 24 * 7);
    return signed.data?.signedUrl ?? p;
  }

  async getAttachment(p: string): Promise<{ data: Buffer; contentType: string } | null> {
    const { data, error } = await this.db.storage.from(BUCKET).download(p);
    if (error || !data) return null;
    return {
      data: Buffer.from(await data.arrayBuffer()),
      contentType: data.type || 'application/octet-stream',
    };
  }

  async resetContent(): Promise<void> {
    // Only workspace-scoped tables are listed; platform_variants, comments,
    // revisions, reports and metrics disappear through their ON DELETE CASCADE.
    for (const t of [
      'ai_chat_threads',
      'content_units',
      'weeks',
      'core_videos',
      'backlog_items',
      'learnings',
      'weekly_reviews',
      'memory_summaries',
      'strategy_changes',
      'github_sync_log',
    ]) {
      await this.db.from(t).delete().eq('workspace_id', this.ws);
    }
  }
}
