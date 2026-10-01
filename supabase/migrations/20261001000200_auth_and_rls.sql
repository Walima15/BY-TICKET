-- BY Tickets: auth hooks, role helpers, table privileges and row-level security.
--
-- Model:
--   * Every table has RLS enabled. Tables with no policy for a role are invisible to it.
--   * Supabase grants ALL on public tables to anon/authenticated by default; we revoke that and grant
--     back only what each role needs, using column lists where a row is partly private or partly
--     chain-controlled (defence in depth on top of RLS).
--   * Chain mirrors (tickets, orders, check-ins, points, badges, ...) have no write grants at all:
--     only the service role (trusted server code that verified the transaction) writes them.
--   * Helper functions are SECURITY DEFINER with an empty search_path so policies don't recurse
--     through RLS and can't be hijacked by objects in other schemas.

-- ---------------------------------------------------------------------------
-- New users: profile + default customer role
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    new.email,
    nullif(left(coalesce(new.raw_user_meta_data ->> 'display_name', split_part(coalesce(new.email, ''), '@', 1)), 80), '')
  )
  on conflict (id) do nothing;
  insert into public.user_roles (user_id, role) values (new.id, 'customer') on conflict do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.handle_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles set email = new.email where id = new.id;
  return new;
end;
$$;

create trigger on_auth_user_email_changed after update of email on auth.users
  for each row when (old.email is distinct from new.email)
  execute function public.handle_user_email_change();

-- ---------------------------------------------------------------------------
-- Role helpers (used by policies and RPCs)
-- ---------------------------------------------------------------------------
create or replace function public.has_role(p_role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.user_roles where user_id = auth.uid() and role = p_role);
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_role('admin');
$$;

create or replace function public.my_organizer_id(p_approved_only boolean default false)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from public.organizers
  where user_id = auth.uid() and (not p_approved_only or status = 'approved');
$$;

create or replace function public.is_event_organizer(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.events e
    join public.organizers o on o.id = e.organizer_id
    where e.id = p_event_id and o.user_id = auth.uid()
  );
$$;

create or replace function public.is_event_scanner(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.event_scanners
    where event_id = p_event_id and user_id = auth.uid() and enabled
  );
$$;

-- Visible to everyone once it has left draft (published, completed or cancelled), or to staff.
create or replace function public.can_view_event(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.events where id = p_event_id and status <> 'draft')
      or public.is_event_organizer(p_event_id)
      or public.is_admin();
$$;

create or replace function public.event_status_of(p_event_id uuid)
returns public.event_status
language sql
stable
security definer
set search_path = ''
as $$
  select status from public.events where id = p_event_id;
$$;

-- True for trusted callers (service_role / migrations), false for API users.
create or replace function public.is_trusted_caller()
returns boolean
language sql
stable
set search_path = ''
as $$
  select current_user not in ('anon', 'authenticated');
$$;

-- ---------------------------------------------------------------------------
-- Guards for chain-controlled columns
-- ---------------------------------------------------------------------------
-- Once an event exists on-chain, capacity / transfer rules / splits change only through the server
-- (which calls `update_event` on the contract and then mirrors the result).
create or replace function public.guard_event_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if public.is_trusted_caller() or old.status = 'draft' then
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
create trigger events_guard_update before update on public.events
  for each row execute function public.guard_event_update();

create or replace function public.guard_tier_change()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  st public.event_status;
begin
  if public.is_trusted_caller() then
    return coalesce(new, old);
  end if;
  st := public.event_status_of(coalesce(new.event_id, old.event_id));
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
create trigger ticket_tiers_guard before insert or update or delete on public.ticket_tiers
  for each row execute function public.guard_tier_change();

-- Tier capacity can't exceed event capacity (mirrors the contract).
create or replace function public.validate_tier_capacity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.capacity > (select capacity from public.events where id = new.event_id) then
    raise exception 'tier capacity exceeds event capacity' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger ticket_tiers_capacity before insert or update of capacity on public.ticket_tiers
  for each row execute function public.validate_tier_capacity();

-- ---------------------------------------------------------------------------
-- Privileges: start from nothing, grant back explicitly
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

-- profiles
grant select on public.profiles to authenticated;
grant update (display_name, avatar_path, phone, city, country) on public.profiles to authenticated;

-- user_roles, wallets: read own
grant select on public.user_roles, public.wallets to authenticated;

-- organizers: public columns only; owners read the full row via my_organizer()
grant select (id, user_id, name, slug, bio, logo_path, city, country, status, created_at)
  on public.organizers to anon, authenticated;
grant insert (user_id, name, slug, bio, logo_path, city, country, contact_email, contact_phone, payout_public_key)
  on public.organizers to authenticated;
grant update (name, slug, bio, logo_path, city, country, contact_email, contact_phone, payout_public_key)
  on public.organizers to authenticated;

-- events
grant select on public.events to anon, authenticated;
grant insert (organizer_id, title, slug, summary, description, category, cover_path, artist_name, venue_name,
              venue_address, city, country, latitude, longitude, starts_at, ends_at, timezone, capacity,
              max_transfers, resale_cap_units, splits)
  on public.events to authenticated;
grant update (title, slug, summary, description, category, cover_path, artist_name, venue_name, venue_address,
              city, country, latitude, longitude, starts_at, ends_at, timezone, capacity, max_transfers,
              resale_cap_units, splits)
  on public.events to authenticated;
grant delete on public.events to authenticated;

-- ticket tiers
grant select on public.ticket_tiers to anon, authenticated;
grant insert (event_id, name, description, price_units, capacity, sort_order, sales_start_at, sales_end_at)
  on public.ticket_tiers to authenticated;
