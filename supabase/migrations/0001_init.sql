-- Sweater Man Content OS — initial schema.
--
-- Design note: columns exist for everything the app filters, joins or orders by.
-- Rich editorial payloads (copy, arrays of notes, snapshots) live in jsonb,
-- which keeps the schema stable while the editorial model evolves.

create extension if not exists "pgcrypto";

/* ---------------- workspace & members ---------------- */

create table if not exists workspaces (
  id             text primary key,
  name           text not null,
  setup_complete boolean not null default false,
  created_at     timestamptz not null default now()
);

create table if not exists workspace_members (
  id           uuid primary key default gen_random_uuid(),
  workspace_id text not null references workspaces(id) on delete cascade,
  user_id      uuid references auth.users(id) on delete set null,
  email        text not null,
  name         text not null default '',
  role         text not null default 'EDITOR' check (role in ('OWNER','EDITOR','VIEWER')),
  created_at   timestamptz not null default now(),
  unique (workspace_id, email)
);
create index if not exists workspace_members_user_idx on workspace_members(user_id);

/* ---------------- persistent context ---------------- */

create table if not exists context_docs (
  workspace_id text not null references workspaces(id) on delete cascade,
  slug         text not null check (slug in
                 ('MASTER_CONTEXT','PERFORMANCE_INSIGHTS','FUNNEL_PLAYBOOK','PRODUCTION_PIPELINE')),
  title        text not null,
  body         text not null,
  -- immutable docs may only change through an approved strategy_change
  immutable    boolean not null default true,
  updated_at   timestamptz not null default now(),
  primary key (workspace_id, slug)
);

create table if not exists strategy_state (
  workspace_id text primary key references workspaces(id) on delete cascade,
  state        jsonb not null default '{}'::jsonb,
  updated_at   timestamptz not null default now()
);

/* ---------------- production pipeline ---------------- */

