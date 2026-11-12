#!/usr/bin/env python3
"""Score one shelf with the agreed scorer. Usage:
  run_shelf.py new <spec.json> --idea <id> --runs <dir> [--cap 2.0] [--allow-no-apify]   # opens a run (step 0-1)
  run_shelf.py go <run_dir>                                            # runs every remaining step, resumable
  run_shelf.py validate <run_dir>                                      # recompute and check everything
  run_shelf.py publish <run_dir>                                       # write the score (refuses on any BLOCKER)
Every step must pass before the next starts. There is no flag to skip a step."""
import argparse
import getpass
import json
import sys

from shelfscorer import steps as S, validate as V, write_score as W
from shelfscorer.runlog import Run, StepFailed, now

ORDER = [("datarova", S.step_datarova), ("demand_growth", S.step_demand_growth), ("discover", S.step_discover),
         ("keepa_pass1", S.step_keepa1), ("gate", S.step_gate), ("collapse", S.step_collapse),
         ("rank_fop", S.step_rank_fop), ("keepa_pass2", S.step_keepa2), ("competition", S.step_competition),
         ("diff", S.step_diff), ("crosscheck", S.step_crosscheck), ("score", S.step_score)]


def go(run):
    for name, fn in ORDER:
        st = run.manifest()["steps"].get(name)
        if st and st["pass"]:
            continue
        print(f"[{now()}] step {name}", flush=True)
        fn(run)
        if name == "demand_growth" and not run.manifest().get("eligible_after_demand"):
            dg = run.read("demand_growth.json")
            why = "demand gate failed" if not dg["demand_gate"]["pass"] else "D < 3"
            S.score_ineligible(run, why)
            return


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["new", "go", "validate", "publish"])
    ap.add_argument("path")
    ap.add_argument("--idea")
    ap.add_argument("--runs", default="runs")
    ap.add_argument("--cap", type=float, default=2.0)
    ap.add_argument("--allow-no-apify", action="store_true",
                    help="opt-in: if Apify answers 401, use Keepa search for page 1 and flag the score no_apify_page1")
    a = ap.parse_args()
    try:
        if a.cmd == "new":
            spec = json.load(open(a.path))
            spec.setdefault("written_at", now())
            r = Run.open(a.runs, a.idea, spec["shelf_keyword"], getpass.getuser(), {"shelf_cap_usd": a.cap, "allow_no_apify": a.allow_no_apify})
            r.step_done("open", "V-OPEN", True)
            S.step_spec(r, spec)
            print(r.dir)
        else:
            r = Run.load(a.path)
            if a.cmd == "go":
                go(r)
                rep = V.validate(r)
                print(json.dumps({"score": r.read("score.json"), "blockers_failed": rep["blockers_failed"]}, indent=1))
            elif a.cmd == "validate":
                rep = V.validate(r)
                print(f"blockers failed: {rep['blockers_failed']}")
            else:
                print(json.dumps(W.publish(r), indent=1))
    except (StepFailed, W.Refused) as e:
        print(f"STOPPED: {e}", file=sys.stderr)
        sys.exit(2)


if __name__ == "__main__":
    main()
