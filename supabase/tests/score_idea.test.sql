-- Tests for score_idea / idea_score_result (piece 1).
-- Run against a disposable database that has the baseline tables plus the piece 1
-- migration; see supabase/tests/README.md. Everything runs in one transaction and is
-- rolled back. Any failed ASSERT stops the script with a non-zero exit.
\set ON_ERROR_STOP on
BEGIN;

CREATE TEMP TABLE t_ctx (k text PRIMARY KEY, v jsonb);

-- T1. A new idea creates one candidate, one concept and one queued run.
DO $$
DECLARE r jsonb;
BEGIN
  r := score_idea('{"idea_name":"Zz Test Ashwagandha Gummies","notes":"KSM-66, 600 mg","format":"gummy","lane":"Core Amazon","notion_page_id":"abc123"}');
  ASSERT r->>'status' = 'queued', 'T1 status ' || r::text;
  ASSERT (r->'created'->>'candidate')::boolean AND (r->'created'->>'concept')::boolean, 'T1 created flags';
  ASSERT r->>'concept_status' = 'accepted', 'T1 concept_status';
  ASSERT (SELECT count(*) FROM pending_actions WHERE entity_id = (r->>'concept_id')::uuid) = 1, 'T1 one action';
  ASSERT (SELECT context->>'notion_page_id' FROM pending_actions WHERE id = (r->>'action_id')::uuid) = 'abc123', 'T1 context';
  ASSERT (SELECT triggered_by FROM pending_actions WHERE id = (r->>'action_id')::uuid) = 'llm', 'T1 triggered_by';
  ASSERT (SELECT stage::text FROM idea_candidates WHERE id = (r->>'candidate_id')::uuid) = 'research', 'T1 stage rollup';
  ASSERT (SELECT positioning_angle FROM product_concepts WHERE id = (r->>'concept_id')::uuid) = 'KSM-66, 600 mg', 'T1 notes';
  INSERT INTO t_ctx VALUES ('t1', r);
END $$;

-- T2. The same call again returns the same run and creates nothing.
DO $$
DECLARE r jsonb; t1 jsonb := (SELECT v FROM t_ctx WHERE k = 't1');
BEGIN
  r := score_idea('{"idea_name":"zz test ashwagandha gummies "}');
  ASSERT r->>'status' = 'queued', 'T2 status ' || r::text;
  ASSERT r->>'action_id' = t1->>'action_id', 'T2 same action';
  ASSERT r->>'concept_id' = t1->>'concept_id', 'T2 same concept';
  ASSERT NOT (r->'created'->>'candidate')::boolean AND NOT (r->'created'->>'concept')::boolean, 'T2 nothing created';
  ASSERT (SELECT count(*) FROM idea_candidates WHERE ingredient_name_normalized = 'zz test ashwagandha') = 1, 'T2 one candidate';
  ASSERT (SELECT count(*) FROM product_concepts WHERE candidate_id = (t1->>'candidate_id')::uuid) = 1, 'T2 one concept';
  ASSERT (SELECT count(*) FROM pending_actions WHERE entity_id = (t1->>'concept_id')::uuid) = 1, 'T2 one action';
END $$;

-- T3. A format variant shares the candidate but is its own concept.
DO $$
DECLARE r jsonb; t1 jsonb := (SELECT v FROM t_ctx WHERE k = 't1');
BEGIN
  r := score_idea('{"idea_name":"Zz Test Ashwagandha Capsules"}');
  ASSERT r->>'candidate_id' = t1->>'candidate_id', 'T3 same candidate';
  ASSERT r->>'concept_id' <> t1->>'concept_id', 'T3 new concept';
  ASSERT r->>'status' = 'queued', 'T3 status';
END $$;

-- T3b. An older row normalised another way is found by its exact name.
DO $$
DECLARE r jsonb; cand uuid;
BEGIN
  INSERT INTO idea_candidates (ingredient_name, ingredient_name_normalized) VALUES ('Zz Test Saffron Supplements', 'zz test saffron s') RETURNING id INTO cand;
  r := score_idea('{"idea_name":"zz test saffron supplements","dry_run":true}');
  ASSERT r->>'candidate_id' = cand::text AND NOT (r->'created'->>'candidate')::boolean, 'T3b ' || r::text;
END $$;

-- T4. A run that has started is reported as running.
DO $$
DECLARE r jsonb; t1 jsonb := (SELECT v FROM t_ctx WHERE k = 't1');
BEGIN
  UPDATE pending_actions SET status = 'in_progress', started_at = now() WHERE id = (t1->>'action_id')::uuid;
  r := score_idea('{"idea_name":"Zz Test Ashwagandha Gummies"}');
  ASSERT r->>'status' = 'running' AND r->>'action_id' = t1->>'action_id', 'T4 ' || r::text;
END $$;