create table if not exists core_videos (
  id               text primary key,               -- V027
  workspace_id     text not null references workspaces(id) on delete cascade,
  working_title    text not null,
  topic            text not null default '',
  cluster          text not null default '',
  planned_publish_date date,
  status           text not null default 'active',
  production_stage text not null default 'idea' check (production_stage in
                     ('idea','research','storyboard','shooting','assets','assembly','capcut','ready','published')),
  script           text not null default '',
  storyboard_text  text not null default '',
  storyboard_url   text not null default '',
  figma_url        text not null default '',
  production_notes text not null default '',
  payload          jsonb not null default '{}'::jsonb,  -- references, available_assets, attached_files
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists core_videos_ws_idx on core_videos(workspace_id, planned_publish_date);

/* ---------------- calendar ---------------- */

create table if not exists weeks (
  id            text not null,                     -- 2026-W40
  workspace_id  text not null references workspaces(id) on delete cascade,
  start_date    date not null,
  end_date      date not null,
  planning_note text not null default '',
  generated_by  text not null default '',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  primary key (workspace_id, id)
);

create table if not exists content_units (
  id                    text primary key,          -- CU-2026-W40-03
  workspace_id          text not null references workspaces(id) on delete cascade,
  week_id               text not null,
  date                  date not null,
  scheduled_time        text,
  title                 text not null,
  slot_type             text not null default 'custom',
  content_type          text not null check (content_type in
                          ('DISCOVERY','AUDIENCE','PROCESS','AUTHORITY','COMMERCIAL','CORE')),
  source                text not null default '',
  related_core_video_id text references core_videos(id) on delete set null,
  objective             text not null default '',
  hypothesis            text not null default '',
  expected_signal       text not null default '',
  estimated_effort      text not null default 'S' check (estimated_effort in ('XS','S','M','L')),
  status                text not null default 'idea' check (status in
                          ('idea','drafted','ready','scheduled','published','skipped')),
  owner                 text not null default '',
  figma_url             text not null default '',
  notes                 text not null default '',
  ai_reasoning_short    text not null default '',
  revision_number       int  not null default 1,
  position              int  not null default 0,
  analytics_status      jsonb not null default '{}'::jsonb,
  payload               jsonb not null default '{}'::jsonb,  -- assets, references, user_feedback
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  foreign key (workspace_id, week_id) references weeks(workspace_id, id) on delete cascade
);
create index if not exists content_units_week_idx on content_units(workspace_id, week_id, date, position);
create index if not exists content_units_core_idx on content_units(related_core_video_id);

create table if not exists platform_variants (
  id               uuid primary key default gen_random_uuid(),
  content_unit_id  text not null references content_units(id) on delete cascade,
  platform         text not null check (platform in ('instagram','tiktok','youtube','telegram')),
  surface          text not null,
  format           text not null default '',
  ready_to_use_copy text not null default '',
  hook             text not null default '',
  visual_instruction text not null default '',
  cta              text not null default '',
  publish_status   text not null default 'not_published'
                     check (publish_status in ('not_published','published','skipped')),
  publish_url      text not null default '',
  published_at     timestamptz,
  position         int not null default 0
);
create index if not exists platform_variants_unit_idx on platform_variants(content_unit_id, position);

/* ---------------- collaboration ---------------- */

create table if not exists comments (
  id              uuid primary key default gen_random_uuid(),
  content_unit_id text not null references content_units(id) on delete cascade,
  author          text not null,
  author_role     text not null default 'EDITOR',
  message         text not null,
  ai_invoked      boolean not null default false,
  ai_response     text not null default '',
  revision_id     uuid,
  created_at      timestamptz not null default now()
);
create index if not exists comments_unit_idx on comments(content_unit_id, created_at);

create table if not exists ai_chat_threads (
  id           uuid primary key default gen_random_uuid(),
  workspace_id text not null references workspaces(id) on delete cascade,
  scope        text not null check (scope in ('workspace','week','content_unit','core_video')),
  scope_ref    text,
  title        text not null default '',
  created_at   timestamptz not null default now()
);
create index if not exists ai_chat_threads_scope_idx on ai_chat_threads(workspace_id, scope, scope_ref);

create table if not exists ai_chat_messages (
  id         uuid primary key default gen_random_uuid(),
  thread_id  uuid not null references ai_chat_threads(id) on delete cascade,
  role       text not null check (role in ('user','assistant','system')),
  content    text not null,
  tool_calls jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists ai_chat_messages_thread_idx on ai_chat_messages(thread_id, created_at);

/* ---------------- revisions (every AI change is reversible) ---------------- */

create table if not exists content_revisions (
  id              uuid primary key default gen_random_uuid(),
  content_unit_id text not null references content_units(id) on delete cascade,
  revision_number int not null,
  snapshot        jsonb not null,
  diff_summary    text not null default '',
  changed_fields  jsonb not null default '[]'::jsonb,
  reason          text not null default '',
  actor           text not null default 'ai',
  created_at      timestamptz not null default now(),
  unique (content_unit_id, revision_number)
);

/* ---------------- ideas ---------------- */

create table if not exists backlog_items (
  id              text primary key,
  workspace_id    text not null references workspaces(id) on delete cascade,
  title           text not null,
  source          text not null default '',
  cluster         text not null default '',
  why_interesting text not null default '',
  suggested_test  text not null default '',
  status          text not null default 'RAW' check (status in
                    ('RAW','TEST','PROMISING','RESEARCH','CORE_CANDIDATE','PRODUCED','REJECTED')),
  evidence        jsonb not null default '[]'::jsonb,
  notes           text not null default '',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists backlog_ws_idx on backlog_items(workspace_id, status);

/* ---------------- analytics ---------------- */

create table if not exists analytics_reports (
  id              uuid primary key default gen_random_uuid(),
  content_unit_id text not null references content_units(id) on delete cascade,
  platform        text not null,
  window          text not null check (window in ('24h','72h','7d','30d')),
  publish_url     text not null default '',
  screenshots     jsonb not null default '[]'::jsonb,   -- storage paths, never blobs
  user_notes      text not null default '',
  ai_observation  text not null default '',
  confirmed       boolean not null default false,
  created_at      timestamptz not null default now(),
  confirmed_at    timestamptz,
  unique (content_unit_id, platform, window)
);

-- metrics are rows, not a blob, so confirmed numbers can be aggregated in SQL
create table if not exists analytics_metrics (
  id         uuid primary key default gen_random_uuid(),
  report_id  uuid not null references analytics_reports(id) on delete cascade,
  key        text not null,
  value      numeric,              -- null == NA, i.e. not visible in the screenshot
  raw        text not null default '',
  kind       text not null default 'extracted' check (kind in ('extracted','confirmed')),
  unique (report_id, key, kind)
);

/* ---------------- memory ---------------- */

create table if not exists learnings (
  id            text primary key,
  workspace_id  text not null references workspaces(id) on delete cascade,
  category      text not null,
  observation   text not null,
  evidence      jsonb not null default '[]'::jsonb,
  confidence    text not null check (confidence in ('LOW','MEDIUM','HIGH')),
  action        text not null default '',
  tags          jsonb not null default '[]'::jsonb,
  source_units  jsonb not null default '[]'::jsonb,
  superseded_by text references learnings(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index if not exists learnings_ws_idx on learnings(workspace_id, created_at desc);

create table if not exists weekly_reviews (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  text not null references workspaces(id) on delete cascade,
  week_id       text not null,
  units         jsonb not null default '[]'::jsonb,
  content_summary       text not null default '',
  production_summary    text not null default '',
  funnel_summary        text not null default '',
  backlog_summary       text not null default '',
  user_feedback_summary text not null default '',
  next_week_changes     text not null default '',
  generated_by  text not null default '',
  created_at    timestamptz not null default now(),
  unique (workspace_id, week_id)
);

create table if not exists memory_summaries (
  id           uuid primary key default gen_random_uuid(),
  workspace_id text not null references workspaces(id) on delete cascade,
  key          text not null,
  period       text not null default '',
  kind         text not null default 'editorial',
  body         text not null,
  source_count int not null default 0,
  created_at   timestamptz not null default now(),
  unique (workspace_id, key)
);

/* ---------------- strategy governance ---------------- */

create table if not exists strategy_changes (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    text not null references workspaces(id) on delete cascade,
  target_doc      text not null check (target_doc in
                    ('MASTER_CONTEXT','FUNNEL_PLAYBOOK','PRODUCTION_PIPELINE')),
  rationale       text not null,
  proposed_change text not null,
  evidence        jsonb not null default '[]'::jsonb,
  status          text not null default 'PROPOSED'
                    check (status in ('PROPOSED','APPROVED','REJECTED')),
  created_at      timestamptz not null default now(),
  decided_at      timestamptz,
  decided_by      text
);

/* ---------------- attachments & sync ---------------- */

create table if not exists attachments (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  text not null references workspaces(id) on delete cascade,
  storage_path  text not null,
  content_type  text not null default 'application/octet-stream',
  label         text not null default '',
  created_at    timestamptz not null default now()
);

create table if not exists github_sync_log (
  id           uuid primary key default gen_random_uuid(),
  workspace_id text not null references workspaces(id) on delete cascade,
  status       text not null check (status in ('pending','ok','failed')),
  message      text not null,
  files        jsonb not null default '[]'::jsonb,
  commit_sha   text,
  error        text,
  created_at   timestamptz not null default now()
);
create index if not exists github_sync_log_idx on github_sync_log(workspace_id, created_at desc);
