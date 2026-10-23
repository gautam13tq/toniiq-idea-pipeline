create table if not exists public.market_curation_runs (
  id uuid primary key default gen_random_uuid(),
  import_date date not null,
  status text not null default 'running' check (status in ('running', 'completed', 'failed')),
  model text not null default 'claude-opus-4-5',
  prompt_version text not null default 'market-curation-v1',
  total_rows integer not null default 0,
  candidate_rows integer not null default 0,
  clusters_considered integer not null default 0,
  picks_count integer not null default 0,
  token_usage jsonb not null default '{}'::jsonb,
  summary text,
  error text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists market_curation_runs_import_date_idx
  on public.market_curation_runs (import_date desc, created_at desc);

create index if not exists market_curation_runs_status_idx
  on public.market_curation_runs (status, created_at desc);

create table if not exists public.market_curation_picks (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.market_curation_runs(id) on delete cascade,
  candidate_id uuid references public.idea_candidates(id) on delete set null,
  cluster_key text,
  cluster_name text,
  idea_title text not null,
  rank integer not null,
  recommendation_label text not null default 'watchlist'
    check (recommendation_label in ('launch_priority', 'strong_candidate', 'watchlist', 'pass')),
  strategic_score integer check (strategic_score between 0 and 100),
  pillar_scores jsonb not null default '{}'::jsonb,
  thesis text,
  evidence_refs jsonb not null default '[]'::jsonb,
  risks jsonb not null default '[]'::jsonb,
  duplicate_status text,
  status_flags jsonb not null default '{}'::jsonb,
  next_action text,
  feedback_rating text check (feedback_rating in ('strong_yes', 'yes', 'maybe', 'no', 'strong_no')),
  feedback_notes text,
  feedback_at timestamptz,
  promoted_review_id uuid references public.opportunity_reviews(id) on delete set null,
  dismissed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (run_id, rank)
);

create index if not exists market_curation_picks_run_rank_idx
  on public.market_curation_picks (run_id, rank);

create index if not exists market_curation_picks_candidate_idx
  on public.market_curation_picks (candidate_id);

create or replace function public.touch_market_curation_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists touch_market_curation_runs_updated_at on public.market_curation_runs;
create trigger touch_market_curation_runs_updated_at
before update on public.market_curation_runs
for each row execute function public.touch_market_curation_updated_at();

drop trigger if exists touch_market_curation_picks_updated_at on public.market_curation_picks;
create trigger touch_market_curation_picks_updated_at
before update on public.market_curation_picks
for each row execute function public.touch_market_curation_updated_at();

alter table public.market_curation_runs enable row level security;
alter table public.market_curation_picks enable row level security;

drop policy if exists "Authenticated users can read market curation runs" on public.market_curation_runs;
create policy "Authenticated users can read market curation runs"
  on public.market_curation_runs for select to authenticated
  using (auth.role() = 'authenticated');

drop policy if exists "Authenticated users can insert market curation runs" on public.market_curation_runs;
create policy "Authenticated users can insert market curation runs"
  on public.market_curation_runs for insert to authenticated
  with check (auth.role() = 'authenticated');

drop policy if exists "Authenticated users can update market curation runs" on public.market_curation_runs;
create policy "Authenticated users can update market curation runs"
  on public.market_curation_runs for update to authenticated
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

drop policy if exists "Authenticated users can read market curation picks" on public.market_curation_picks;
create policy "Authenticated users can read market curation picks"
  on public.market_curation_picks for select to authenticated
  using (auth.role() = 'authenticated');

drop policy if exists "Authenticated users can insert market curation picks" on public.market_curation_picks;
create policy "Authenticated users can insert market curation picks"
  on public.market_curation_picks for insert to authenticated
  with check (auth.role() = 'authenticated');

drop policy if exists "Authenticated users can update market curation picks" on public.market_curation_picks;
create policy "Authenticated users can update market curation picks"
  on public.market_curation_picks for update to authenticated
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

revoke all on table public.market_curation_runs from anon;
revoke all on table public.market_curation_picks from anon;

grant select, insert, update on table public.market_curation_runs to authenticated;
grant select, insert, update on table public.market_curation_picks to authenticated;
