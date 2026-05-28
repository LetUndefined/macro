-- Macro Scorecard — Supabase Schema
-- Run this in your Supabase SQL Editor

create table if not exists macro_readings (
  id               uuid primary key default gen_random_uuid(),
  currency         text not null,
  central_bank     text not null,
  cb_target        numeric not null,
  core_cpi         numeric,
  core_cpi_prev    numeric,
  headline_cpi     numeric,
  unemployment     numeric,
  unemployment_prev numeric,
  signal           text not null check (signal in ('overheating','elevated','easing','deflationary')),
  cpi_trend        text not null default 'flat' check (cpi_trend in ('rising','falling','flat')),
  labour_trend     text not null default 'flat' check (labour_trend in ('tightening','softening','flat')),
  context          text,
  snapshot_date    date not null default current_date,
  updated_at       timestamptz default now(),
  unique(currency, snapshot_date)
);

create table if not exists macro_pairs (
  id                  uuid primary key default gen_random_uuid(),
  pair                text not null,
  base_currency       text not null,
  quote_currency      text not null,
  base_signal         text not null,
  quote_signal        text not null,
  direction           text not null check (direction in ('long','short')),
  divergence_strength text not null check (divergence_strength in ('strong','moderate')),
  snapshot_date       date not null default current_date,
  updated_at          timestamptz default now(),
  unique(pair, snapshot_date)
);

-- Row-level security (open access, same pattern as existing tables)
alter table macro_readings enable row level security;
alter table macro_pairs    enable row level security;

create policy "Allow all reads on macro_readings"
  on macro_readings for select using (true);

create policy "Allow all inserts on macro_readings"
  on macro_readings for insert with check (true);

create policy "Allow all updates on macro_readings"
  on macro_readings for update using (true);

create policy "Allow all reads on macro_pairs"
  on macro_pairs for select using (true);

create policy "Allow all inserts on macro_pairs"
  on macro_pairs for insert with check (true);

create policy "Allow all updates on macro_pairs"
  on macro_pairs for update using (true);
