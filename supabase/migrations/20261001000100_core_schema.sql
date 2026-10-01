-- BY Tickets: core schema.
-- The Soroban contracts are the source of truth for events-on-sale, tickets, check-ins, points and
-- badges. Rows that mirror chain state carry the chain id + tx hash and are written only by trusted
-- server code (service role) after verifying the transaction. See docs/DECISIONS.md (Phase 3).
--
-- Money: integer token units with 7 decimals (1 USDC = 10 000 000), stored as numeric(39,0) to hold
-- any i128 without float rounding.

create extension if not exists citext with schema extensions;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.app_role as enum ('customer', 'organizer', 'scanner', 'admin');
create type public.organizer_status as enum ('pending', 'approved', 'rejected', 'suspended');
create type public.event_status as enum ('draft', 'published', 'cancelled', 'completed');
create type public.wallet_kind as enum ('custodial', 'freighter');
create type public.order_status as enum ('pending', 'submitted', 'confirmed', 'failed', 'expired', 'refunded');
create type public.payment_method as enum ('stellar_usdc', 'stellar_xlm', 'mobile_money');
create type public.ticket_status as enum ('valid', 'checked_in', 'void');
create type public.checkin_result as enum ('accepted', 'duplicate', 'invalid', 'not_scanner');
create type public.chain_sync_status as enum ('pending', 'confirmed', 'failed');
create type public.redemption_status as enum ('pending', 'confirmed', 'fulfilled', 'failed');

-- ---------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Stellar StrKey shapes (checksum is verified in application code).
create domain public.stellar_account as text check (value ~ '^G[A-Z2-7]{55}$');
create domain public.stellar_contract as text check (value ~ '^C[A-Z2-7]{55}$');
create domain public.tx_hash as text check (value ~ '^[0-9a-f]{64}$');
create domain public.token_units as numeric(39, 0) check (value >= 0);

