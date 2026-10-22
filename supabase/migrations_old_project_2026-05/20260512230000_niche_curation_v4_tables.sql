-- Migration: niche_curation_v4_tables
-- Date: 2026-05-12 (evening)
-- Purpose: Add per-query competitive enrichment + every-candidate debug table
--          + extend market_curation_picks for v4 audit trail.
--
-- Spec: Documents/Outputs/2026-05-12_niche-curation-v4-spec.html (Rev 3)
-- Project: Toniiq/Product Development/PROJECT_niche_curation_v4.md
-- Warehouse log: Toniiq/Data Warehouse/ARCHITECTURE.md (Last changes 2026-05-12 evening)

-- =============================================================================
-- 1. poe_competitive_enrichments
-- =============================================================================
-- One row per (poe_snapshot_id, query_type) pair. A single POE row produces
-- 1-4 enrichment rows (one for customer_need, one per non-null top_search_term).
-- Populated by the poe-enrich-competitive Edge Function.

CREATE TABLE IF NOT EXISTS public.poe_competitive_enrichments (
  id                       uuid primary key default gen_random_uuid(),
  poe_snapshot_id          uuid not null references public.poe_snapshots(id) on delete cascade,
  query                    text not null,
  query_type               text not null
    check (query_type in ('customer_need', 'top_term_1', 'top_term_2', 'top_term_3')),

  enriched_at              timestamptz not null default now(),

  -- Raw source response for audit. Keepa rows store enriched top ASINs;
  -- aggregates below are computed from the scored top results.
  top_results              jsonb not null default '[]'::jsonb,

  -- Aggregates from scored top results (Keepa: rank by BSR/current demand, not search position)
  review_p50               numeric,
  review_p90               numeric,
  review_max               numeric,
  rating_p50               numeric,
  rating_p90               numeric,
  price_p50                numeric,
  sales_top3_share         numeric,    -- fraction 0-1
  distinct_brands          integer,

  -- Quality / debug
  result_count             integer,    -- how many scored source results came back
  confidence               text check (confidence in ('high', 'low')),
  -- confidence = 'low' if result_count < 10 OR source signal coverage is thin

  apify_cost_usd           numeric,
  apify_run_id             text,
  error                    text,       -- non-null if the source errored or returned nothing

  created_at               timestamptz not null default now()
);

CREATE UNIQUE INDEX idx_enrich_poe_query
  ON public.poe_competitive_enrichments(poe_snapshot_id, query_type);
CREATE INDEX idx_enrich_date
  ON public.poe_competitive_enrichments(enriched_at);
CREATE INDEX idx_enrich_confidence
  ON public.poe_competitive_enrichments(confidence) WHERE confidence = 'low';

ALTER TABLE public.poe_competitive_enrichments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "poe_enrichments_auth_read"
  ON public.poe_competitive_enrichments
  FOR SELECT TO authenticated USING (true);

COMMENT ON TABLE public.poe_competitive_enrichments IS
  'Competitive enrichment per POE query (customer_need + each top_search_term). Populated by poe-enrich-competitive Edge Function. One row per (poe_snapshot_id, query_type). Current source is Keepa Product Finder + ASIN enrichment; legacy Axesso rows are SERP audit only. Spec: Niche Curation v4 (2026-05-12, Keepa update 2026-05-13).';


-- =============================================================================
-- 2. market_curation_candidates
-- =============================================================================
-- Every scored candidate from each market-curation run, including ones filtered
-- out before LLM. Enables debugging "why was X not picked?" without re-running.

