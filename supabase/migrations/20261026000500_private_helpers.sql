-- BY Tickets: move policy helpers out of the exposed `public` schema.
-- PostgREST only exposes `public`, so helpers there were callable as /rest/v1/rpc/<name> (Supabase
-- advisor lints 0028/0029). Policies reference functions by OID, so `alter function ... set schema`
-- keeps every policy working; only function bodies that call helpers by name are rewritten below.
-- Intentional public RPCs stay in `public`: my_organizer, resubmit_organizer, admin_* (each checks
-- the caller itself).

create schema if not exists private;
revoke all on schema private from public;
-- Policies run as the API role, so it needs to resolve and execute the helpers.
grant usage on schema private to anon, authenticated, service_role;

alter function public.has_role(public.app_role) set schema private;
alter function public.is_admin() set schema private;
alter function public.my_organizer_id(boolean) set schema private;
alter function public.is_event_organizer(uuid) set schema private;
alter function public.is_event_scanner(uuid) set schema private;
alter function public.can_view_event(uuid) set schema private;
alter function public.event_status_of(uuid) set schema private;
alter function public.is_trusted_caller() set schema private;
alter function public.can_write_media(text) set schema private;
alter function public.assert_admin() set schema private;
alter function public.write_audit(text, text, text, jsonb) set schema private;

-- Trigger functions never need to be called directly.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.handle_user_email_change() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Rewrite bodies that referenced helpers by their old schema
-- ---------------------------------------------------------------------------
create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_role('admin');
$$;

create or replace function private.can_view_event(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.events where id = p_event_id and status <> 'draft')
      or private.is_event_organizer(p_event_id)
      or private.is_admin();
$$;

create or replace function private.assert_admin()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'admin role required' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.guard_event_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if private.is_trusted_caller() or old.status = 'draft' then
    return new;
  end if;
  if new.capacity is distinct from old.capacity
     or new.max_transfers is distinct from old.max_transfers
     or new.resale_cap_units is distinct from old.resale_cap_units
     or new.splits is distinct from old.splits
     or new.starts_at is distinct from old.starts_at then
    raise exception 'capacity, transfer rules, splits and start time are locked after publishing'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function public.guard_tier_change()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  st public.event_status;
begin
  if private.is_trusted_caller() then
    return coalesce(new, old);
  end if;
  st := private.event_status_of(coalesce(new.event_id, old.event_id));
  -- null: the parent event is being deleted (cascade), which RLS only allows for drafts
  if st is null or st = 'draft' then
    return coalesce(new, old);
  end if;
  if tg_op <> 'UPDATE'
     or new.price_units is distinct from old.price_units
     or new.capacity is distinct from old.capacity
     or new.event_id is distinct from old.event_id then
    raise exception 'tier price and capacity are locked after publishing' using errcode = '42501';
  end if;
  return new;
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
  perform private.assert_admin();
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
  perform private.assert_admin();
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

  perform private.write_audit('organizer.' || p_status::text, 'organizer', org.id::text,
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
  perform private.assert_admin();
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
  perform private.write_audit(case when p_enabled then 'role.grant' else 'role.revoke' end, 'user',
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
  perform private.assert_admin();
  update public.platform_settings set value = p_value, updated_by = auth.uid(), updated_at = now()
   where key = p_key;
  if not found then
    raise exception 'unknown setting %', p_key using errcode = 'P0002';
  end if;
  perform private.write_audit('setting.update', 'platform_settings', p_key, jsonb_build_object('value', p_value));
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
  perform private.assert_admin();
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