-- ---------------------------------------------------------------------------
-- Users
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email extensions.citext,
  display_name text check (char_length(display_name) between 1 and 80),
  avatar_path text check (char_length(avatar_path) <= 300),
  phone text check (phone ~ '^\+?[0-9]{7,15}$'),
  city text check (char_length(city) <= 80),
  country char(2) not null default 'ZM' check (country ~ '^[A-Z]{2}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

create table public.user_roles (
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.app_role not null,
  granted_by uuid references public.profiles (id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (user_id, role)
);

create table public.wallets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind public.wallet_kind not null,
  public_key public.stellar_account not null unique,
  is_primary boolean not null default false,
  -- custodial: when the platform created + funded the account and its USDC trustline (Phase 4)
  activated_at timestamptz,
  -- freighter: when ownership was proven by signing a server challenge (Phase 4)
  verified_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index wallets_one_primary on public.wallets (user_id) where is_primary;
create unique index wallets_one_custodial on public.wallets (user_id) where kind = 'custodial';

-- Encrypted custodial secrets. RLS on, no policies: reachable only with the service role.
create table public.custodial_keys (
  wallet_id uuid primary key references public.wallets (id) on delete cascade,
  ciphertext bytea not null,
  iv bytea not null check (octet_length(iv) = 12),
  auth_tag bytea not null check (octet_length(auth_tag) = 16),
  key_version smallint not null default 1,
  created_at timestamptz not null default now()
);

-- One-time challenges for proving Freighter wallet ownership. Service role only.
create table public.wallet_challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  public_key public.stellar_account not null,
  nonce text not null unique check (char_length(nonce) >= 32),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index wallet_challenges_user on public.wallet_challenges (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Organizers & events
-- ---------------------------------------------------------------------------
create table public.organizers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles (id) on delete cascade,
  name text not null check (char_length(name) between 2 and 80),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 60),
  bio text check (char_length(bio) <= 2000),
  logo_path text check (char_length(logo_path) <= 300),
  city text check (char_length(city) <= 80),
  country char(2) not null default 'ZM' check (country ~ '^[A-Z]{2}$'),
  contact_email extensions.citext,
  contact_phone text check (contact_phone ~ '^\+?[0-9]{7,15}$'),
  payout_public_key public.stellar_account,
  status public.organizer_status not null default 'pending',
  on_chain_approved_at timestamptz,
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  review_note text check (char_length(review_note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index organizers_status on public.organizers (status);
create trigger organizers_updated_at before update on public.organizers
  for each row execute function public.set_updated_at();

create table public.events (
  id uuid primary key default gen_random_uuid(),
  organizer_id uuid not null references public.organizers (id) on delete restrict,
  title text not null check (char_length(title) between 3 and 120),
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 80),
  summary text check (char_length(summary) <= 280),
  description text check (char_length(description) <= 10000),
  category text not null default 'music'
    check (category in ('music', 'comedy', 'arts', 'sports', 'festival', 'conference', 'community', 'nightlife', 'other')),
  cover_path text check (char_length(cover_path) <= 300),
  artist_name text check (char_length(artist_name) <= 120),
  venue_name text not null check (char_length(venue_name) between 2 and 120),
  venue_address text check (char_length(venue_address) <= 240),
  city text not null check (char_length(city) between 2 and 80),
  country char(2) not null default 'ZM' check (country ~ '^[A-Z]{2}$'),
  latitude double precision check (latitude between -90 and 90),
  longitude double precision check (longitude between -180 and 180),
  starts_at timestamptz not null,
  ends_at timestamptz,
  timezone text not null default 'Africa/Lusaka',
  capacity integer not null check (capacity between 1 and 1000000),
  max_transfers integer not null default 1 check (max_transfers between 0 and 100),
  resale_cap_units public.token_units not null default 0,
  -- [{ "recipient": "G...", "bps": 7000, "label": "Organizer" }, ...] — must sum to 10000 (checked by trigger)
  splits jsonb not null default '[]'::jsonb,
  status public.event_status not null default 'draft',
  sales_open boolean not null default true,
  -- chain mirror (service role only)
  chain_event_id bigint unique check (chain_event_id > 0),
  metadata_hash text check (metadata_hash ~ '^[0-9a-f]{64}$'),
  fee_bps integer check (fee_bps between 0 and 2000),
  create_tx_hash public.tx_hash,
  tickets_sold integer not null default 0 check (tickets_sold >= 0),
  checked_in_count integer not null default 0 check (checked_in_count >= 0),
  search tsvector generated always as (
    setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(artist_name, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(venue_name, '') || ' ' || coalesce(city, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(summary, '')), 'C')
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organizer_id, slug),
  check (ends_at is null or ends_at > starts_at),
  check (status <> 'published' or chain_event_id is not null),
  check (tickets_sold <= capacity),
  check (jsonb_typeof(splits) = 'array')
);
create index events_public_listing on public.events (starts_at) where status = 'published';
create index events_organizer on public.events (organizer_id, starts_at desc);
create index events_city on public.events (city, starts_at) where status = 'published';
create index events_search on public.events using gin (search);
create trigger events_updated_at before update on public.events
  for each row execute function public.set_updated_at();

-- Revenue splits mirror the contract rules: 1–5 recipients, positive bps, sum = 10000.
create or replace function public.validate_event_splits()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  n int := jsonb_array_length(new.splits);
  total int := 0;
  s jsonb;
begin
  if n = 0 then
    if new.status = 'published' then
      raise exception 'published events need revenue splits' using errcode = '23514';
    end if;
    return new;
  end if;
  if n > 5 then
    raise exception 'at most 5 revenue split recipients' using errcode = '23514';
  end if;
  for s in select * from jsonb_array_elements(new.splits) loop
    if jsonb_typeof(s -> 'bps') <> 'number' or (s ->> 'bps')::int <= 0
       or coalesce(s ->> 'recipient', '') !~ '^G[A-Z2-7]{55}$' then
      raise exception 'invalid split %', s using errcode = '23514';
    end if;
    total := total + (s ->> 'bps')::int;
  end loop;
  if total <> 10000 then
    raise exception 'revenue splits must sum to 10000 bps (got %)', total using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger events_validate_splits before insert or update of splits, status on public.events
  for each row execute function public.validate_event_splits();

create table public.ticket_tiers (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  chain_tier integer check (chain_tier between 0 and 9),
  name text not null check (char_length(name) between 1 and 60),
  description text check (char_length(description) <= 500),
  price_units public.token_units not null,
  capacity integer not null check (capacity >= 1),
  sold integer not null default 0 check (sold >= 0),
  sort_order smallint not null default 0,
  sales_start_at timestamptz,
  sales_end_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, chain_tier),
  check (sold <= capacity),
  check (sales_end_at is null or sales_start_at is null or sales_end_at > sales_start_at)
);
create index ticket_tiers_event on public.ticket_tiers (event_id, sort_order);
create trigger ticket_tiers_updated_at before update on public.ticket_tiers
  for each row execute function public.set_updated_at();

create table public.event_scanners (
  event_id uuid not null references public.events (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  scanner_public_key public.stellar_account not null,
  enabled boolean not null default true,
  chain_synced_at timestamptz,
  added_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (event_id, user_id)
);
create index event_scanners_user on public.event_scanners (user_id) where enabled;

-- ---------------------------------------------------------------------------
-- Commerce & tickets (written by the server after on-chain confirmation)
-- ---------------------------------------------------------------------------
create table public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete restrict,
  event_id uuid not null references public.events (id) on delete restrict,
  tier_id uuid not null references public.ticket_tiers (id) on delete restrict,
  quantity integer not null default 1 check (quantity between 1 and 10),
  unit_price_units public.token_units not null,
  total_units public.token_units not null,
  currency text not null default 'USDC' check (currency in ('USDC', 'XLM')),
  -- ZMW shown to the buyer at checkout, for receipts (display only)
  display_total_zmw numeric(14, 2),
  payment_method public.payment_method not null,
  status public.order_status not null default 'pending',
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 100),
  payer_public_key public.stellar_account,
  owner_public_key public.stellar_account,
  tx_hash public.tx_hash unique,
  ramp_reference text unique,
  error text check (char_length(error) <= 500),
  expires_at timestamptz not null default now() + interval '15 minutes',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, idempotency_key),
  check (total_units = unit_price_units * quantity)
);
create index orders_user on public.orders (user_id, created_at desc);
create index orders_event on public.orders (event_id, status);
create trigger orders_updated_at before update on public.orders
  for each row execute function public.set_updated_at();