-- T5. A quality-gate failure is a result: gate status and reason, no composite or tier.
DO $$
DECLARE r jsonb; t1 jsonb := (SELECT v FROM t_ctx WHERE k = 't1'); v_at timestamptz := now() - interval '1 day';
BEGIN
  INSERT INTO concept_scores (concept_id, scoring_version, competitive_frame, composite_score, recommendation_tier,
                              quality_gate_status, data_quality_summary, overall_assessment, scored_at)
  VALUES ((t1->>'concept_id')::uuid, 'phase-b-v5-hybrid-competitive',
          '{"frame":"broad_hero","hero_ingredient":"ashwagandha","query_packet":["ashwagandha gummies"],"require_any":[]}',
          NULL, 'pass', 'failed_demand',
          '{"demand_primary_keyword":"ashwagandha gummies","demand_primary_clicks":40,"included_count":7}',
          'Quality gate failed: primary keyword under 100 clicks. No composite score published.', v_at);
  UPDATE pending_actions SET status = 'failed', completed_at = v_at + interval '2 seconds',
         notes = 'Quality gate failed_demand: primary keyword under 100 clicks'
   WHERE id = (t1->>'action_id')::uuid;
  r := score_idea('{"idea_name":"Zz Test Ashwagandha Gummies"}');
  ASSERT r->>'status' = 'scored', 'T5 status ' || r::text;
  ASSERT r->'result'->'gate'->>'status' = 'failed_demand', 'T5 gate';
  ASSERT r->'result'->'gate'->>'reason' = 'primary keyword under 100 clicks', 'T5 reason ' || (r->'result'->'gate')::text;
  ASSERT r->'result'->'composite' = 'null'::jsonb AND r->'result'->'tier' = 'null'::jsonb, 'T5 no composite';
  ASSERT r->'result'->'pillars' = 'null'::jsonb, 'T5 no pillars';
  ASSERT r->'result'->>'scale' = '0-100', 'T5 scale';
  ASSERT r->'result'->'demand'->>'primary_keyword' = 'ashwagandha gummies', 'T5 demand';
  ASSERT (SELECT count(*) FROM pending_actions WHERE entity_id = (t1->>'concept_id')::uuid) = 1, 'T5 nothing queued';
END $$;

-- T6. force_rerun queues a new run even with a fresh score.
DO $$
DECLARE r jsonb; t1 jsonb := (SELECT v FROM t_ctx WHERE k = 't1');
BEGIN
  r := score_idea('{"idea_name":"Zz Test Ashwagandha Gummies","force_rerun":true}');
  ASSERT r->>'status' = 'queued' AND r->>'action_id' <> t1->>'action_id', 'T6 ' || r::text;
  ASSERT r->'previous_result'->'gate'->>'status' = 'failed_demand', 'T6 previous result';
  ASSERT (SELECT count(*) FROM pending_actions WHERE entity_id = (t1->>'concept_id')::uuid) = 2, 'T6 two actions';
END $$;

-- T7. A run that failed without a score (infra error) is reported, not retried, until forced.
DO $$
DECLARE r jsonb; c uuid;
BEGIN
  r := score_idea('{"idea_name":"Zz Test Berberine"}');
  c := (r->>'concept_id')::uuid;
  UPDATE pending_actions SET status = 'failed', started_at = now() - interval '3 minutes', completed_at = now() - interval '1 minute',
         notes = 'Infra error (datarova_auth): key revoked', context = context || '{"infra_error":"datarova_auth"}'
   WHERE id = (r->>'action_id')::uuid;
  r := score_idea('{"idea_name":"Zz Test Berberine"}');
  ASSERT r->>'status' = 'failed', 'T7 status ' || r::text;
  ASSERT r->>'infra_error' = 'datarova_auth', 'T7 infra';
  ASSERT (SELECT count(*) FROM pending_actions WHERE entity_id = c) = 1, 'T7 no retry';
  r := score_idea('{"idea_name":"Zz Test Berberine","force_rerun":true}');
  ASSERT r->>'status' = 'queued', 'T7 forced';
  ASSERT (SELECT count(*) FROM pending_actions WHERE entity_id = c) = 2, 'T7 forced queued once';
END $$;

