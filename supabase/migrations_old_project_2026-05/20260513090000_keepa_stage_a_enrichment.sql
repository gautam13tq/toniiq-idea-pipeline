-- Migration: keepa_stage_a_enrichment
-- Date: 2026-05-13
-- Purpose: Replace Axesso salesVolume semantics with Keepa BSR/monthlySold
--          audit fields for Niche Curation v4 Stage A.

ALTER TABLE public.poe_competitive_enrichments
  ADD COLUMN IF NOT EXISTS source text not null default 'apify_axesso',
  ADD COLUMN IF NOT EXISTS source_version text,
  ADD COLUMN IF NOT EXISTS keepa_tokens_consumed integer,
  ADD COLUMN IF NOT EXISTS keepa_refill_rate integer,
  ADD COLUMN IF NOT EXISTS sales_signal_source text,
  ADD COLUMN IF NOT EXISTS monthly_sold_coverage integer,
  ADD COLUMN IF NOT EXISTS bsr_best integer,
  ADD COLUMN IF NOT EXISTS bsr_p50 numeric,
  ADD COLUMN IF NOT EXISTS bsr_p90 numeric,
  ADD COLUMN IF NOT EXISTS result_quality jsonb not null default '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_enrich_source
  ON public.poe_competitive_enrichments(source);

CREATE INDEX IF NOT EXISTS idx_enrich_keepa_bsr
  ON public.poe_competitive_enrichments(bsr_best)
  WHERE source = 'keepa_product_finder';

COMMENT ON TABLE public.poe_competitive_enrichments IS
  'Competitive enrichment per POE query (customer_need + each top_search_term). Current Stage A source is Keepa Product Finder + ASIN enrichment. Older rows may use Apify Axesso and should not be treated as reliable monthly sales truth.';

COMMENT ON COLUMN public.poe_competitive_enrichments.top_results IS
  'Audit JSON for top competitive results. Keepa rows include ASIN, title, brand, price, rating, reviews, monthly_sold badge, current/30d/90d BSR, classification, and other ingredient hits.';

COMMENT ON COLUMN public.poe_competitive_enrichments.sales_top3_share IS
  'For Keepa rows, share of top-3 monthlySold badge values within scored top results. This is a directional badge/concentration signal, not exact unit share.';

COMMENT ON COLUMN public.poe_competitive_enrichments.source IS
  'Data source used for this enrichment. keepa_product_finder is the current Stage A source; apify_axesso rows are legacy.';

COMMENT ON COLUMN public.poe_competitive_enrichments.sales_signal_source IS
  'Human-readable sales signal basis, e.g. keepa_bsr_monthlySold_badge.';

COMMENT ON COLUMN public.poe_competitive_enrichments.result_quality IS
  'Stage A quality diagnostics: scored_count, single_ingredient_count, stack_count, adjacent_count, monthly_sold_coverage, raw_result_count, scoring_basis.';
