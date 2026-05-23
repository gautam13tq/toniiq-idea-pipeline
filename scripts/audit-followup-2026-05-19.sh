#!/bin/bash
#
# audit-followup-2026-05-19.sh
#
# Follow-up Phase A re-fire batch from the 2026-05-19 research-page audit.
# Re-fires 17 candidates SERIALLY (one at a time) using the v4 buyer-keyword
# inference layer. Targets:
#   (a) 2 reaper-killed runs that need a fresh Phase A
#   (b) 5 Reddit-only failures (Datarova landed, Reddit timed out)
#   (c) 10 not-yet-v4'd Atlas-named candidates with dr_clicks=0
#
# Peak Apify memory: ~10 GB per run (serial), comfortably under 32 GB Starter cap.
# ETA: ~17 × 6 min ≈ 100 min wall clock.
#
# Re-run any time the audit needs to be refreshed. The serial controller is
# idempotent and Phase A always uses the latest deployed edge function code.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

CANDIDATES=(
  # (a) Reaper-killed (2026-05-19 v4 controller btm36gdn6) — Datarova landed but
  # pending_action hit 6-min reaper before phase-a-think chained. Re-fire needed
  # to generate v4 concepts.
  "67a697cb-da80-4d77-8b71-d863ce8caa11"  # Berberine Phytosome / Berbevis
  "24883ee1-1d07-444a-a64b-092b8494b894"  # Horse chestnut aescin system

  # (b) Reddit-only failures — Datarova + science + 3 concepts already exist;
  # this re-fire just retries Reddit so we get pain_points + brand_landscape
  # + underserved_needs filled.
  "235e23a5-7504-4eb8-b139-7db6438f352f"  # Bifidobacterium longum / psychobiotic
  "fb9ad5bb-9bd1-4da4-b509-4ef966590c65"  # Holy basil ursolic acid / eugenol
  "ad8d11a8-2602-4629-9f6d-ade966c2b35b"  # Andrographis andrographolide
  "a90caca8-5460-4755-a74c-3c48a9c52901"  # MitoQ / targeted mitochondrial AOX
  "ad51726d-7626-4592-b500-3ee453bf2099"  # Butyrate / tributyrin postbiotic

  # (c) Not-yet-v4'd Atlas-named candidates — dr_clicks=0 today because their
  # technical names ("Bifidobacterium lactis / constipation-transit lane") don't
  # match buyer queries. v4 inference will translate them and unlock Datarova.
  "39a4dec8-0911-427f-a105-33cd7ef7ea6e"  # Bifidobacterium lactis / constipation
  "c3d273e2-9b9e-4e8e-8fc0-8417c5469517"  # B. infantis / IBS branded strain
  "4b14c03a-cea9-4bd7-8e69-eb0c0188631a"  # Mucuna pruriens L-DOPA
  "b0ed1cf6-1c1a-45cf-af46-8fe54c8fb0f2"  # Seaweed fucoidan / phlorotannin
  "b3e17c61-c8d4-4f98-9faa-a6b756bdb351"  # Bitter melon charantin
  "443e39d6-a05e-4c3a-84c5-1c994d658ad0"  # Cayenne capsaicinoid
  "fb113a59-dc0a-40b1-a8c0-30afdf9c674f"  # Milk thistle silymarin / silibin
  "61b7e34d-d705-4c36-9bd5-d80dd8764571"  # Goldenseal alkaloid
  "610d26c6-ad84-45c1-afb1-348f90002af3"  # Dandelion root taraxasterol / inulin
  "514daa42-489c-4a08-b5ad-185ec0574703"  # Reishi Mushroom Extract (low clicks, supplier spec exists)
)

echo "Audit follow-up: firing ${#CANDIDATES[@]} candidates serially via $SCRIPT_DIR/refire_phase_a_serial.sh"
"$SCRIPT_DIR/refire_phase_a_serial.sh" "${CANDIDATES[@]}"
