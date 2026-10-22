# Database tests

Tests for `score_idea()` and `idea_score_result()` (piece 1 of the Amazon ideas rebuild).

```bash
createdb score_idea_test        # any empty, disposable Postgres 15+ database
PGURL=postgres://localhost/score_idea_test supabase/tests/run.sh
```

`run.sh` builds a minimal schema from the baseline migrations (`build_test_schema.py`),
applies the piece 1 migration, then runs:

- `score_idea.test.sql`: no duplicates on repeat calls, gate-failed ideas return no
  composite, failed runs are not retried until forced, decided concepts are blocked,
  the daily cap holds, dry runs leave nothing behind. Rolled back at the end.
- `result_shape_selftest.mjs`: the `_selftest` golden fixture, stored the way
  `phase-b-evaluate` stores it, comes back through `idea_score_result()` with the
  composite, tier and pillars that `npm run eval:phase-b` computes.

Never point `PGURL` at the live project.

## Calling score_idea

```sql
select score_idea('{"idea_name": "Magnesium Glycinate Gummies", "notes": "...", "notion_page_id": "..."}');
```

| status | meaning |
|---|---|
| `scored` | a Phase B v5 score under `max_age_days` (default 60) exists; `result` holds it |
| `queued` / `running` | one `run_phase_b` is waiting or running; call again later with the same input |
| `failed` | the last run failed in the past 24 h without a score; `reason` says why; retry with `force_rerun` |
| `blocked` | the concept is greenlit, in development, rejected, parked or archived |
| `over_budget` | `system_config.score_idea_daily_cap` (default 10) runs already queued in 24 h |

Add `"dry_run": true` to see what a call would do without writing anything.
