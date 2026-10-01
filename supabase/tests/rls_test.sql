-- Row-level security and privilege tests. Run by supabase/tests/run.sh after the shim + migrations.
-- Each block acts as one user (`tests.login` + `set local role`), the way PostgREST does per request.
\set ON_ERROR_STOP 1
\set QUIET 1

create schema tests;
grant usage on schema tests to anon, authenticated, service_role;

create function tests.login(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

create function tests.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  if not coalesce(p_cond, false) then
    raise exception 'FAIL: %', p_msg;
  end if;
  raise notice 'ok - %', p_msg;
end;
$$;

-- Runs p_sql and passes only if it fails (optionally with a specific SQLSTATE).
create function tests.throws(p_sql text, p_msg text, p_code text default null) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if p_code is not null and sqlstate <> p_code then
      raise exception 'FAIL: % (expected %, got % %)', p_msg, p_code, sqlstate, sqlerrm;
    end if;
    raise notice 'ok - % [% %]', p_msg, sqlstate, sqlerrm;
    return;
  end;
  raise exception 'FAIL: % (statement succeeded)', p_msg;
end;
$$;

grant execute on all functions in schema tests to anon, authenticated, service_role;

\set alice '00000000-0000-0000-0000-00000000000a'
\set olga  '00000000-0000-0000-0000-00000000000b'
\set sam   '00000000-0000-0000-0000-00000000000c'
\set adam  '00000000-0000-0000-0000-00000000000d'
\set bob   '00000000-0000-0000-0000-00000000000e'
\set gA 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
\set gB 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'
\set gC 'GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC'
\set gD 'GDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD'

-- ---------------------------------------------------------------------------
\warn '# sign-up'
insert into auth.users (id, email, raw_user_meta_data) values
  (:'alice', 'alice@example.com', '{"display_name": "Alice"}'),
  (:'olga', 'olga@example.com', '{}'),
  (:'sam', 'sam@example.com', '{}'),
  (:'adam', 'adam@example.com', '{}'),
  (:'bob', 'bob@example.com', '{}');
select tests.ok((select count(*) from public.profiles) = 5, 'a profile is created for every new auth user');
select tests.ok((select display_name from public.profiles where id = :'alice') = 'Alice', 'display name comes from sign-up metadata');
select tests.ok((select display_name from public.profiles where id = :'olga') = 'olga', 'display name falls back to the email local part');
select tests.ok((select count(*) from public.user_roles where role = 'customer') = 5, 'every new user gets the customer role');
update auth.users set email = 'alice.b@example.com' where id = :'alice';
select tests.ok((select email::text from public.profiles where id = :'alice') = 'alice.b@example.com', 'email changes sync to the profile');
-- ADMIN_EMAILS bootstrap is done by the server with the service role
insert into public.user_roles (user_id, role) values (:'adam', 'admin');

-- ---------------------------------------------------------------------------
\warn '# a customer only sees and edits their own data'
begin;
select tests.login(:'alice');
set local role authenticated;
select tests.ok((select count(*) from public.profiles) = 1, 'customer sees only their own profile');
select tests.ok((select count(*) from public.user_roles) = 1, 'customer sees only their own roles');
update public.profiles set display_name = 'Alice B' where id = :'alice';
select tests.ok((select display_name from public.profiles) = 'Alice B', 'customer can edit their display name');
with u as (update public.profiles set display_name = 'hacked' where id = :'bob' returning 1)
select tests.ok((select count(*) from u) = 0, 'customer cannot edit someone else''s profile');
select tests.throws($$update public.profiles set email = 'x@example.com'$$, 'customer cannot change the email column directly', '42501');
select tests.throws($$insert into public.user_roles (user_id, role) values ('00000000-0000-0000-0000-00000000000a', 'admin')$$,
  'customer cannot grant themselves a role', '42501');
select tests.throws('select * from public.custodial_keys', 'custodial key ciphertexts are not readable by users', '42501');
select tests.throws('select * from public.wallet_challenges', 'wallet challenges are not readable by users', '42501');
select tests.throws('select * from public.idempotency_keys', 'idempotency store is not readable by users', '42501');
select tests.throws($$insert into public.wallets (user_id, kind, public_key) values ('00000000-0000-0000-0000-00000000000a', 'freighter', 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')$$,
  'users cannot attach a wallet without the server verifying ownership', '42501');
select tests.throws('select public.admin_stats()', 'customer cannot read admin stats', '42501');
select tests.throws($$update public.platform_settings set value = '0' where key = 'platform_fee_bps'$$,
  'customer cannot change platform settings', '42501');
select tests.ok((select count(*) from public.platform_settings) = 2, 'only public settings are visible');
select tests.ok((select count(*) from public.audit_log) = 0, 'audit log is hidden from non-admins');
commit;

-- ---------------------------------------------------------------------------
\warn '# organizer application'
begin;
select tests.login(:'olga');
set local role authenticated;
select tests.throws($$insert into public.organizers (user_id, name, slug, status) values ('00000000-0000-0000-0000-00000000000b', 'Olga', 'olga', 'approved')$$,
  'applicants cannot self-approve (status is not writable)', '42501');
select tests.throws($$insert into public.organizers (user_id, name, slug) values ('00000000-0000-0000-0000-00000000000a', 'Fake', 'fake')$$,
  'applicants cannot apply on behalf of another user', '42501');
insert into public.organizers (user_id, name, slug, contact_email, contact_phone)
values (:'olga', 'Olga Events', 'olga-events', 'olga@example.com', '+260971234567');
select tests.ok((select status from public.my_organizer()) = 'pending', 'new organizer profiles start pending');
select tests.ok((select contact_phone from public.my_organizer()) = '+260971234567', 'owner reads private columns via my_organizer()');
select tests.throws($$insert into public.events (organizer_id, title, slug, venue_name, city, starts_at, capacity)
                      select id, 'Too Early', 'too-early', 'Hall', 'Lusaka', now() + interval '1 day', 10 from public.organizers$$,
  'pending organizers cannot create events', '42501');
commit;
select id as org_id from public.organizers where slug = 'olga-events' \gset

begin;
set local role anon;
select tests.ok((select count(*) from public.organizers) = 0, 'pending organizers are not publicly listed');
select tests.throws('select contact_email from public.organizers', 'organizer contact details are never public', '42501');
commit;

begin;
select tests.login(:'alice');
set local role authenticated;
select tests.throws(format('select public.admin_review_organizer(%L, %L)', :'org_id', 'approved'),
  'customers cannot approve organizers', '42501');
commit;

\warn '# admin review'
begin;
select tests.login(:'adam');
set local role authenticated;
select tests.ok((select count(*) from public.admin_list_organizers('pending')) = 1, 'admin sees the pending application');
select public.admin_review_organizer(:'org_id', 'approved', 'Welcome aboard');
select tests.ok((select count(*) from public.profiles) = 5, 'admin can read all profiles');
select tests.throws(format('select public.admin_set_role(%L, %L, false)', :'adam', 'admin'),
  'admins cannot remove their own admin role (lock-out guard)', '42501');
select tests.throws(format('select public.admin_review_organizer(%L, %L)', :'org_id', 'pending'),
  'review cannot move an organizer back to pending', '22023');
select tests.ok((select (public.admin_stats() ->> 'organizers_approved')::int) = 1, 'admin stats work');
commit;
select tests.ok(exists (select 1 from public.user_roles where user_id = :'olga' and role = 'organizer'),
  'approval grants the organizer role');
select tests.ok(exists (select 1 from public.audit_log where action = 'organizer.approved' and actor_id = :'adam'),
  'approval is written to the audit log with the acting admin');

-- ---------------------------------------------------------------------------
\warn '# events and tiers'
begin;
select tests.login(:'olga');
set local role authenticated;
select tests.throws(format($$insert into public.events (organizer_id, title, slug, venue_name, city, starts_at, capacity, splits)
                            values (%L, 'Bad Split', 'bad-split', 'Hall', 'Lusaka', now() + interval '1 day', 10,
                                    '[{"recipient": "%s", "bps": 9000}]')$$, :'org_id', :'gA'),
  'revenue splits must sum to 10000 bps', '23514');
select tests.throws(format($$insert into public.events (organizer_id, title, slug, venue_name, city, starts_at, capacity, chain_event_id)
                            values (%L, 'Forged', 'forged', 'Hall', 'Lusaka', now() + interval '1 day', 10, 99)$$, :'org_id'),
  'organizers cannot set the on-chain event id', '42501');
insert into public.events (organizer_id, title, slug, venue_name, city, starts_at, capacity, max_transfers, resale_cap_units, splits)
values (:'org_id', 'Lusaka Live', 'lusaka-live', 'Showgrounds', 'Lusaka', now() + interval '30 days', 100, 1, 1500000000,
        format('[{"recipient": "%s", "bps": 7000, "label": "Organizer"}, {"recipient": "%s", "bps": 3000, "label": "Artist"}]', :'gA', :'gB')::jsonb);
commit;
select id as event_id from public.events where slug = 'lusaka-live' \gset

begin;
select tests.login(:'olga');
set local role authenticated;
insert into public.ticket_tiers (event_id, name, price_units, capacity) values (:'event_id', 'General', 1000000000, 80);
select tests.throws(format($$insert into public.ticket_tiers (event_id, name, price_units, capacity) values (%L, 'Huge', 1, 200)$$, :'event_id'),
  'tier capacity cannot exceed event capacity', '23514');
select tests.throws(format($$update public.events set status = 'published' where id = %L$$, :'event_id'),
  'organizers cannot publish directly (publishing requires the on-chain event)', '42501');
commit;

begin;
select tests.login(:'alice');
set local role authenticated;
select tests.throws(format($$insert into public.ticket_tiers (event_id, name, price_units, capacity) values (%L, 'Mine', 1, 1)$$, :'event_id'),
  'non-owners cannot add tiers', '42501');
select tests.ok((select count(*) from public.events) = 0, 'draft events are hidden from other users');
commit;

begin;
set local role anon;
select tests.ok((select count(*) from public.events) = 0, 'draft events are hidden from anonymous visitors');
select tests.ok((select count(*) from public.ticket_tiers) = 0, 'draft tiers are hidden from anonymous visitors');
commit;

select tests.throws(format($$update public.events set status = 'published' where id = %L$$, :'event_id'),
  'an event cannot be published without its on-chain id', '23514');

\warn '# server publishes after create_event succeeds on-chain'
begin;
set local role service_role;
update public.events
   set chain_event_id = 1, metadata_hash = repeat('c', 64), fee_bps = 250, create_tx_hash = repeat('b', 64), status = 'published'
 where id = :'event_id';
update public.ticket_tiers set chain_tier = 0 where event_id = :'event_id';
commit;

begin;
set local role anon;
select tests.ok((select count(*) from public.events) = 1, 'published events are public');
select tests.ok((select count(*) from public.ticket_tiers) = 1, 'published tiers are public');
select tests.ok((select count(*) from public.events where search @@ to_tsquery('simple', 'lusaka')) = 1, 'full-text search finds the event');
commit;

begin;
select tests.login(:'olga');
set local role authenticated;
select tests.throws(format('update public.events set capacity = 500 where id = %L', :'event_id'),
  'capacity is locked after publishing', '42501');
select tests.throws(format($$update public.events set splits = '[]' where id = %L$$, :'event_id'),
  'revenue splits are locked after publishing', '42501');
update public.events set title = 'Lusaka Live 2026' where id = :'event_id';
select tests.ok((select title from public.events where id = :'event_id') = 'Lusaka Live 2026', 'descriptive fields stay editable');
select tests.throws(format('update public.ticket_tiers set price_units = 1 where event_id = %L', :'event_id'),
  'tier price is locked after publishing', '42501');
update public.ticket_tiers set name = 'General Admission' where event_id = :'event_id';
select tests.throws(format($$insert into public.ticket_tiers (event_id, name, price_units, capacity) values (%L, 'VIP', 1, 1)$$, :'event_id'),
  'new tiers on a live event go through the server (add_tier on-chain)', '42501');
delete from public.events where id = :'event_id';
select tests.ok(exists (select 1 from public.events where id = :'event_id'), 'published events cannot be deleted');
commit;

-- ---------------------------------------------------------------------------
\warn '# chain mirrors are written only by the server'
begin;
set local role service_role;
insert into public.event_scanners (event_id, user_id, scanner_public_key) values (:'event_id', :'sam', :'gC');
insert into public.orders (id, user_id, event_id, tier_id, unit_price_units, total_units, payment_method, status, idempotency_key, tx_hash)
select '00000000-0000-0000-0000-000000000101', :'alice', :'event_id', id, 1000000000, 1000000000, 'stellar_usdc', 'confirmed', 'idem-key-0001', repeat('a', 64)
  from public.ticket_tiers where event_id = :'event_id';
select tests.throws(format($$insert into public.orders (user_id, event_id, tier_id, quantity, unit_price_units, total_units, payment_method, idempotency_key)
                            select %L, %L, id, 2, 100, 100, 'stellar_usdc', 'idem-key-0002' from public.ticket_tiers where event_id = %L$$,
                           :'alice', :'event_id', :'event_id'),
  'order total must equal unit price x quantity', '23514');
select tests.throws(format($$insert into public.orders (user_id, event_id, tier_id, unit_price_units, total_units, payment_method, idempotency_key)
                            select %L, %L, id, 1, 1, 'stellar_usdc', 'idem-key-0001' from public.ticket_tiers where event_id = %L$$,
                           :'alice', :'event_id', :'event_id'),
  'idempotency key is unique per user (no double orders on retry)', '23505');
insert into public.tickets (id, chain_ticket_id, event_id, tier_id, order_id, owner_public_key, owner_user_id, mint_tx_hash)
select '00000000-0000-0000-0000-000000000201', 1, :'event_id', id, '00000000-0000-0000-0000-000000000101', :'gD', :'alice', repeat('a', 64)
  from public.ticket_tiers where event_id = :'event_id';
select tests.throws(format($$insert into public.tickets (chain_ticket_id, event_id, tier_id, owner_public_key, mint_tx_hash)
                            select 1, %L, id, %L, repeat('e', 64) from public.ticket_tiers where event_id = %L$$,
                           :'event_id', :'gD', :'event_id'),
  'an on-chain ticket id can only be mirrored once', '23505');
insert into public.checkins (client_scan_id, ticket_id, event_id, scanner_user_id, scanned_at, result)
values (gen_random_uuid(), '00000000-0000-0000-0000-000000000201', :'event_id', :'sam', now(), 'accepted');
select tests.throws(format($$insert into public.checkins (client_scan_id, ticket_id, event_id, scanner_user_id, scanned_at, result)
                            values (gen_random_uuid(), '00000000-0000-0000-0000-000000000201', %L, %L, now(), 'accepted')$$,
                           :'event_id', :'sam'),
  'a ticket can be accepted at the door only once (double entry)', '23505');
insert into public.checkins (client_scan_id, ticket_id, event_id, scanner_user_id, scanned_at, result)
values (gen_random_uuid(), '00000000-0000-0000-0000-000000000201', :'event_id', :'sam', now(), 'duplicate');
insert into public.points_ledger (user_id, public_key, amount_units, reason, tx_hash)
values (:'alice', :'gD', 1000000000, 'purchase', repeat('a', 64));
select tests.throws(format($$insert into public.points_ledger (user_id, public_key, amount_units, reason, tx_hash)
                            values (%L, %L, 1000000000, 'purchase', repeat('a', 64))$$, :'alice', :'gD'),
  'the indexer cannot credit the same points event twice', '23505');
commit;

\warn '# who can see tickets, orders and scans'
begin;
select tests.login(:'alice');
set local role authenticated;
select tests.ok((select count(*) from public.tickets) = 1, 'owner sees their ticket');
select tests.ok((select count(*) from public.orders) = 1, 'buyer sees their order');
select tests.ok((select count(*) from public.points_ledger) = 1, 'user sees their points history');
select tests.ok((select count(*) from public.checkins) = 0, 'customers do not see door scan logs');
select tests.throws($$update public.tickets set owner_user_id = '00000000-0000-0000-0000-00000000000e'$$,
  'owners cannot reassign tickets in the database (transfers happen on-chain)', '42501');
select tests.throws($$update public.tickets set status = 'valid'$$, 'owners cannot un-use a ticket', '42501');
commit;

begin;
select tests.login(:'sam');
set local role authenticated;
select tests.ok((select count(*) from public.tickets) = 1, 'event scanner sees the door list');
select tests.ok((select count(*) from public.checkins) = 2, 'event scanner sees scan logs');
select tests.ok((select count(*) from public.orders) = 0, 'scanners do not see orders or payments');
select tests.throws(format($$insert into public.checkins (client_scan_id, event_id, scanner_user_id, scanned_at, result)
                            values (gen_random_uuid(), %L, %L, now(), 'accepted')$$, :'event_id', :'sam'),
  'scanners record check-ins through the server, not directly', '42501');
commit;

begin;
select tests.login(:'olga');
set local role authenticated;
select tests.ok((select count(*) from public.tickets) = 1, 'organizer sees tickets for their events');
select tests.ok((select count(*) from public.orders) = 1, 'organizer sees orders for their events');
select tests.ok((select count(*) from public.event_scanners) = 1, 'organizer sees their scanners');
commit;

begin;
select tests.login(:'bob');
set local role authenticated;
select tests.ok((select count(*) from public.tickets) = 0, 'other users see no tickets');
select tests.ok((select count(*) from public.orders) = 0, 'other users see no orders');
select tests.ok((select count(*) from public.checkins) = 0, 'other users see no scans');
select tests.ok((select count(*) from public.events) = 1, 'other users see the published event');
commit;

-- ---------------------------------------------------------------------------
\warn '# rejected organizers can resubmit'
begin;
select tests.login(:'bob');
set local role authenticated;
insert into public.organizers (user_id, name, slug) values (:'bob', 'Bob Promotions', 'bob-promotions');
commit;
select id as bob_org from public.organizers where slug = 'bob-promotions' \gset
begin;
select tests.login(:'adam');
set local role authenticated;
select public.admin_review_organizer(:'bob_org', 'rejected', 'Please add a contact phone number');
commit;
begin;
select tests.login(:'bob');
set local role authenticated;
select tests.ok((select review_note from public.my_organizer()) = 'Please add a contact phone number', 'applicant sees the review note');
update public.organizers set contact_phone = '+260977000000' where user_id = :'bob';
select public.resubmit_organizer();
select tests.ok((select status from public.my_organizer()) = 'pending', 'resubmitting moves the application back to pending');
commit;

-- ---------------------------------------------------------------------------
\warn '# storage: write only to your own folder'
begin;
select tests.login(:'olga');
set local role authenticated;
insert into storage.objects (bucket_id, name) values ('public-media', 'organizers/' || :'org_id' || '/cover.png');
select tests.throws($$insert into storage.objects (bucket_id, name) values ('public-media', 'avatars/00000000-0000-0000-0000-00000000000a/me.png')$$,
  'cannot upload into another user''s avatar folder', '42501');
commit;
begin;
select tests.login(:'alice');
set local role authenticated;
insert into storage.objects (bucket_id, name) values ('public-media', 'avatars/' || :'alice' || '/me.png');
select tests.throws(format($$insert into storage.objects (bucket_id, name) values ('public-media', 'organizers/%s/x.png')$$, :'org_id'),
  'cannot upload into an organizer folder you do not own', '42501');
select tests.throws($$insert into storage.objects (bucket_id, name) values ('public-media', 'loose.png')$$,
  'uploads outside the known folders are rejected', '42501');
commit;

\warn '# all RLS tests passed'
