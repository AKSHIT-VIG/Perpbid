-- perpbid schema (Postgres 14+ / Supabase)

create table if not exists listings (
  id            bigserial primary key,
  code          text        not null,
  platform      text        not null,
  url           text        not null,
  description   text        default '',
  amount_cents  integer     not null default 0,   -- cumulative confirmed bids
  clicks        integer     not null default 0,   -- deduped clicks (1h/IP)
  last_bid_at   timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  active        boolean     not null default false -- flips true on first confirmed bid
);
create index if not exists listings_amount_idx on listings (amount_cents desc) where active = true;
create index if not exists listings_active_idx on listings (active);

create table if not exists bids (
  id              uuid primary key default gen_random_uuid(),
  listing_id      bigint      not null references listings(id) on delete cascade,
  wallet_address  text        not null,
  amount_cents    integer     not null check (amount_cents > 0),
  bid_id_hex      text        not null unique,   -- bytes32 nonce sent to contract
  tx_hash         text        unique,
  block_number    bigint,
  status          text        not null default 'pending', -- pending | confirmed | expired
  created_at      timestamptz not null default now(),
  confirmed_at    timestamptz
);
create index if not exists bids_listing_idx on bids (listing_id, status);
create index if not exists bids_status_idx  on bids (status, created_at);

create table if not exists clicks (
  id          bigserial primary key,
  listing_id  bigint      not null references listings(id) on delete cascade,
  ip_hash     text        not null,
  user_agent  text        default '',
  created_at  timestamptz not null default now()
);
create index if not exists clicks_listing_time_idx on clicks (listing_id, created_at desc);
create index if not exists clicks_time_idx on clicks (created_at desc);

-- Atomic: log a click, and increment listing.clicks only if this IP hasn't
-- clicked this listing in the past hour.
create or replace function log_click_and_bump(
  p_listing_id bigint,
  p_ip_hash    text,
  p_user_agent text
) returns void as $$
declare
  already_clicked boolean;
begin
  select exists (
    select 1 from clicks
    where listing_id = p_listing_id
      and ip_hash = p_ip_hash
      and created_at > now() - interval '1 hour'
  ) into already_clicked;

  insert into clicks (listing_id, ip_hash, user_agent)
    values (p_listing_id, p_ip_hash, p_user_agent);

  if not already_clicked then
    update listings set clicks = clicks + 1 where id = p_listing_id;
  end if;
end;
$$ language plpgsql;

-- Atomic: promote a bid to confirmed and bump the parent listing's total.
-- Idempotent — safe to call twice with the same bid_id_hex.
create or replace function confirm_bid(
  p_bid_id_hex   text,
  p_tx_hash      text,
  p_block_number bigint
) returns table (listing_id bigint, new_amount_cents integer) as $$
declare
  v_bid   bids%rowtype;
  v_new   integer;
begin
  select * into v_bid from bids where bid_id_hex = p_bid_id_hex for update;
  if not found then
    raise exception 'bid not found: %', p_bid_id_hex;
  end if;

  if v_bid.status = 'confirmed' then
    select amount_cents into v_new from listings where id = v_bid.listing_id;
    return query select v_bid.listing_id, v_new;
    return;
  end if;

  update bids set
    status = 'confirmed',
    tx_hash = p_tx_hash,
    block_number = p_block_number,
    confirmed_at = now()
  where bid_id_hex = p_bid_id_hex;

  update listings set
    amount_cents = amount_cents + v_bid.amount_cents,
    last_bid_at = now(),
    active = true
  where id = v_bid.listing_id
  returning amount_cents into v_new;

  return query select v_bid.listing_id, v_new;
end;
$$ language plpgsql;
