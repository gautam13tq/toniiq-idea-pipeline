#!/usr/bin/env python3
"""Score one shelf with the agreed scorer. Usage:
  run_shelf.py new <spec.json> --idea <id> --runs <dir> [--cap 2.0]   # opens a run and records the spec (step 0-1)
  run_shelf.py go <run_dir>                                            # runs every remaining step, resumable
  run_shelf.py validate <run_dir>                                      # recompute and check everything
  run_shelf.py publish <run_dir>                                       # write the score (refuses on any BLOCKER)
Every step must pass before the next starts. There is no flag to skip a step."""
import argparse
import getpass
import json
import sys

from shelfscorer import lanes as L, steps as S, validate as V, write_score as W
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
            why = "demand gate failed" if not dg["demand_gate"]["pass"] else ("D < 3" if dg["D"] < 3 else "G < 1")
            S.score_ineligible(run, why)
            return


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["new", "go", "validate", "publish", "fallback"])
    ap.add_argument("path")
    ap.add_argument("--idea")
    ap.add_argument("--runs", default="runs")
    ap.add_argument("--cap", type=float, default=2.0)
    a = ap.parse_args()
    try:
        if a.cmd == "new":
            spec = json.load(open(a.path))
            spec.setdefault("written_at", now())
            r = Run.open(a.runs, a.idea, spec["shelf_keyword"], getpass.getuser(), {"shelf_cap_usd": a.cap})
            r.step_done("open", "V-OPEN", True)
            S.step_spec(r, spec)
            print(r.dir)
        else:
            r = Run.load(a.path)
            if a.cmd == "go":
                go(r)
                rep = V.validate(r)
                print(json.dumps({"score": r.read("score.json"), "blockers_failed": rep["blockers_failed"]}, indent=1))
            elif a.cmd == "fallback":
                # Lane too thin -> open a parent-shelf run (scored_on=parent). Prints the new run dir, or "none".
                spec, m = r.read("spec.json"), r.manifest()
                sc = r.read("score.json") if r.exists("score.json") else {}
                sc = sc.get("score", sc) if isinstance(sc.get("score"), dict) else sc
                if not L.needs_parent_fallback(spec, sc, m.get("n_sig")):
                    print("none")
                    return
                ps = L.parent_spec(spec, m["run_id"], now())
                r2 = Run.open(str(r.dir.parent), m.get("idea_id"), ps["shelf_keyword"], getpass.getuser(),
                              {"shelf_cap_usd": m.get("shelf_cap_usd", a.cap), "scored_on": "parent", "lane_run": m["run_id"]})
                r2.step_done("open", "V-OPEN", True)
                S.step_spec(r2, ps)
                print(r2.dir)
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