create table public.tickets (
  id uuid primary key default gen_random_uuid(),
  chain_ticket_id bigint not null unique check (chain_ticket_id > 0),
  event_id uuid not null references public.events (id) on delete restrict,
  tier_id uuid not null references public.ticket_tiers (id) on delete restrict,
  order_id uuid references public.orders (id) on delete set null,
  owner_public_key public.stellar_account not null,
  -- resolved from wallets; null when the owner wallet isn't linked to an account
  owner_user_id uuid references public.profiles (id) on delete set null,
  status public.ticket_status not null default 'valid',
  transfers integer not null default 0 check (transfers >= 0),
  checked_in_at timestamptz,
  mint_tx_hash public.tx_hash not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'checked_in') = (checked_in_at is not null))
);
create index tickets_owner on public.tickets (owner_user_id, created_at desc);
create index tickets_owner_key on public.tickets (owner_public_key);
create index tickets_event on public.tickets (event_id, status);
create trigger tickets_updated_at before update on public.tickets
  for each row execute function public.set_updated_at();

create table public.ticket_transfers (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets (id) on delete cascade,
  from_public_key public.stellar_account not null,
  to_public_key public.stellar_account not null,
  from_user_id uuid references public.profiles (id) on delete set null,
  to_user_id uuid references public.profiles (id) on delete set null,
  price_units public.token_units not null default 0,
  tx_hash public.tx_hash not null unique,
  created_at timestamptz not null default now(),
  check (from_public_key <> to_public_key)
);
create index ticket_transfers_ticket on public.ticket_transfers (ticket_id, created_at);

-- Device keys bound into signed QR credentials (Phase 5).
create table public.ticket_credentials (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  device_public_key text not null check (char_length(device_public_key) between 40 and 200),
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  check (expires_at > issued_at)
);
create index ticket_credentials_ticket on public.ticket_credentials (ticket_id, issued_at desc);

-- Door scans, including offline scans synced later. `client_scan_id` makes sync idempotent.
create table public.checkins (
  id uuid primary key default gen_random_uuid(),
  client_scan_id uuid not null unique,
  ticket_id uuid references public.tickets (id) on delete set null,
  event_id uuid not null references public.events (id) on delete cascade,
  scanner_user_id uuid not null references public.profiles (id) on delete restrict,
  device_label text check (char_length(device_label) <= 80),
  scanned_at timestamptz not null,
  received_at timestamptz not null default now(),
  result public.checkin_result not null,
  chain_status public.chain_sync_status,
  tx_hash public.tx_hash unique,
  error text check (char_length(error) <= 500)
);
create index checkins_event on public.checkins (event_id, scanned_at desc);
-- At most one accepted scan per ticket: a second "accepted" insert fails (double entry).
create unique index checkins_one_accepted on public.checkins (ticket_id) where result = 'accepted';

