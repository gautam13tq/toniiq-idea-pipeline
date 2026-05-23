#!/bin/bash
#
# refire_phase_a_serial.sh — Re-fire Phase A research for a list of candidates,
# ONE AT A TIME, serially. Keeps peak Apify memory at ~10 GB per Phase A run,
# well under the Apify Starter plan's 32 GB cap. Use this for audit batches or
# any time you need to re-fire Phase A on many candidates without paying for
# Apify memory add-ons.
#
# Why serial: phase-a-gather internally parallelizes (autocomplete suffixes +
# Reddit branch + datarova bulk) and peaks at ~10 GB momentarily. Firing
# multiple invocations concurrently multiplies that and hits the Apify cap.
# Serial firing avoids that without any edge function code changes.
#
# Usage:
#   ./scripts/refire_phase_a_serial.sh CANDIDATE_ID_1 [CANDIDATE_ID_2 ...]
#   echo "$id1\n$id2" | ./scripts/refire_phase_a_serial.sh
#
# Examples:
#   # Re-fire two candidates
#   ./scripts/refire_phase_a_serial.sh \
#     67a697cb-da80-4d77-8b71-d863ce8caa11 \
#     a895b6d4-6eb4-4b00-b74c-ef52369dde52
#
#   # From a file (one UUID per line, blank lines and #-comments ignored)
#   ./scripts/refire_phase_a_serial.sh < candidates.txt
#
# Environment overrides:
#   PROJECT_REF        Supabase project ref (default: hamreqogmporpgdjglyn)
#   SLEEP_BETWEEN_S    Seconds to wait between firings (default: 360 = 6 min)
#                      Phase A typically takes 3-5 min; 6 min gives buffer for
#                      slow Reddit retries.
#   DRY_RUN=1          Print what would fire, don't actually fire.
#   LOG_FILE=path      Append detailed log to file (in addition to stdout).
#
# After running, verify state via Supabase MCP / SQL — see end of script for
# the recommended verification query.

set -euo pipefail

PROJECT_REF="${PROJECT_REF:-hamreqogmporpgdjglyn}"
SLEEP_BETWEEN_S="${SLEEP_BETWEEN_S:-360}"
DRY_RUN="${DRY_RUN:-0}"
LOG_FILE="${LOG_FILE:-}"

# Public anon JWT — safe to inline. Service-role keys must never be in this script.
ANON_JWT="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhhbXJlcW9nbXBvcnBnZGpnbHluIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI0NDk5MTIsImV4cCI6MjA4ODAyNTkxMn0.5dziRHehoUfycKYUq52JOc8zYGdoF0g7wxT3Zux6dXk"

log() {
  local msg="$(date -u +%H:%M:%S) $*"
  echo "$msg"
  if [ -n "$LOG_FILE" ]; then
    echo "$msg" >> "$LOG_FILE"
  fi
  return 0
}

# Read candidate IDs from CLI args or stdin. Filter blanks and #-comments.
CANDIDATES=()
if [ $# -gt 0 ]; then
  CANDIDATES=("$@")
else
  while IFS= read -r line; do
    trimmed="$(echo "$line" | sed 's/#.*//' | xargs)"
    [ -n "$trimmed" ] && CANDIDATES+=("$trimmed")
  done
fi

if [ ${#CANDIDATES[@]} -eq 0 ]; then
  echo "ERROR: no candidate IDs supplied (pass as args or pipe via stdin)" >&2
  exit 1
fi

# UUID validation — fail fast if a malformed ID is passed
for id in "${CANDIDATES[@]}"; do
  if ! [[ "$id" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]]; then
    echo "ERROR: '$id' is not a valid UUID" >&2
    exit 1
  fi
done

TOTAL=${#CANDIDATES[@]}
ETA_MIN=$(( TOTAL * SLEEP_BETWEEN_S / 60 ))

log "===== SERIAL PHASE A RE-FIRE ====="
log "Project: $PROJECT_REF"
log "Candidates: $TOTAL"
log "Sleep between: ${SLEEP_BETWEEN_S}s ($((SLEEP_BETWEEN_S/60)) min)"
log "Estimated total: ~${ETA_MIN} min"
log "Dry run: $DRY_RUN"
log "===================================="

if [ "$DRY_RUN" = "1" ]; then
  for id in "${CANDIDATES[@]}"; do
    log "  [DRY] would fire phase-a-gather for $id"
  done
  log "Dry run complete. No requests sent."
  exit 0
fi

idx=0
for id in "${CANDIDATES[@]}"; do
  idx=$((idx + 1))
  log "[$idx/$TOTAL] firing phase-a-gather for $id"

  # Fire the function. curl will disconnect at ~60s (Cloudflare gateway timeout)
  # but the server-side function keeps running. We then wait the full
  # SLEEP_BETWEEN_S to let it complete before firing the next one.
  curl -sS --http1.1 -X POST \
    "https://${PROJECT_REF}.supabase.co/functions/v1/phase-a-gather" \
    -H "Authorization: Bearer ${ANON_JWT}" \
    -H "apikey: ${ANON_JWT}" \
    -H "Content-Type: application/json" \
    --max-time 70 \
    -d "{\"candidate_id\": \"${id}\"}" \
    >/dev/null 2>&1 || true

  # If not the last one, wait before firing the next. Skip the wait on the
  # final candidate — let the caller verify state in their own time.
  if [ $idx -lt $TOTAL ]; then
    log "[$idx/$TOTAL] fired; sleeping ${SLEEP_BETWEEN_S}s before next"
    sleep "$SLEEP_BETWEEN_S"
  else
    log "[$idx/$TOTAL] fired (final candidate — Phase A still running server-side ~3-5 min)"
  fi
done

log ""
log "===== DONE: all $TOTAL Phase A runs dispatched serially ====="
log ""
log "To verify state, run this SQL via Supabase MCP / SQL Editor:"
log "  SELECT ic.ingredient_name, pa.status, pa.context->>'concepts_count' AS concepts,"
log "         pa.context->>'reddit_final' AS reddit, pa.context->>'datarova_final' AS datarova,"
log "         pa.context->'inferred_keywords'->>'primary_keyword' AS inferred_primary"
log "  FROM pending_actions pa"
log "  JOIN idea_candidates ic ON ic.id = pa.entity_id"
log "  WHERE pa.action='run_phase_a' AND pa.entity_id IN ($(printf "'%s'," "${CANDIDATES[@]}" | sed 's/,$//'))"
log "    AND pa.created_at > (now() - interval '${ETA_MIN} minutes')"
log "  ORDER BY pa.created_at;"
