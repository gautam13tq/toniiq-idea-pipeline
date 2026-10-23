-- Category Atlas v4 scoring fields
-- Category Atlas scores must be produced by exact-query Keepa Stage A scoring,
-- not by static category-spreadsheet heuristics.

alter table public.category_atlas_entries
  add column if not exists primary_keyword text,
  add column if not exists score_status text not null default 'pending_v4'
    check (score_status in ('pending_v4', 'scoring', 'scored', 'failed')),
  add column if not exists score_run_id uuid,
  add column if not exists lens text
    check (lens is null or lens in ('launch_wedge', 'niche_root', 'anomalous_growth')),
  add column if not exists attackability numeric,
  add column if not exists review_moat numeric,
  add column if not exists result_quality numeric,
  add column if not exists best_bsr numeric,
  add column if not exists review_p50 numeric,
  add column if not exists exact_competitor_count integer,
  add column if not exists competition_gate jsonb not null default '{}'::jsonb,
  add column if not exists competitive_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists filter_drops text[] not null default '{}',
  add column if not exists score_error text,
  add column if not exists scored_at timestamptz;

create table if not exists public.category_atlas_score_runs (
  id uuid primary key default gen_random_uuid(),
  import_id uuid references public.category_atlas_imports(id) on delete cascade,
  scoring_version text not null default 'category-atlas-v4-keepa-stage-a',
  status text not null default 'running' check (status in ('running', 'completed', 'failed')),
  requested_entry_count integer not null default 0,
  scored_entry_count integer not null default 0,
  failed_entry_count integer not null default 0,
  keepa_tokens_consumed integer not null default 0,
  error text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

alter table public.category_atlas_score_runs enable row level security;

drop policy if exists "Authenticated users can read category atlas score runs" on public.category_atlas_score_runs;
create policy "Authenticated users can read category atlas score runs"
  on public.category_atlas_score_runs for select to authenticated using (true);

drop policy if exists "Authenticated users can write category atlas score runs" on public.category_atlas_score_runs;
create policy "Authenticated users can write category atlas score runs"
  on public.category_atlas_score_runs for all to authenticated
  using (true)
  with check (true);

grant select, insert, update, delete on table public.category_atlas_score_runs to authenticated;

create index if not exists category_atlas_entries_score_status_idx
  on public.category_atlas_entries(import_id, score_status, strategic_score desc);

create index if not exists category_atlas_entries_attackability_idx
  on public.category_atlas_entries(import_id, attackability desc)
  where score_status = 'scored';

create index if not exists category_atlas_score_runs_import_idx
  on public.category_atlas_score_runs(import_id, created_at desc);

comment on column public.category_atlas_entries.strategic_score is
  '0-100 v4 score produced only after exact primary_keyword Keepa Stage A enrichment: exact competitive set, review moat, attackability, growth/timing, specificity, and competition gates.';

comment on column public.category_atlas_entries.primary_keyword is
  'Exact launch/search keyword used for Keepa Stage A scoring, e.g. liposomal berberine. Must not fall back to parent market if the Category Atlas entry is a modified product space.';

comment on column public.category_atlas_entries.score_status is
  'pending_v4 until exact-query Keepa Stage A scoring completes. Category Atlas import heuristics must not be treated as a score.';

-- Existing Category Atlas rows were initially imported with static category-file
-- scores. Those are useful as source audit fields, but must not appear as final
-- opportunity scores. Reset anything not explicitly produced by the v4 scorer.
update public.category_atlas_entries
set
  primary_keyword = coalesce(
    nullif(primary_keyword, ''),
    case
      when category_id = 'liposomal' and coalesce(best_keyword, '') not ilike '%liposomal%'
        then trim(concat('liposomal ', name))
      else nullif(best_keyword, '')
    end,
    name
  ),
  score_status = 'pending_v4',
  strategic_score = null,
  recommendation_label = null,
  score_confidence = null,
  pillar_scores = '{}'::jsonb,
  computed_signals = jsonb_build_object(
    'scoring_version', 'category-atlas-v4-keepa-stage-a',
    'score_status', 'pending_v4',
    'primary_keyword', coalesce(
      nullif(primary_keyword, ''),
      case
        when category_id = 'liposomal' and coalesce(best_keyword, '') not ilike '%liposomal%'
          then trim(concat('liposomal ', name))
        else nullif(best_keyword, '')
      end,
      name
    ),
    'source_category_score', strategic_score
  ),
  scoring_notes = 'Pending category-atlas-v4-keepa-stage-a. This row is not scored until exact primary-keyword Keepa Stage A scoring is complete.',
  score_error = null,
  scored_at = null
where coalesce(computed_signals->>'scoring_version', '') <> 'category-atlas-v4-keepa-stage-a';
