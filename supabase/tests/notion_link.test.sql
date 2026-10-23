-- Tests for the Notion link (piece 3): notion_page_id on concepts, the write-back queue
-- and mark_notion_synced. Run after score_idea.test.sql; rolled back like it.
\set ON_ERROR_STOP on
BEGIN;

CREATE TEMP TABLE t_ctx (k text PRIMARY KEY, v jsonb);

-- N1. A call with a Notion page links the new concept to it.
DO $$
DECLARE r jsonb;
BEGIN
  r := score_idea('{"idea_name":"Zz Test Tongkat Ali","notion_page_id":"page-n1"}');
  ASSERT r->>'status' = 'queued', 'N1 status ' || r::text;
  ASSERT r->>'notion_page_id' = 'page-n1', 'N1 page in result';
  ASSERT (SELECT notion_page_id FROM product_concepts WHERE id = (r->>'concept_id')::uuid) = 'page-n1', 'N1 stored';
  INSERT INTO t_ctx VALUES ('n1', r);
END $$;

-- N2. The same page under a renamed title finds the same concept and creates nothing.
DO $$
DECLARE r jsonb; n1 jsonb := (SELECT v FROM t_ctx WHERE k = 'n1');
BEGIN
  r := score_idea('{"idea_name":"Zz Test Tongkat Ali 200:1 Extract","notion_page_id":"page-n1"}');
  ASSERT r->>'concept_id' = n1->>'concept_id', 'N2 same concept ' || r::text;
  ASSERT r->>'action_id' = n1->>'action_id', 'N2 same run';
  ASSERT NOT (r->'created'->>'concept')::boolean AND NOT (r->'created'->>'candidate')::boolean, 'N2 nothing created';
END $$;

-- N3. A second concept can't take a page that is already linked.
DO $$
DECLARE r jsonb;
BEGIN
  r := score_idea('{"idea_name":"Zz Test Fadogia","concept_id":null,"notion_page_id":"page-n1","dry_run":true}');
  -- Page lookup wins, so this resolves to the linked concept rather than a new one.
  ASSERT r->>'notion_page_id' = 'page-n1', 'N3 page';
  r := score_idea('{"idea_name":"Zz Test Fadogia"}');
  r := score_idea(jsonb_build_object('concept_id', r->>'concept_id', 'notion_page_id', 'page-n1', 'dry_run', true));
  ASSERT r->>'notion_note' LIKE '%already linked to another concept%', 'N3 note ' || r::text;
  ASSERT r->'notion_page_id' = 'null'::jsonb, 'N3 link unchanged';
END $$;

-- N4. A linked concept keeps its page when called with a different one.
DO $$
DECLARE r jsonb; n1 jsonb := (SELECT v FROM t_ctx WHERE k = 'n1');
BEGIN
  r := score_idea(jsonb_build_object('concept_id', n1->>'concept_id', 'notion_page_id', 'page-other', 'dry_run', true));
  ASSERT r->>'notion_page_id' = 'page-n1', 'N4 kept';
  ASSERT r->>'notion_note' LIKE '%linked to another Notion row%', 'N4 note ' || r::text;
END $$;

-- N5. The queue lists the latest unsynced v5 score of linked concepts only.
DO $$
DECLARE n1 jsonb := (SELECT v FROM t_ctx WHERE k = 'n1'); old_id uuid; new_id uuid; q jsonb;
BEGIN
  ASSERT NOT EXISTS (SELECT 1 FROM notion_writeback_queue() x WHERE x->>'notion_page_id' = 'page-n1'), 'N5 empty before score';
  INSERT INTO concept_scores (concept_id, scoring_version, composite_score, recommendation_tier, quality_gate_status,
                              pillar_demand_score, pillar_growth_score, pillar_competitive_score, pillar_diff_score,
                              competition_gate, scored_at)
  VALUES ((n1->>'concept_id')::uuid, 'phase-b-v5-hybrid-competitive', 48.0, 'needs_work', 'passed', 5, 4, 5, 5,
          '{"composite_cap":100,"tier_cap":"launch_priority","caps_applied":[]}', now() - interval '2 hours')
  RETURNING id INTO old_id;
  INSERT INTO concept_scores (concept_id, scoring_version, composite_score, recommendation_tier, quality_gate_status,
                              pillar_demand_score, pillar_growth_score, pillar_competitive_score, pillar_diff_score,
                              competition_gate, scored_at)
  VALUES ((n1->>'concept_id')::uuid, 'phase-b-v5-hybrid-competitive', 66.2, 'strong_candidate', 'passed', 7, 6, 6.5, 7,
          '{"composite_cap":100,"tier_cap":"launch_priority","caps_applied":[]}', now())
  RETURNING id INTO new_id;
  SELECT x INTO q FROM notion_writeback_queue() x WHERE x->>'notion_page_id' = 'page-n1';
  ASSERT q->>'score_id' = new_id::text, 'N5 latest score ' || coalesce(q::text, 'none');
  ASSERT q->'result' IS NOT NULL AND q->'result' <> 'null'::jsonb, 'N5 result shape';
  ASSERT (SELECT count(*) FROM notion_writeback_queue() x WHERE x->>'notion_page_id' = 'page-n1') = 1, 'N5 one row per page';
  INSERT INTO t_ctx VALUES ('n5', jsonb_build_object('score_id', new_id));
END $$;

-- N6. Marking it synced takes it off the queue; a newer score puts it back.
DO $$
DECLARE n1 jsonb := (SELECT v FROM t_ctx WHERE k = 'n1'); sid uuid := (SELECT (v->>'score_id')::uuid FROM t_ctx WHERE k = 'n5');
BEGIN
  ASSERT mark_notion_synced(sid) IS NOT NULL, 'N6 returns time';
  ASSERT NOT EXISTS (SELECT 1 FROM notion_writeback_queue() x WHERE x->>'notion_page_id' = 'page-n1'), 'N6 off queue';
  INSERT INTO concept_scores (concept_id, scoring_version, composite_score, recommendation_tier, quality_gate_status,
                              pillar_demand_score, pillar_growth_score, pillar_competitive_score, pillar_diff_score,
                              competition_gate, scored_at)
  VALUES ((n1->>'concept_id')::uuid, 'phase-b-v5-hybrid-competitive', 70.0, 'strong_candidate', 'passed', 7, 6, 7, 7,
          '{"composite_cap":100,"tier_cap":"launch_priority","caps_applied":[]}', now() + interval '1 minute');
  ASSERT EXISTS (SELECT 1 FROM notion_writeback_queue() x WHERE x->>'notion_page_id' = 'page-n1'), 'N6 back on queue';
  ASSERT mark_notion_synced(gen_random_uuid()) IS NULL, 'N6 unknown id';
END $$;

\echo 'notion link tests: all passed'
ROLLBACK;
