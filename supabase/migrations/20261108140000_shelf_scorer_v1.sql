-- Shelf scorer v1 (agreed with Gautam 8 Nov 2026). One row per validated run, written only by scorer/write_score.py
-- with the service role after every BLOCKER check passed. Evidence lives in the run folder named by run_id.
CREATE TABLE IF NOT EXISTS public.shelf_scores (
  run_id          text PRIMARY KEY,
  idea_id         text,
  shelf_keyword   text NOT NULL,
  scoring_version text NOT NULL DEFAULT 'shelf-v1',
  score           numeric,
  raw             numeric,
  tier            text NOT NULL CHECK (tier IN ('strong','watchlist','needs work','pass','ineligible')),
  "D"             numeric,
  "G"             numeric,
  "C"             numeric,
  "Diff"          numeric,
  hard            jsonb NOT NULL DEFAULT '[]',
  soft            jsonb NOT NULL DEFAULT '[]',
  info            jsonb NOT NULL DEFAULT '[]',
  cost_usd        numeric,
  validated_at    timestamptz NOT NULL,
  published_at    timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.shelf_scores IS 'Amazon shelf scores, 0-100, strong at 60. Only validated runs of the shelf scorer v1; never hand-entered.';
CREATE INDEX IF NOT EXISTS shelf_scores_idea_idx ON public.shelf_scores (idea_id, published_at DESC);
ALTER TABLE public.shelf_scores ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.shelf_scores FROM anon;
GRANT SELECT ON public.shelf_scores TO authenticated;
GRANT ALL ON public.shelf_scores TO service_role;
DROP POLICY IF EXISTS shelf_scores_read ON public.shelf_scores;
CREATE POLICY shelf_scores_read ON public.shelf_scores FOR SELECT TO authenticated USING (true);