CREATE TABLE IF NOT EXISTS public.market_curation_candidates (
  id                       uuid primary key default gen_random_uuid(),
  run_id                   uuid not null references public.market_curation_runs(id) on delete cascade,
  enrichment_id            uuid references public.poe_competitive_enrichments(id) on delete set null,
  poe_snapshot_id          uuid not null references public.poe_snapshots(id) on delete cascade,

  query                    text not null,
  query_type               text not null,

  -- Computed numeric primitives (deterministic, code-computed in Stage B)
  click_concentration      numeric,    -- 0-1, derived from top_clicked_products (inverted)
  brand_concentration      numeric,    -- 0-1, from distinct_brands in top-10
  concentration            numeric,    -- max(click_concentration, brand_concentration)
  review_moat              numeric,    -- 0-1, log-scaled review_p50
  attackability            numeric,    -- (1-concentration) * (1-review_moat)
  growth                   numeric,    -- 0-1.5, raw decimal mean of POE+Datarova growth
  acceleration             numeric,    -- 0-1, poe_g90 - poe_g180 delta
  price_modifier           numeric,    -- 0.7-1.3 banded multiplier on avg_price
  demand_quality           numeric,    -- 0-1, conversion-only (return rate dropped)
  specificity              numeric,    -- 0.2/0.7/0.85/1.0 by modifier-category match count
  core_opportunity         numeric,    -- attackability * growth * price_modifier

  -- Pre-filter flags
  filter_drops             text[] not null default '{}',  -- empty if passed all filters
  high_return_warning      boolean not null default false,

  -- LLM judgment (null if filtered out before LLM stage)
  playbook_fit             integer check (playbook_fit is null or (playbook_fit >= 0 and playbook_fit <= 10)),
  wedge_lever              text check (wedge_lever is null or wedge_lever in
                            ('potency','branded','delivery','stack','demographic','purity','none')),
  wedge_specifics          text,
  fit_reason               text,
  thesis                   text,
  risks                    jsonb,

  -- Registry context (for candidates that overlap with Toniiq's existing products)
  registry_match           jsonb,      -- {product, queue, state, last_updated} or null

  -- Final composite + lens assignment
  composite_score          numeric check (composite_score is null or (composite_score >= 0 and composite_score <= 100)),
  lens                     text check (lens is null or lens in
                            ('launch_wedge','niche_root','anomalous_growth')),
  promoted_to_picks        boolean not null default false,

  -- Audit
  score_version            text not null default 'v4',
  scored_at                timestamptz not null default now()
);

CREATE INDEX idx_cand_run                ON public.market_curation_candidates(run_id);
CREATE INDEX idx_cand_run_composite      ON public.market_curation_candidates(run_id, composite_score DESC);
CREATE INDEX idx_cand_run_lens           ON public.market_curation_candidates(run_id, lens) WHERE lens IS NOT NULL;
CREATE INDEX idx_cand_promoted           ON public.market_curation_candidates(run_id) WHERE promoted_to_picks = true;
CREATE INDEX idx_cand_poe_snapshot       ON public.market_curation_candidates(poe_snapshot_id);

ALTER TABLE public.market_curation_candidates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "curation_candidates_auth_read"
  ON public.market_curation_candidates
  FOR SELECT TO authenticated USING (true);

COMMENT ON TABLE public.market_curation_candidates IS
  'Every scored candidate from each market-curation run (debug/audit trail). One row per scored candidate (per-query, not per-POE-row). Includes filtered-out candidates with filter_drops populated. Spec: Niche Curation v4 (2026-05-12).';


-- =============================================================================
-- 3. Extend market_curation_picks for v4 lens + audit
-- =============================================================================
-- Existing v3 rows (8 rows from 2026-05-12 v10 run) keep score_version='v3'
-- and have NULL lens/computed_signals. v4 rows populate all new columns.

ALTER TABLE public.market_curation_picks
  ADD COLUMN IF NOT EXISTS lens                   text,
  ADD COLUMN IF NOT EXISTS source_poe_snapshot_id uuid,
  ADD COLUMN IF NOT EXISTS primary_query          text,
  ADD COLUMN IF NOT EXISTS query_type             text,
  ADD COLUMN IF NOT EXISTS computed_signals       jsonb,
  ADD COLUMN IF NOT EXISTS competitive_snapshot   jsonb,
  ADD COLUMN IF NOT EXISTS score_version          text not null default 'v3',
  -- candidate_id already exists and is FK to idea_candidates(id) — v3 semantic.
  -- Add a new column for v4 to FK into market_curation_candidates.
  ADD COLUMN IF NOT EXISTS curation_candidate_id  uuid;

-- Add CHECK constraints + FKs only if they don't already exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'market_curation_picks_lens_check'
  ) THEN
    ALTER TABLE public.market_curation_picks
      ADD CONSTRAINT market_curation_picks_lens_check
      CHECK (lens IS NULL OR lens IN ('launch_wedge','niche_root','anomalous_growth'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'market_curation_picks_source_poe_snapshot_id_fkey'
  ) THEN
    ALTER TABLE public.market_curation_picks
      ADD CONSTRAINT market_curation_picks_source_poe_snapshot_id_fkey
      FOREIGN KEY (source_poe_snapshot_id) REFERENCES public.poe_snapshots(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'market_curation_picks_curation_candidate_id_fkey'
  ) THEN
    ALTER TABLE public.market_curation_picks
      ADD CONSTRAINT market_curation_picks_curation_candidate_id_fkey
      FOREIGN KEY (curation_candidate_id) REFERENCES public.market_curation_candidates(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_picks_lens
  ON public.market_curation_picks(run_id, lens) WHERE lens IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_picks_score_version
  ON public.market_curation_picks(score_version);

COMMENT ON COLUMN public.market_curation_picks.lens IS
  'v4: launch_wedge | niche_root | anomalous_growth. NULL for v3 rows.';
COMMENT ON COLUMN public.market_curation_picks.candidate_id IS
  'v3 semantic: FK to idea_candidates(id). For v4 lineage use curation_candidate_id.';
COMMENT ON COLUMN public.market_curation_picks.curation_candidate_id IS
  'v4: FK to market_curation_candidates(id). NULL for v3 rows.';
