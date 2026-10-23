-- Exported from live Supabase toniiq-npd (gmfndxaoeztxohbbkudu), supabase_migrations.schema_migrations, on 2026-10-22.
-- Piece 0 (2026-10-22): close public access to internal dispatcher functions and views; label score scales.
-- Rollback: product-dev/amazon-ideas-system/piece-0/rollback.sql

-- 1. Internal SECURITY DEFINER functions: only postgres (cron) and service_role (edge functions) may execute.
REVOKE EXECUTE ON FUNCTION public.get_internal_auth_header() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.dispatch_edge_function(text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._invoke_phase_a_gather(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._invoke_phase_b_evaluate(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.dispatch_pending_phase_a() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.dispatch_pending_phase_b() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reap_stale_pending_actions() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.link_atlas_entry_to_review() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_internal_auth_header() TO service_role;
GRANT EXECUTE ON FUNCTION public.dispatch_edge_function(text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public._invoke_phase_a_gather(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public._invoke_phase_b_evaluate(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.dispatch_pending_phase_a() TO service_role;
GRANT EXECUTE ON FUNCTION public.dispatch_pending_phase_b() TO service_role;
GRANT EXECUTE ON FUNCTION public.reap_stale_pending_actions() TO service_role;

-- 2. Views: respect the reader's RLS, and no anonymous access.
ALTER VIEW public.pipeline_overview SET (security_invoker = true);
ALTER VIEW public.v_pipeline_quality SET (security_invoker = true);
REVOKE ALL ON public.pipeline_overview FROM anon;
REVOKE ALL ON public.v_pipeline_quality FROM anon;

-- 3. Score scales. Three scoring paths share concept_scores; label each row's scale so no reader mixes them.
UPDATE public.concept_scores SET scoring_version = 'legacy-v1' WHERE scoring_version IS NULL;
ALTER TABLE public.concept_scores
  ADD COLUMN score_scale text GENERATED ALWAYS AS (
    CASE
      WHEN scoring_version LIKE 'greenlight-%' THEN '0-10'
      WHEN scoring_version IS NULL THEN 'unknown'
      ELSE '0-100'
    END
  ) STORED;
COMMENT ON COLUMN public.concept_scores.score_scale IS 'Scale of composite_score: 0-100 for phase-b-v5-* and legacy-v1, 0-10 for greenlight-v4 (vault skill on the Mac). Never compare across scales.';
COMMENT ON COLUMN public.concept_scores.scoring_version IS 'phase-b-v5-hybrid-competitive (0-100), greenlight-v4 (0-10, vault skill), legacy-v1 (0-100, pre-May 2026 rows that had no version).';
