-- BY Tickets: storage for public images (event covers, organizer logos, perk images, avatars).
-- Paths:  avatars/<user_id>/<file>   organizers/<organizer_id>/<file>
-- The bucket is public-read (images are served by URL); writes are limited to your own folder.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('public-media', 'public-media', true, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'image/avif'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.can_write_media(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case (storage.foldername(p_name))[1]
    when 'avatars' then (storage.foldername(p_name))[2] = auth.uid()::text
    when 'organizers' then (storage.foldername(p_name))[2] = (
      select o.id::text from public.organizers o where o.user_id = auth.uid() and o.status <> 'suspended'
    )
    else false
  end;
$$;

create policy media_select_own on storage.objects for select to authenticated
  using (bucket_id = 'public-media' and public.can_write_media(name));
create policy media_insert_own on storage.objects for insert to authenticated
  with check (bucket_id = 'public-media' and public.can_write_media(name));
create policy media_update_own on storage.objects for update to authenticated
  using (bucket_id = 'public-media' and public.can_write_media(name))
  with check (bucket_id = 'public-media' and public.can_write_media(name));
create policy media_delete_own on storage.objects for delete to authenticated
  using (bucket_id = 'public-media' and public.can_write_media(name));
