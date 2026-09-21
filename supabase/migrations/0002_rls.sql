-- Row level security: one workspace, three roles.
-- Everything is readable by any member; writes need EDITOR or OWNER;
-- strategy_changes may only be decided by an OWNER.
--
-- The server-side service-role key bypasses RLS, which is how the AI tools and
-- the GitHub sync worker write. These policies protect direct client access.

create or replace function current_member_role(ws text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from workspace_members
  where workspace_id = ws and user_id = auth.uid()
  limit 1
$$;

create or replace function is_member(ws text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from workspace_members
    where workspace_id = ws and user_id = auth.uid()
  )
$$;

create or replace function can_edit(ws text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select current_member_role(ws) in ('OWNER','EDITOR')
$$;

alter table workspaces          enable row level security;
alter table workspace_members   enable row level security;
alter table context_docs        enable row level security;
alter table strategy_state      enable row level security;
alter table core_videos         enable row level security;
alter table weeks               enable row level security;
alter table content_units       enable row level security;
alter table platform_variants   enable row level security;
alter table comments            enable row level security;
alter table ai_chat_threads     enable row level security;
alter table ai_chat_messages    enable row level security;
alter table content_revisions   enable row level security;
alter table backlog_items       enable row level security;
alter table analytics_reports   enable row level security;
alter table analytics_metrics   enable row level security;
alter table learnings           enable row level security;
alter table weekly_reviews      enable row level security;
alter table memory_summaries    enable row level security;
alter table strategy_changes    enable row level security;
alter table attachments         enable row level security;
alter table github_sync_log     enable row level security;

create policy ws_read   on workspaces for select using (is_member(id));
create policy ws_update on workspaces for update using (current_member_role(id) = 'OWNER');

create policy members_read on workspace_members for select using (is_member(workspace_id));
create policy members_write on workspace_members for all
  using (current_member_role(workspace_id) = 'OWNER')
  with check (current_member_role(workspace_id) = 'OWNER');

-- Workspace-scoped tables: read for members, write for editors.
do $$
declare t text;
begin
  foreach t in array array[
    'context_docs','strategy_state','core_videos','weeks','backlog_items',
    'learnings','weekly_reviews','memory_summaries','attachments','github_sync_log',
    'ai_chat_threads'
  ]
  loop
    execute format(
      'create policy %1$s_read on %1$s for select using (is_member(workspace_id))', t);
    execute format(
      'create policy %1$s_write on %1$s for all using (can_edit(workspace_id)) with check (can_edit(workspace_id))', t);
  end loop;
end $$;

-- content_units + everything hanging off it
create policy units_read  on content_units for select using (is_member(workspace_id));
create policy units_write on content_units for all
  using (can_edit(workspace_id)) with check (can_edit(workspace_id));

create policy variants_read on platform_variants for select using (
  exists (select 1 from content_units u where u.id = content_unit_id and is_member(u.workspace_id)));
create policy variants_write on platform_variants for all
  using (exists (select 1 from content_units u where u.id = content_unit_id and can_edit(u.workspace_id)))
  with check (exists (select 1 from content_units u where u.id = content_unit_id and can_edit(u.workspace_id)));

create policy comments_read on comments for select using (
  exists (select 1 from content_units u where u.id = content_unit_id and is_member(u.workspace_id)));
create policy comments_write on comments for all
  using (exists (select 1 from content_units u where u.id = content_unit_id and can_edit(u.workspace_id)))
  with check (exists (select 1 from content_units u where u.id = content_unit_id and can_edit(u.workspace_id)));

-- Revisions are append-only history: insert + read, never update or delete.
create policy revisions_read on content_revisions for select using (
  exists (select 1 from content_units u where u.id = content_unit_id and is_member(u.workspace_id)));
create policy revisions_insert on content_revisions for insert with check (
  exists (select 1 from content_units u where u.id = content_unit_id and can_edit(u.workspace_id)));

create policy reports_read on analytics_reports for select using (
  exists (select 1 from content_units u where u.id = content_unit_id and is_member(u.workspace_id)));
create policy reports_write on analytics_reports for all
  using (exists (select 1 from content_units u where u.id = content_unit_id and can_edit(u.workspace_id)))
  with check (exists (select 1 from content_units u where u.id = content_unit_id and can_edit(u.workspace_id)));

create policy metrics_read on analytics_metrics for select using (
  exists (select 1 from analytics_reports r join content_units u on u.id = r.content_unit_id
          where r.id = report_id and is_member(u.workspace_id)));
create policy metrics_write on analytics_metrics for all
  using (exists (select 1 from analytics_reports r join content_units u on u.id = r.content_unit_id
                 where r.id = report_id and can_edit(u.workspace_id)))
  with check (exists (select 1 from analytics_reports r join content_units u on u.id = r.content_unit_id
                      where r.id = report_id and can_edit(u.workspace_id)));

create policy chat_messages_read on ai_chat_messages for select using (
  exists (select 1 from ai_chat_threads t where t.id = thread_id and is_member(t.workspace_id)));
create policy chat_messages_write on ai_chat_messages for all
  using (exists (select 1 from ai_chat_threads t where t.id = thread_id and can_edit(t.workspace_id)))
  with check (exists (select 1 from ai_chat_threads t where t.id = thread_id and can_edit(t.workspace_id)));

-- A strategy change may be proposed by any editor but only decided by the owner.
create policy strategy_changes_read on strategy_changes for select using (is_member(workspace_id));
create policy strategy_changes_insert on strategy_changes for insert
  with check (can_edit(workspace_id));
create policy strategy_changes_decide on strategy_changes for update
  using (current_member_role(workspace_id) = 'OWNER')
  with check (current_member_role(workspace_id) = 'OWNER');
