-- Phase B v5 hybrid scoring — add columns to concept_scores.
--
-- Background (2026-05-21): Phase B v1 produced fabricated composites because
-- amazon_competitive_score relied on a shallow Apify search-scrape with no
-- Keepa enrichment, no competitor classification, and no quality gate. v5
-- ports the Category Atlas v5 hybrid engine into Phase B: Apify discovery +
-- Keepa ASIN enrichment + LLM classification + Datarova-backed demand pillar
-- + sub-signal-level competitive scoring + a strict quality gate that
-- refuses to publish a composite when the underlying data is too thin.
--
-- This migration is additive only — the v1 columns (amazon_competitive_score,
-- tiktok_score, google_trends_score, etc.) remain so historical v1 rows stay
-- readable. New v5 fields are nullable; legacy reads continue to work.
--
-- Idea-pipeline tables only. Does not touch canonical_warehouse / sp_* / etc.

ALTER TABLE public.concept_scores
  ADD COLUMN IF NOT EXISTS competitive_frame jsonb,
  ADD COLUMN IF NOT EXISTS pillar_demand_score numeric(4,2),
  ADD COLUMN IF NOT EXISTS pillar_growth_score numeric(4,2),
  ADD COLUMN IF NOT EXISTS pillar_growth_details jsonb,
  ADD COLUMN IF NOT EXISTS pillar_competitive_score numeric(4,2),
  ADD COLUMN IF NOT EXISTS pillar_competitive_subsignals jsonb,
  ADD COLUMN IF NOT EXISTS pillar_diff_score numeric(4,2),
  ADD COLUMN IF NOT EXISTS competition_gate jsonb,
  ADD COLUMN IF NOT EXISTS quality_gate_status text,
  ADD COLUMN IF NOT EXISTS data_quality_summary jsonb,
  ADD COLUMN IF NOT EXISTS scoring_version text;

COMMENT ON COLUMN public.concept_scores.competitive_frame IS
  'Phase B v5: LLM-inferred competitive frame — {frame, hero_ingredient, delivery_modifier?, primary_lane_query, query_packet[], inclusion_rules[], exclusion_rules[], reasoning}.';
COMMENT ON COLUMN public.concept_scores.pillar_demand_score IS
  'Phase B v5: Market Demand & Intent pillar 0-10 (weighted 20% in composite).';
COMMENT ON COLUMN public.concept_scores.pillar_growth_score IS
  'Phase B v5: Market Growth pillar 0-10 (weighted 15%). Combines 3m/6m/12m windows.';
COMMENT ON COLUMN public.concept_scores.pillar_growth_details IS
  'Phase B v5: per-window growth breakdown — {growth_3m_pct, growth_6m_pct, growth_12m_pct, trajectory_shape}.';
COMMENT ON COLUMN public.concept_scores.pillar_competitive_score IS
  'Phase B v5: Competitive Landscape pillar 0-10 (weighted 35%). Weighted sum of 7 sub-signals.';
COMMENT ON COLUMN public.concept_scores.pillar_competitive_subsignals IS
  'Phase B v5: per-sub-signal scores — review_moat, rev_review_efficiency, bsr_concentration, brand_concentration, competitor_density, premium_tier_viability, spec_wedge.';
COMMENT ON COLUMN public.concept_scores.pillar_diff_score IS
  'Phase B v5: Toniiq Differentiation pillar 0-10 (weighted 30%). Opus 6-vector assessment normalized.';
COMMENT ON COLUMN public.concept_scores.competition_gate IS
  'Phase B v5: caps applied to the composite — {caps[], reasons[], capped_composite_max, capped_tier_max}.';
COMMENT ON COLUMN public.concept_scores.quality_gate_status IS
  'Phase B v5: passed | failed_demand | failed_competitive | failed_frame. When != passed the row is NOT published with a composite_score.';
COMMENT ON COLUMN public.concept_scores.data_quality_summary IS
  'Phase B v5: counts of classified competitors (included/adjacent/excluded), Keepa enrichment coverage %, Datarova rows, monthly_sold badge coverage, etc.';
COMMENT ON COLUMN public.concept_scores.scoring_version IS
  'Phase B scoring algorithm version label, e.g. phase-b-v1 or phase-b-v5-hybrid-competitive. Distinguishes legacy rows from v5 rows in audits.';

CREATE INDEX IF NOT EXISTS idx_concept_scores_scoring_version
  ON public.concept_scores (scoring_version);
CREATE INDEX IF NOT EXISTS idx_concept_scores_quality_gate
  ON public.concept_scores (quality_gate_status);