-- T8. A passed score older than 60 days is re-queued, and the old result is returned with it.
DO $$
DECLARE r jsonb; cand uuid; con uuid;
BEGIN
  INSERT INTO idea_candidates (ingredient_name, ingredient_name_normalized) VALUES ('Zz Test Quercetin', 'zz test quercetin') RETURNING id INTO cand;
  INSERT INTO product_concepts (candidate_id, concept_name, concept_type, status) VALUES (cand, 'Zz Test Quercetin', 'single_ingredient', 'evaluated') RETURNING id INTO con;
  INSERT INTO concept_scores (concept_id, scoring_version, composite_score, recommendation_tier, quality_gate_status,
                              pillar_demand_score, pillar_growth_score, pillar_competitive_score, pillar_diff_score,
                              competition_gate, scored_at)
  VALUES (con, 'phase-b-v5-hybrid-competitive', 61.4, 'watchlist', 'passed', 6, 5, 6.2, 6.5,
          '{"composite_cap":100,"tier_cap":"launch_priority","caps_applied":[]}', now() - interval '90 days');
  r := score_idea('{"idea_name":"Zz Test Quercetin"}');
  ASSERT r->>'status' = 'queued', 'T8 status ' || r::text;
  ASSERT (r->'previous_result'->>'composite')::numeric = 61.4, 'T8 previous composite';
  ASSERT r->>'concept_status' = 'evaluated', 'T8 status kept';
  -- max_age_days lets a caller accept an older score.
  r := score_idea('{"idea_name":"Zz Test Quercetin","max_age_days":120}');
  ASSERT r->>'status' = 'scored', 'T8 max_age ' || r::text;
END $$;

-- T9. A concept already decided on is never rescored.
DO $$
DECLARE r jsonb; cand uuid; n int;
BEGIN
  INSERT INTO idea_candidates (ingredient_name, ingredient_name_normalized) VALUES ('Zz Test NAC', 'zz test nac') RETURNING id INTO cand;
  INSERT INTO product_concepts (candidate_id, concept_name, concept_type, status) VALUES (cand, 'Zz Test NAC', 'single_ingredient', 'in_development');
  SELECT count(*) INTO n FROM pending_actions;
  r := score_idea('{"idea_name":"Zz Test NAC"}');
  ASSERT r->>'status' = 'blocked', 'T9 ' || r::text;
  ASSERT (SELECT count(*) FROM pending_actions) = n, 'T9 nothing queued';
END $$;

-- T10. The daily cap stops queuing and leaves a new concept unqueued.
DO $$
DECLARE r jsonb; n int;
BEGIN
  SELECT count(*) INTO n FROM pending_actions WHERE context->>'source' = 'score_idea';
  INSERT INTO system_config (key, value) VALUES ('score_idea_daily_cap', n::text);
  r := score_idea('{"idea_name":"Zz Test Saffron"}');
  ASSERT r->>'status' = 'over_budget', 'T10 ' || r::text;
  ASSERT (SELECT status FROM product_concepts WHERE id = (r->>'concept_id')::uuid) = 'proposed', 'T10 concept not accepted';
  ASSERT (SELECT count(*) FROM pending_actions WHERE entity_id = (r->>'concept_id')::uuid) = 0, 'T10 no action';
  DELETE FROM system_config WHERE key = 'score_idea_daily_cap';
  r := score_idea('{"idea_name":"Zz Test Saffron"}');
  ASSERT r->>'status' = 'queued' AND r->>'concept_status' = 'accepted', 'T10 queued after cap lifted';
  ASSERT (SELECT count(*) FROM pending_actions WHERE entity_id = (r->>'concept_id')::uuid) = 1, 'T10 exactly one action';
END $$;

-- T11. dry_run walks the same path and leaves nothing behind.
DO $$
DECLARE r jsonb; n_c int; n_p int; n_a int;
BEGIN
  SELECT count(*) INTO n_c FROM idea_candidates;
  SELECT count(*) INTO n_p FROM product_concepts;
  SELECT count(*) INTO n_a FROM pending_actions;
  r := score_idea('{"idea_name":"Zz Test Rhodiola","dry_run":true}');
  ASSERT r->>'status' = 'queued' AND (r->>'dry_run')::boolean, 'T11 ' || r::text;
  ASSERT (SELECT count(*) FROM idea_candidates) = n_c, 'T11 candidates';
  ASSERT (SELECT count(*) FROM product_concepts) = n_p, 'T11 concepts';
  ASSERT (SELECT count(*) FROM pending_actions) = n_a, 'T11 actions';
END $$;

-- T12. Bad input fails loudly.
DO $$
BEGIN
  BEGIN
    PERFORM score_idea('{}');
    ASSERT false, 'T12 empty input accepted';
  EXCEPTION WHEN raise_exception THEN NULL;
  END;
  BEGIN
    PERFORM score_idea('{"idea_name":"capsules"}');
    ASSERT false, 'T12 empty normalised name accepted';
  EXCEPTION WHEN raise_exception THEN NULL;
  END;
END $$;

-- T13. The normaliser matches the UI rule.
DO $$
BEGIN
  ASSERT normalize_idea_name('Magnesium Glycinate Gummies for Women') = 'magnesium glycinate', 'T13a';
  ASSERT normalize_idea_name('  Pure  Creatine   Powder ') = 'creatine', 'T13b';
  ASSERT normalize_idea_name('Liposomal Vitamin C Softgels') = 'liposomal vitamin c', 'T13c';
END $$;

\echo 'score_idea tests: all passed'
ROLLBACK;
