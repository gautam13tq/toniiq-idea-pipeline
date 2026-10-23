#!/usr/bin/env bash
# Runs the score_idea and Notion link tests against an EMPTY disposable Postgres 15+ database.
# Usage: PGURL=postgres://user@host:port/empty_db supabase/tests/run.sh
set -euo pipefail
: "${PGURL:?set PGURL to an empty, disposable database}"
here="$(cd "$(dirname "$0")" && pwd)"
psql_q() { psql "$PGURL" -X -q -v ON_ERROR_STOP=1 "$@"; }
python3 "$here/build_test_schema.py" | psql_q
psql_q -f "$here/../migrations/20261022145533_piece1_score_idea.sql"
psql_q -f "$here/../migrations/20261023120000_piece3_notion_writeback.sql"
psql_q -f "$here/score_idea.test.sql"
psql_q -f "$here/notion_link.test.sql"
node --experimental-strip-types --no-warnings "$here/result_shape_selftest.mjs"
