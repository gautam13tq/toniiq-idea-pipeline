-- Exported from live Supabase toniiq-npd (gmfndxaoeztxohbbkudu), supabase_migrations.schema_migrations, on 2026-10-22.
-- QA fix 2026-08-19: objects missed by the initial 38-table clone.
-- google_trends_snapshots (empty on source, but referenced by pipeline_overview)
CREATE TABLE public.google_trends_snapshots (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  candidate_id uuid,
  search_term text NOT NULL,
  direction trend_direction DEFAULT 'no_data'::trend_direction NOT NULL,
  yoy_change_pct numeric(8,2),
  current_interest integer,
  peak_interest integer,
  is_breakout boolean DEFAULT false,
  time_range text DEFAULT 'past12Months'::text,
  geo text DEFAULT 'US'::text,
  signal_adjustment integer DEFAULT 0,
  import_date date DEFAULT CURRENT_DATE NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE public.google_trends_snapshots ADD CONSTRAINT google_trends_snapshots_pkey PRIMARY KEY (id);
ALTER TABLE public.google_trends_snapshots ADD CONSTRAINT google_trends_snapshots_candidate_id_fkey FOREIGN KEY (candidate_id) REFERENCES idea_candidates(id) ON DELETE SET NULL;
ALTER TABLE public.google_trends_snapshots ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.google_trends_snapshots TO authenticated;
GRANT ALL ON public.google_trends_snapshots TO service_role;
CREATE POLICY "Auth full access" ON public.google_trends_snapshots AS PERMISSIVE FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- pipeline_overview view (verbatim from source)
CREATE OR REPLACE VIEW public.pipeline_overview AS
 SELECT ic.id,
    ic.ingredient_name,
    ic.category,
    ic.stage,
    ic.overall_signal,
    ic.diff_fit,
    ic.source_count,
    ic.source_poe,
    ic.source_smartscout,
    ic.source_datarova,
    ic.source_google_trends,
    ic.priority_score,
    ic.composite_score,
    ic.recommendation_tier,
    ic.in_toniiq_catalog,
    ic.first_surfaced_at,
    ic.surfaced_week,
    ic.last_updated_at,
    poe.search_volume_90d AS poe_volume_90d,
    poe.search_volume_growth_90d AS poe_growth_90d,
    poe.avg_price_usd AS poe_avg_price,
    gt.direction AS gtrends_direction,
    gt.yoy_change_pct AS gtrends_yoy
   FROM ((idea_candidates ic
     LEFT JOIN LATERAL ( SELECT poe_snapshots.search_volume_90d,
            poe_snapshots.search_volume_growth_90d,
            poe_snapshots.avg_price_usd
           FROM poe_snapshots
          WHERE (poe_snapshots.candidate_id = ic.id)
          ORDER BY poe_snapshots.import_date DESC
         LIMIT 1) poe ON (true))
     LEFT JOIN LATERAL ( SELECT google_trends_snapshots.direction,
            google_trends_snapshots.yoy_change_pct
           FROM google_trends_snapshots
          WHERE (google_trends_snapshots.candidate_id = ic.id)
          ORDER BY google_trends_snapshots.import_date DESC
         LIMIT 1) gt ON (true))
  ORDER BY
        CASE ic.stage
            WHEN 'development'::idea_stage THEN 1
            WHEN 'evaluation'::idea_stage THEN 2
            WHEN 'research'::idea_stage THEN 3
            WHEN 'inbox'::idea_stage THEN 4
            WHEN 'archive'::idea_stage THEN 5
            ELSE NULL::integer
        END, ic.priority_score DESC NULLS LAST;

-- v_pipeline_quality view (verbatim from source)
CREATE OR REPLACE VIEW public.v_pipeline_quality AS
 SELECT id,
    run_id,
    entity_type,
    entity_id,
    entity_name,
    candidate_id,
    findings,
    critical_count,
    warn_count,
    created_at
   FROM quality_audits qa
  WHERE (run_id = ( SELECT quality_audits.run_id
           FROM quality_audits
          ORDER BY quality_audits.created_at DESC
         LIMIT 1));

GRANT SELECT ON public.pipeline_overview TO authenticated;
GRANT SELECT ON public.v_pipeline_quality TO authenticated;
GRANT SELECT ON public.pipeline_overview TO service_role;
GRANT SELECT ON public.v_pipeline_quality TO service_role;
