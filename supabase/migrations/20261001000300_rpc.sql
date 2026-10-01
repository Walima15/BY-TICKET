-- BY Tickets: RPC functions callable through PostgREST (`supabase.rpc(...)`).
-- Each SECURITY DEFINER function authorises the caller itself; none trusts its arguments for identity.

create or replace function public.write_audit(p_action text, p_entity text, p_entity_id text, p_data jsonb default '{}')
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.audit_log (actor_id, action, entity, entity_id, data)
  values (auth.uid(), p_action, p_entity, p_entity_id, coalesce(p_data, '{}'::jsonb));
$$;
revoke execute on function public.write_audit(text, text, text, jsonb) from public, anon, authenticated;

-- The caller's own organizer profile, including private columns hidden by column grants.
create or replace function public.my_organizer()
returns setof public.organizers
language sql
stable
security definer
set search_path = ''
as $$
  select * from public.organizers where user_id = auth.uid();
$$;

-- Rejected organizers can fix their profile and ask for another review.
create or replace function public.resubmit_organizer()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.organizers
     set status = 'pending', review_note = null, reviewed_by = null, reviewed_at = null
   where user_id = auth.uid() and status = 'rejected';
  if not found then
    raise exception 'no rejected organizer profile to resubmit' using errcode = 'P0002';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Admin
-- ---------------------------------------------------------------------------
create or replace function public.assert_admin()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'admin role required' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.admin_list_organizers(p_status public.organizer_status default null)
returns table (
  id uuid,
  user_id uuid,
  user_email text,
  name text,
  slug text,
  city text,
  country char(2),
  contact_email text,
  contact_phone text,
  payout_public_key text,
  status public.organizer_status,
  on_chain_approved_at timestamptz,
  review_note text,
  reviewed_at timestamptz,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.assert_admin();
  return query
    select o.id, o.user_id, p.email::text, o.name, o.slug, o.city, o.country, o.contact_email::text,
           o.contact_phone, o.payout_public_key::text, o.status, o.on_chain_approved_at, o.review_note,
           o.reviewed_at, o.created_at
      from public.organizers o
      join public.profiles p on p.id = o.user_id
     where p_status is null or o.status = p_status
     order by (o.status = 'pending') desc, o.created_at desc;
end;
$$;

-- Approve / reject / suspend an organizer. Approval grants the `organizer` role; the server then
-- calls `approve_organizer` on-chain and stamps `on_chain_approved_at` (service role).
create or replace function public.admin_review_organizer(
  p_organizer_id uuid,
  p_status public.organizer_status,
  p_note text default null
)
returns public.organizers
language plpgsql
security definer
set search_path = ''
as $$
declare
  org public.organizers;
begin
  perform public.assert_admin();
  if p_status = 'pending' then
    raise exception 'cannot set status back to pending' using errcode = '22023';
  end if;

  update public.organizers
     set status = p_status, review_note = left(p_note, 500), reviewed_by = auth.uid(), reviewed_at = now()
   where id = p_organizer_id
  returning * into org;
  if org.id is null then
    raise exception 'organizer not found' using errcode = 'P0002';
  end if;

  if p_status = 'approved' then
    insert into public.user_roles (user_id, role, granted_by)
    values (org.user_id, 'organizer', auth.uid())
    on conflict do nothing;
  else
    delete from public.user_roles where user_id = org.user_id and role = 'organizer';
  end if;

  perform public.write_audit('organizer.' || p_status::text, 'organizer', org.id::text,
                             jsonb_build_object('note', p_note));
  return org;
end;
$$;

create or replace function public.admin_set_role(p_user_id uuid, p_role public.app_role, p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.assert_admin();
  if p_role = 'customer' then
    raise exception 'the customer role is implicit' using errcode = '22023';
  end if;
  if p_role = 'admin' and not p_enabled and p_user_id = auth.uid() then
    raise exception 'admins cannot remove their own admin role' using errcode = '42501';
  end if;
  if p_enabled then
    insert into public.user_roles (user_id, role, granted_by) values (p_user_id, p_role, auth.uid())
    on conflict do nothing;
  else
    delete from public.user_roles where user_id = p_user_id and role = p_role;
  end if;
  perform public.write_audit(case when p_enabled then 'role.grant' else 'role.revoke' end, 'user',
                             p_user_id::text, jsonb_build_object('role', p_role));
end;
$$;

create or replace function public.admin_update_setting(p_key text, p_value jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.assert_admin();
  update public.platform_settings set value = p_value, updated_by = auth.uid(), updated_at = now()
   where key = p_key;
  if not found then
    raise exception 'unknown setting %', p_key using errcode = 'P0002';
  end if;
  perform public.write_audit('setting.update', 'platform_settings', p_key, jsonb_build_object('value', p_value));
end;
$$;

create or replace function public.admin_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.assert_admin();
  return jsonb_build_object(
    'users', (select count(*) from public.profiles),
    'organizers_pending', (select count(*) from public.organizers where status = 'pending'),
    'organizers_approved', (select count(*) from public.organizers where status = 'approved'),
    'events_published', (select count(*) from public.events where status = 'published'),
    'tickets_sold', (select count(*) from public.tickets),
    'tickets_checked_in', (select count(*) from public.tickets where status = 'checked_in'),
    'gross_units', (select coalesce(sum(total_units), 0) from public.orders where status = 'confirmed')
  );
end;
$$;

-- API users may only call the public RPCs; helpers stay internal to policies.
revoke execute on function public.assert_admin() from public, anon;
revoke execute on function public.my_organizer(), public.resubmit_organizer(),
  public.admin_list_organizers(public.organizer_status),
  public.admin_review_organizer(uuid, public.organizer_status, text),
  public.admin_set_role(uuid, public.app_role, boolean),
  public.admin_update_setting(text, jsonb), public.admin_stats()
  from public, anon;
grant execute on function public.my_organizer(), public.resubmit_organizer(),
  public.admin_list_organizers(public.organizer_status),
  public.admin_review_organizer(uuid, public.organizer_status, text),
  public.admin_set_role(uuid, public.app_role, boolean),
  public.admin_update_setting(text, jsonb), public.admin_stats()
  to authenticated;