grant update (name, description, price_units, capacity, sort_order, sales_start_at, sales_end_at)
  on public.ticket_tiers to authenticated;
grant delete on public.ticket_tiers to authenticated;

-- read-only mirrors for signed-in users
grant select on public.event_scanners, public.orders, public.tickets, public.ticket_transfers,
  public.ticket_credentials, public.checkins, public.points_ledger, public.badges, public.redemptions
  to authenticated;

-- public catalogue
grant select on public.perks, public.platform_settings to anon, authenticated;

-- admin-only read
grant select on public.audit_log to authenticated;

-- custodial_keys, wallet_challenges, chain_cursors, idempotency_keys: no grants (service role only)

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.wallets enable row level security;
alter table public.custodial_keys enable row level security;
alter table public.wallet_challenges enable row level security;
alter table public.organizers enable row level security;
alter table public.events enable row level security;
alter table public.ticket_tiers enable row level security;
alter table public.event_scanners enable row level security;
alter table public.orders enable row level security;
alter table public.tickets enable row level security;
alter table public.ticket_transfers enable row level security;
alter table public.ticket_credentials enable row level security;
alter table public.checkins enable row level security;
alter table public.points_ledger enable row level security;
alter table public.badges enable row level security;
alter table public.perks enable row level security;
alter table public.redemptions enable row level security;
alter table public.platform_settings enable row level security;
alter table public.audit_log enable row level security;
alter table public.chain_cursors enable row level security;
alter table public.idempotency_keys enable row level security;

-- profiles
create policy profiles_select_own on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select public.is_admin()));
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- user_roles
create policy user_roles_select_own on public.user_roles for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));

-- wallets
create policy wallets_select_own on public.wallets for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));

-- organizers
create policy organizers_select_public on public.organizers for select to anon, authenticated
  using (status = 'approved' or user_id = (select auth.uid()) or (select public.is_admin()));
create policy organizers_insert_self on public.organizers for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy organizers_update_own on public.organizers for update to authenticated
  using (user_id = (select auth.uid()) and status <> 'suspended')
  with check (user_id = (select auth.uid()));

-- events
create policy events_select_visible on public.events for select to anon, authenticated
  using (status <> 'draft' or (select public.is_admin()) or public.is_event_organizer(id));
create policy events_insert_own on public.events for insert to authenticated
  with check (organizer_id = (select public.my_organizer_id(true)));
create policy events_update_own on public.events for update to authenticated
  using (organizer_id = (select public.my_organizer_id(true)) and status in ('draft', 'published'))
  with check (organizer_id = (select public.my_organizer_id(true)));
create policy events_delete_own_draft on public.events for delete to authenticated
  using (organizer_id = (select public.my_organizer_id(true)) and status = 'draft');

-- ticket tiers
create policy tiers_select_visible on public.ticket_tiers for select to anon, authenticated
  using (public.can_view_event(event_id));
create policy tiers_insert_own on public.ticket_tiers for insert to authenticated
  with check (public.is_event_organizer(event_id));
create policy tiers_update_own on public.ticket_tiers for update to authenticated
  using (public.is_event_organizer(event_id)) with check (public.is_event_organizer(event_id));
create policy tiers_delete_own on public.ticket_tiers for delete to authenticated
  using (public.is_event_organizer(event_id));

-- scanners
create policy scanners_select on public.event_scanners for select to authenticated
  using (user_id = (select auth.uid()) or public.is_event_organizer(event_id) or (select public.is_admin()));

-- orders
create policy orders_select on public.orders for select to authenticated
  using (user_id = (select auth.uid()) or public.is_event_organizer(event_id) or (select public.is_admin()));

-- tickets: owner, the event's organizer and scanners (offline door list), admin
create policy tickets_select on public.tickets for select to authenticated
  using (
    owner_user_id = (select auth.uid())
    or public.is_event_organizer(event_id)
    or public.is_event_scanner(event_id)
    or (select public.is_admin())
  );

create policy transfers_select on public.ticket_transfers for select to authenticated
  using (
    from_user_id = (select auth.uid())
    or to_user_id = (select auth.uid())
    or (select public.is_admin())
    or exists (select 1 from public.tickets t where t.id = ticket_id and public.is_event_organizer(t.event_id))
  );

create policy credentials_select_own on public.ticket_credentials for select to authenticated
  using (user_id = (select auth.uid()));

create policy checkins_select on public.checkins for select to authenticated
  using (public.is_event_organizer(event_id) or public.is_event_scanner(event_id) or (select public.is_admin()));

-- rewards
create policy points_select_own on public.points_ledger for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));
create policy badges_select on public.badges for select to authenticated
  using (user_id = (select auth.uid()) or public.is_event_organizer(event_id) or (select public.is_admin()));
create policy perks_select_active on public.perks for select to anon, authenticated
  using (active or (select public.is_admin()) or sponsor_user_id = (select auth.uid()));
create policy redemptions_select on public.redemptions for select to authenticated
  using (
    user_id = (select auth.uid())
    or (select public.is_admin())
    or exists (select 1 from public.perks p where p.id = perk_id and p.sponsor_user_id = (select auth.uid()))
  );

-- platform
create policy settings_select_public on public.platform_settings for select to anon, authenticated
  using (is_public or (select public.is_admin()));
create policy audit_select_admin on public.audit_log for select to authenticated
  using ((select public.is_admin()));

-- custodial_keys, wallet_challenges, chain_cursors, idempotency_keys: RLS on, no policies.
