-- Category Atlas v2 hybrid/niche-specific rollout
-- Preserves older imports while allowing the latest import to split broad
-- families into launchable/searchable niches and store full hybrid competitor
-- audit sets.

alter table public.category_atlas_entries
  drop constraint if exists category_atlas_entries_score_status_check;

alter table public.category_atlas_entries
  add constraint category_atlas_entries_score_status_check
  check (score_status in ('pending_v4', 'pending_hybrid', 'scoring', 'hybrid_scoring', 'scored', 'hybrid_scored', 'failed', 'audit_failed', 'not_scored'));

alter table public.category_atlas_entries
  add column if not exists parent_family text,
  add column if not exists atlas_role text not null default 'scored_niche'
    check (atlas_role in ('scored_niche', 'parent_family', 'sibling_niche', 'do_not_score')),
  add column if not exists niche_type text,
  add column if not exists query_packet jsonb not null default '[]'::jsonb,
  add column if not exists competitive_frame jsonb not null default '{}'::jsonb,
  add column if not exists scoring_method text,
  add column if not exists specificity_notes text,
  add column if not exists source_entry_key text,
  add column if not exists source_categories text[] not null default '{}';

update public.category_atlas_entries
set
  parent_family = coalesce(parent_family, name),
  atlas_role = coalesce(atlas_role, 'scored_niche'),
  scoring_method = coalesce(scoring_method, 'category-atlas-v4-keepa-stage-a'),
  source_entry_key = coalesce(source_entry_key, entry_key),
  source_categories = case when source_categories = '{}'::text[] then array[category_id] else source_categories end
where parent_family is null
   or scoring_method is null
   or source_entry_key is null
   or source_categories = '{}'::text[];

create table if not exists public.category_atlas_competitors (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references public.category_atlas_imports(id) on delete cascade,
  entry_id uuid not null references public.category_atlas_entries(id) on delete cascade,
  score_run_id uuid references public.category_atlas_score_runs(id) on delete set null,
  bucket text not null check (bucket in ('included', 'adjacent', 'excluded')),
  lane_fit text,
  rank integer not null default 0,
  asin text,
  parent_asin text,
  brand text,
  title text,
  amazon_url text,
  price numeric,
  rating numeric,
  reviews integer,
  monthly_sold integer,
  bsr_current numeric,
  bsr_avg30 numeric,
  bsr_avg90 numeric,
  discovery_query text,
  discovery_rank integer,
  reason text,
  source_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.category_atlas_competitors enable row level security;

drop policy if exists "Authenticated users can read category atlas competitors" on public.category_atlas_competitors;
create policy "Authenticated users can read category atlas competitors"
  on public.category_atlas_competitors for select to authenticated using (true);

drop policy if exists "Authenticated users can write category atlas competitors" on public.category_atlas_competitors;
create policy "Authenticated users can write category atlas competitors"
  on public.category_atlas_competitors for all to authenticated
  using (true)
  with check (true);

grant select, insert, update, delete on table public.category_atlas_competitors to authenticated;

create index if not exists category_atlas_competitors_entry_bucket_idx
  on public.category_atlas_competitors(entry_id, bucket, rank);

create index if not exists category_atlas_competitors_import_idx
  on public.category_atlas_competitors(import_id, entry_id);

create index if not exists category_atlas_entries_family_idx
  on public.category_atlas_entries(import_id, parent_family, atlas_role);

drop index if exists category_atlas_entries_attackability_idx;
create index category_atlas_entries_attackability_idx
  on public.category_atlas_entries(import_id, attackability desc)
  where score_status in ('scored', 'hybrid_scored');

comment on column public.category_atlas_entries.atlas_role is
  'scored_niche rows are launchable/searchable opportunities. parent_family rows are strategic rollups only and must not be scored or promoted.';

comment on column public.category_atlas_entries.query_packet is
  'Buyer-intent Amazon query packet used for hybrid Apify discovery before Keepa ASIN enrichment.';

comment on column public.category_atlas_entries.score_status is
  'Category Atlas scoring state. v2 uses pending_hybrid -> hybrid_scoring -> hybrid_scored; parent family rows use not_scored.';

comment on column public.category_atlas_entries.primary_keyword is
  'Exact launch/search keyword used for hybrid scoring, e.g. liposomal berberine or berberine phytosome. Parent-market fallback is not allowed for scored niche rows.';

comment on table public.category_atlas_competitors is
  'Full hybrid competitive landscape audit generated from Apify discovery plus Keepa ASIN enrichment. Included competitors drive scoring; adjacent/excluded rows remain visible for audit.';
