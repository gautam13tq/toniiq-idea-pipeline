-- Auto-link category_atlas_entries.promoted_review_id when a category_atlas-sourced
-- opportunity_review is created or has its source changed.
--
-- Background (2026-05-19 audit): we found that 0 of 397 category_atlas_entries
-- had a `promoted_review_id` back-link, even though the React CategoryAtlas page
-- has code to write it (src/pages/CategoryAtlasPage.jsx:637). The RLS policies on
-- category_atlas_entries are permissive for authenticated, so the bug is likely
-- a client-side auth state issue in the supabase-js client — but rather than chase
-- it, we put the link logic in a server-side trigger so future Atlas promotions
-- always populate the back-link regardless of how/where the review was created
-- (UI, SQL, edge function, etc.).
--
-- Match logic: opportunity_review -> idea_candidates (via candidate_id) ->
-- category_atlas_entries (via case-insensitive ingredient_name = atlas name).
-- When multiple atlas entries match (the same ingredient often appears across
-- different imports), we prefer the most-scored one (hybrid_scored > scored >
-- pending_hybrid > pending_v4), then most recently scored.
--
-- Only writes when promoted_review_id IS NULL -- never overwrites an existing
-- link. SECURITY DEFINER so the trigger has full table access regardless of
-- the caller's RLS context.

CREATE OR REPLACE FUNCTION public.link_atlas_entry_to_review()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_candidate_name TEXT;
  v_target_atlas_id UUID;
BEGIN
  IF NEW.source IS DISTINCT FROM 'category_atlas' THEN
    RETURN NEW;
  END IF;

  SELECT ingredient_name INTO v_candidate_name
  FROM idea_candidates
  WHERE id = NEW.candidate_id;

  IF v_candidate_name IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT id INTO v_target_atlas_id
  FROM category_atlas_entries
  WHERE LOWER(TRIM(name)) = LOWER(TRIM(v_candidate_name))
    AND promoted_review_id IS NULL
  ORDER BY
    CASE score_status
      WHEN 'hybrid_scored' THEN 1
      WHEN 'scored' THEN 2
      WHEN 'pending_hybrid' THEN 3
      WHEN 'pending_v4' THEN 4
      ELSE 5
    END,
    scored_at DESC NULLS LAST
  LIMIT 1;

  IF v_target_atlas_id IS NOT NULL THEN
    UPDATE category_atlas_entries
    SET promoted_review_id = NEW.id, updated_at = NOW()
    WHERE id = v_target_atlas_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_link_atlas_entry_to_review ON public.opportunity_reviews;

CREATE TRIGGER trg_link_atlas_entry_to_review
AFTER INSERT OR UPDATE OF source ON public.opportunity_reviews
FOR EACH ROW
EXECUTE FUNCTION public.link_atlas_entry_to_review();

-- One-time backfill for the 39 atlas entries that were missing their backlink
-- when this migration ran. (Idempotent -- won't overwrite existing links.)
DO $backfill$
BEGIN
  WITH ranked_atlas AS (
    SELECT
      cae.id AS atlas_entry_id,
      orv.id AS review_id,
      ROW_NUMBER() OVER (
        PARTITION BY orv.id
        ORDER BY
          CASE cae.score_status
            WHEN 'hybrid_scored' THEN 1
            WHEN 'scored' THEN 2
            WHEN 'pending_hybrid' THEN 3
            WHEN 'pending_v4' THEN 4
            ELSE 5
          END,
          cae.scored_at DESC NULLS LAST
      ) AS rank_for_review
    FROM opportunity_reviews orv
    JOIN idea_candidates ic ON ic.id = orv.candidate_id
    JOIN category_atlas_entries cae
      ON LOWER(TRIM(cae.name)) = LOWER(TRIM(ic.ingredient_name))
    WHERE orv.source = 'category_atlas'
      AND cae.promoted_review_id IS NULL
  )
  UPDATE category_atlas_entries cae
  SET promoted_review_id = ra.review_id, updated_at = NOW()
  FROM ranked_atlas ra
  WHERE ra.rank_for_review = 1
    AND cae.id = ra.atlas_entry_id;
END;
$backfill$;
