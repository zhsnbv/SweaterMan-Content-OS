-- Private bucket for analytics screenshots, production stills and attachments.
-- Heavy files never go to Git; the repo stores only the storage path + metadata.

insert into storage.buckets (id, name, public)
values ('content-os', 'content-os', false)
on conflict (id) do nothing;

create policy "content-os read for members"
  on storage.objects for select
  using (bucket_id = 'content-os' and is_member('ws_sweaterman'));

create policy "content-os write for editors"
  on storage.objects for insert
  with check (bucket_id = 'content-os' and can_edit('ws_sweaterman'));

create policy "content-os update for editors"
  on storage.objects for update
  using (bucket_id = 'content-os' and can_edit('ws_sweaterman'));
