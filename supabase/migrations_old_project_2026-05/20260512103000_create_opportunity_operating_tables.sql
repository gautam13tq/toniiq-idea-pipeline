create table if not exists public.opportunity_reviews (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.idea_candidates(id) on delete cascade,
  source text not null default 'poe' check (source in ('poe', 'manual', 'llm', 'codex', 'claude')),
  status text not null default 'new' check (status in ('new', 'reviewing', 'watching', 'queued_research', 'researching', 'parked', 'dismissed', 'promoted')),
  priority text not null default 'medium' check (priority in ('urgent', 'high', 'medium', 'low')),
  signal_type text not null default 'unclassified',
  signal_tags text[] not null default '{}',
  toniiq_fit_score integer check (toniiq_fit_score between 0 and 100),
  confidence text check (confidence in ('high', 'medium', 'low')),
  rationale text,
  next_action text,
  decision_notes text,
  source_context text,
  initial_hypothesis text,
  urgency text,
  reviewed_at timestamptz,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (candidate_id)
);

create index if not exists opportunity_reviews_status_priority_idx
  on public.opportunity_reviews (status, priority, created_at desc);

create index if not exists opportunity_reviews_candidate_id_idx
  on public.opportunity_reviews (candidate_id);

create table if not exists public.llm_recommendations (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('idea', 'concept', 'product', 'market_niche')),
  entity_id uuid,
  source text not null default 'llm',
  priority text not null default 'medium' check (priority in ('urgent', 'high', 'medium', 'low')),
  title text not null,
  recommendation text not null,
  rationale text,
  evidence_refs jsonb not null default '[]'::jsonb,
  confidence text check (confidence in ('high', 'medium', 'low')),
  next_action text,
  status text not null default 'open' check (status in ('open', 'accepted', 'dismissed', 'stale')),
  created_by uuid default auth.uid(),
  accepted_at timestamptz,
  dismissed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists llm_recommendations_status_priority_idx
  on public.llm_recommendations (status, priority, created_at desc);

create index if not exists llm_recommendations_entity_idx
  on public.llm_recommendations (entity_type, entity_id);

create table if not exists public.work_sessions (
  id uuid primary key default gen_random_uuid(),
  session_date date not null default current_date,
  focus text not null default 'product_development',
  status text not null default 'planned' check (status in ('planned', 'active', 'completed', 'abandoned')),
  intended_minutes integer,
  selected_items jsonb not null default '[]'::jsonb,
  notes text,
  outcomes text,
  next_session_recommendations text,
  created_by uuid default auth.uid(),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists work_sessions_date_status_idx
  on public.work_sessions (session_date desc, status);

create or replace function public.touch_opportunity_operating_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists touch_opportunity_reviews_updated_at on public.opportunity_reviews;
create trigger touch_opportunity_reviews_updated_at
before update on public.opportunity_reviews
for each row execute function public.touch_opportunity_operating_updated_at();

drop trigger if exists touch_llm_recommendations_updated_at on public.llm_recommendations;
create trigger touch_llm_recommendations_updated_at
before update on public.llm_recommendations
for each row execute function public.touch_opportunity_operating_updated_at();

drop trigger if exists touch_work_sessions_updated_at on public.work_sessions;
create trigger touch_work_sessions_updated_at
before update on public.work_sessions
for each row execute function public.touch_opportunity_operating_updated_at();

alter table public.opportunity_reviews enable row level security;
alter table public.llm_recommendations enable row level security;
alter table public.work_sessions enable row level security;

drop policy if exists "Authenticated users can read opportunity reviews" on public.opportunity_reviews;
create policy "Authenticated users can read opportunity reviews"
  on public.opportunity_reviews for select to authenticated
  using (auth.role() = 'authenticated');

drop policy if exists "Authenticated users can insert opportunity reviews" on public.opportunity_reviews;
create policy "Authenticated users can insert opportunity reviews"
  on public.opportunity_reviews for insert to authenticated
  with check (auth.role() = 'authenticated');

drop policy if exists "Authenticated users can update opportunity reviews" on public.opportunity_reviews;
create policy "Authenticated users can update opportunity reviews"
  on public.opportunity_reviews for update to authenticated
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

drop policy if exists "Authenticated users can read llm recommendations" on public.llm_recommendations;
create policy "Authenticated users can read llm recommendations"
  on public.llm_recommendations for select to authenticated
  using (auth.role() = 'authenticated');

drop policy if exists "Authenticated users can insert llm recommendations" on public.llm_recommendations;
create policy "Authenticated users can insert llm recommendations"
  on public.llm_recommendations for insert to authenticated
  with check (auth.role() = 'authenticated');

drop policy if exists "Authenticated users can update llm recommendations" on public.llm_recommendations;
create policy "Authenticated users can update llm recommendations"
  on public.llm_recommendations for update to authenticated
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

drop policy if exists "Authenticated users can read work sessions" on public.work_sessions;
create policy "Authenticated users can read work sessions"
  on public.work_sessions for select to authenticated
  using (auth.role() = 'authenticated');

drop policy if exists "Authenticated users can insert work sessions" on public.work_sessions;
create policy "Authenticated users can insert work sessions"
  on public.work_sessions for insert to authenticated
  with check (auth.role() = 'authenticated');

drop policy if exists "Authenticated users can update work sessions" on public.work_sessions;
create policy "Authenticated users can update work sessions"
  on public.work_sessions for update to authenticated
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

revoke all on table public.opportunity_reviews from anon;
revoke all on table public.llm_recommendations from anon;
revoke all on table public.work_sessions from anon;

grant select, insert, update on table public.opportunity_reviews to authenticated;
grant select, insert, update on table public.llm_recommendations to authenticated;
grant select, insert, update on table public.work_sessions to authenticated;