-- ---------------------------------------------------------------------------
-- Rewards (mirror of the BY Points token + badge contracts)
-- ---------------------------------------------------------------------------
create table public.points_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles (id) on delete set null,
  public_key public.stellar_account not null,
  -- positive = minted, negative = burned/redeemed
  amount_units numeric(39, 0) not null check (amount_units <> 0),
  reason text not null check (reason in ('purchase', 'attend', 'promo', 'redeem', 'burn')),
  ticket_id uuid references public.tickets (id) on delete set null,
  tx_hash public.tx_hash not null,
  created_at timestamptz not null default now(),
  -- one contract call can emit several ledger effects (e.g. points for two tickets)
  unique nulls not distinct (tx_hash, public_key, reason, ticket_id)
);
create index points_ledger_user on public.points_ledger (user_id, created_at desc);

create table public.badges (
  id uuid primary key default gen_random_uuid(),
  chain_badge_id bigint not null unique check (chain_badge_id > 0),
  event_id uuid not null references public.events (id) on delete restrict,
  public_key public.stellar_account not null,
  user_id uuid references public.profiles (id) on delete set null,
  tx_hash public.tx_hash not null,
  minted_at timestamptz not null default now(),
  unique (event_id, public_key)
);
create index badges_user on public.badges (user_id, minted_at desc);

create table public.perks (
  id uuid primary key default gen_random_uuid(),
  chain_perk_id integer unique check (chain_perk_id >= 0),
  title text not null check (char_length(title) between 2 and 80),
  description text check (char_length(description) <= 500),
  sponsor_name text not null check (char_length(sponsor_name) between 2 and 80),
  sponsor_user_id uuid references public.profiles (id) on delete set null,
  event_id uuid references public.events (id) on delete cascade,
  cost_units public.token_units not null check (cost_units > 0),
  stock integer check (stock >= 0),
  image_path text check (char_length(image_path) <= 300),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger perks_updated_at before update on public.perks
  for each row execute function public.set_updated_at();

create table public.redemptions (
  id uuid primary key default gen_random_uuid(),
  perk_id uuid not null references public.perks (id) on delete restrict,
  user_id uuid not null references public.profiles (id) on delete restrict,
  chain_redemption_id bigint unique,
  -- short code the vendor sees/scans at the venue
  code text not null unique check (code ~ '^[A-Z0-9]{8}$'),
  status public.redemption_status not null default 'pending',
  tx_hash public.tx_hash unique,
  created_at timestamptz not null default now(),
  fulfilled_at timestamptz
);
create index redemptions_user on public.redemptions (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Platform
-- ---------------------------------------------------------------------------
create table public.platform_settings (
  key text primary key check (key ~ '^[a-z][a-z0-9_]{1,62}$'),
  value jsonb not null,
  is_public boolean not null default false,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into public.platform_settings (key, value, is_public) values
  ('platform_fee_bps', '250', true),
  ('zmw_per_usdc', '26.5', true),
  ('organizer_auto_approve', 'false', false);

create table public.audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles (id) on delete set null,
  action text not null check (char_length(action) <= 80),
  entity text not null check (char_length(entity) <= 40),
  entity_id text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_log_entity on public.audit_log (entity, entity_id, created_at desc);

-- Chain indexer cursor per contract (service role only).
create table public.chain_cursors (
  contract_id public.stellar_contract primary key,
  last_ledger bigint not null default 0,
  paging_token text,
  updated_at timestamptz not null default now()
);

-- Generic idempotency store for mutating API routes (service role only).
create table public.idempotency_keys (
  user_id uuid not null references public.profiles (id) on delete cascade,
  key text not null check (char_length(key) between 8 and 100),
  route text not null,
  request_hash text not null,
  response jsonb,
  status_code smallint,
  created_at timestamptz not null default now(),
  primary key (user_id, key)
);
