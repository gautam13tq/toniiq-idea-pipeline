-- Category Atlas v1
-- Integrates local category-first atlas outputs into an isolated app layer.
-- Rows are promoted into the main idea pipeline only when explicitly added to
-- opportunity_reviews.

create table if not exists public.category_atlas_categories (
  id text primary key,
  label text not null,
  description text,
  source_folder text,
  sort_order integer not null default 100,
  status text not null default 'active' check (status in ('active', 'paused', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.category_atlas_imports (
  id uuid primary key default gen_random_uuid(),
  import_key text not null unique,
  source_version text not null,
  scoring_version text not null,
  source_paths jsonb not null default '{}'::jsonb,
  category_count integer not null default 0,
  entry_count integer not null default 0,
  evidence_count integer not null default 0,
  status text not null default 'completed' check (status in ('running', 'completed', 'failed')),
  notes text,
  generated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.category_atlas_entries (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references public.category_atlas_imports(id) on delete cascade,
  category_id text not null references public.category_atlas_categories(id) on delete restrict,
  entry_key text not null,
  name text not null,
  normalized_name text not null,
  tier text,
  mechanism_lane text,
  route_or_format text,
  latest_clicks numeric,
  latest_sales numeric,
  weighted_conversion_pct numeric,
  best_keyword text,
  best_keyword_clicks numeric,
  best_keyword_sales numeric,
  best_keyword_cvr numeric,
  best_keyword_growth numeric,
  strategic_score integer check (strategic_score is null or strategic_score between 0 and 100),
  recommendation_label text check (recommendation_label is null or recommendation_label in ('launch_priority', 'strong_candidate', 'watchlist', 'pass')),
  score_confidence text check (score_confidence is null or score_confidence in ('high', 'medium', 'low')),
  pillar_scores jsonb not null default '{}'::jsonb,
  computed_signals jsonb not null default '{}'::jsonb,
  scoring_notes text,
  toniiq_status text,
  supplier_status text,
  risk_level text check (risk_level is null or risk_level in ('low', 'medium', 'high')),
  risk_notes text,
  strategic_read text,
  next_action text,
  source_payload jsonb not null default '{}'::jsonb,
  promoted_review_id uuid references public.opportunity_reviews(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (import_id, category_id, entry_key)
);

create table if not exists public.category_atlas_keyword_evidence (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references public.category_atlas_imports(id) on delete cascade,
  entry_id uuid references public.category_atlas_entries(id) on delete cascade,
  category_id text not null references public.category_atlas_categories(id) on delete restrict,
  entry_key text not null,
  keyword text not null,
  term_type text,
  latest_month date,
  clicks numeric,
  sales numeric,
  conversion_rate_pct numeric,
  growth_pct numeric,
  has_data boolean not null default false,
  source_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists category_atlas_entries_import_score_idx
  on public.category_atlas_entries(import_id, strategic_score desc);

create index if not exists category_atlas_entries_category_score_idx
  on public.category_atlas_entries(category_id, strategic_score desc);

create index if not exists category_atlas_entries_promoted_idx
  on public.category_atlas_entries(promoted_review_id)
  where promoted_review_id is not null;

create index if not exists category_atlas_keyword_entry_idx
  on public.category_atlas_keyword_evidence(entry_id);

create index if not exists category_atlas_keyword_import_entry_idx
  on public.category_atlas_keyword_evidence(import_id, category_id, entry_key);

create or replace function public.touch_category_atlas_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists touch_category_atlas_categories_updated_at on public.category_atlas_categories;
create trigger touch_category_atlas_categories_updated_at
before update on public.category_atlas_categories
for each row execute function public.touch_category_atlas_updated_at();

drop trigger if exists touch_category_atlas_imports_updated_at on public.category_atlas_imports;
create trigger touch_category_atlas_imports_updated_at
before update on public.category_atlas_imports
for each row execute function public.touch_category_atlas_updated_at();

drop trigger if exists touch_category_atlas_entries_updated_at on public.category_atlas_entries;
create trigger touch_category_atlas_entries_updated_at
before update on public.category_atlas_entries
for each row execute function public.touch_category_atlas_updated_at();

alter table public.category_atlas_categories enable row level security;
alter table public.category_atlas_imports enable row level security;
alter table public.category_atlas_entries enable row level security;
alter table public.category_atlas_keyword_evidence enable row level security;

drop policy if exists "Authenticated users can read category atlas categories" on public.category_atlas_categories;
create policy "Authenticated users can read category atlas categories"
  on public.category_atlas_categories for select to authenticated using (true);

drop policy if exists "Authenticated users can write category atlas categories" on public.category_atlas_categories;
create policy "Authenticated users can write category atlas categories"
  on public.category_atlas_categories for all to authenticated
  using (true)
  with check (true);

drop policy if exists "Authenticated users can read category atlas imports" on public.category_atlas_imports;
create policy "Authenticated users can read category atlas imports"
  on public.category_atlas_imports for select to authenticated using (true);

drop policy if exists "Authenticated users can write category atlas imports" on public.category_atlas_imports;
create policy "Authenticated users can write category atlas imports"
  on public.category_atlas_imports for all to authenticated
  using (true)
  with check (true);

drop policy if exists "Authenticated users can read category atlas entries" on public.category_atlas_entries;
create policy "Authenticated users can read category atlas entries"
  on public.category_atlas_entries for select to authenticated using (true);

drop policy if exists "Authenticated users can write category atlas entries" on public.category_atlas_entries;
create policy "Authenticated users can write category atlas entries"
  on public.category_atlas_entries for all to authenticated
  using (true)
  with check (true);

drop policy if exists "Authenticated users can read category atlas keyword evidence" on public.category_atlas_keyword_evidence;
create policy "Authenticated users can read category atlas keyword evidence"
  on public.category_atlas_keyword_evidence for select to authenticated using (true);

drop policy if exists "Authenticated users can write category atlas keyword evidence" on public.category_atlas_keyword_evidence;
create policy "Authenticated users can write category atlas keyword evidence"
  on public.category_atlas_keyword_evidence for all to authenticated
  using (true)
  with check (true);

revoke all on table public.category_atlas_categories from anon;
revoke all on table public.category_atlas_imports from anon;
revoke all on table public.category_atlas_entries from anon;
revoke all on table public.category_atlas_keyword_evidence from anon;

grant select, insert, update, delete on table public.category_atlas_categories to authenticated;
grant select, insert, update, delete on table public.category_atlas_imports to authenticated;
grant select, insert, update, delete on table public.category_atlas_entries to authenticated;
grant select, insert, update, delete on table public.category_atlas_keyword_evidence to authenticated;

-- Opportunity Queue can now receive explicit promotions from Category Atlas.
alter table public.opportunity_reviews
  drop constraint if exists opportunity_reviews_source_check;

alter table public.opportunity_reviews
  add constraint opportunity_reviews_source_check
  check (source in ('poe', 'manual', 'llm', 'codex', 'claude', 'category_atlas'));

comment on table public.category_atlas_entries is
  'Normalized, scored rows from the local category-first atlas outputs. These are strategic hypotheses and do not become pipeline ideas unless promoted to opportunity_reviews.';

comment on column public.category_atlas_entries.strategic_score is
  '0-100 score using the Market Atlas strategic scoring model: Market Size & Intent 20%, Early Market Access 25%, Growth & Timing 20%, Toniiq Differentiation Hypothesis 35%.';
