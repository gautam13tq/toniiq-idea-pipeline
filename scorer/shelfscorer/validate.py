"""validate_run: recompute every number from the raw files and check every required call and artifact.
Any BLOCKER failure means no score is written (write_score refuses)."""
import datetime as dt
import json

from . import config as K, pillars as P
from .runlog import sha

REQ_ARTIFACTS = ["spec.json", "datarova/merged_keywords.json", "demand_growth.json", "candidates.json",
                 "keepa/pass1_index.json", "gate/decisions.json", "families.json", "ranking.json", "top12.json",
                 "competition.json", "diff.json", "crosschecks.json", "score.json"]


def validate(run):
    out = []

    def chk(code, ok, detail="", sev="BLOCKER"):
        out.append({"check": code, "severity": sev, "pass": bool(ok), "detail": detail})

    m = run.manifest()
    calls = run.calls()
    s = run.read("spec.json")
    ineligible = not m.get("eligible_after_demand", True)
    req = REQ_ARTIFACTS[:3] + ["score.json"] if ineligible else REQ_ARTIFACTS
    miss = [a for a in req if not run.exists(a)]
    chk("V-ARTIFACTS", not miss, f"missing {miss}")
    bad_sha = [a for a, h in m["artifacts"].items() if run.exists(a) and sha((run.dir / a).read_bytes()) != h]
    chk("V-SHA", not bad_sha, f"changed after write: {bad_sha}")
    steps_needed = ["spec", "datarova", "demand_growth"] + ([] if ineligible else
                   ["discover", "keepa_pass1", "gate", "collapse", "rank_fop", "keepa_pass2", "competition", "diff", "crosscheck"]) + ["score"]
    failed = [n for n in steps_needed if not m["steps"].get(n, {}).get("pass")]
    chk("V-STEPS", not failed, f"steps not passed: {failed}")
    # spec before data
    first_call = min((c["ts"] for c in calls), default=None)
    chk("V-SPEC-ORDER", first_call is None or s["written_at"] <= first_call, f"spec {s['written_at']} first call {first_call}")
    # required calls (V-CALLS)
    tools = {(c["tool"], c["endpoint"]) for c in calls if c.get("ok")}
    need = [("datarova", "/keywords")]
    if not ineligible:
        need += [("apify", K.APIFY_ACTOR), ("keepa", "/query"), ("keepa", "/search"), ("keepa", "/product"),
                 ("anthropic", "/v1/messages")]
    chk("V-CALLS", all(n in tools for n in need), f"missing calls: {[n for n in need if n not in tools]}")
    # freshness I9
    now = dt.datetime.now(dt.timezone.utc)
    old = [c["ts"] for c in calls if (now - dt.datetime.fromisoformat(c["ts"])).days > K.MAX_DATA_AGE_DAYS]
    chk("I9-FRESH", not old, f"{len(old)} calls older than {K.MAX_DATA_AGE_DAYS} days")
    # D and G recompute (V-DG) and V-KW
    kw = run.read("datarova/merged_keywords.json")["keywords"]
    dg2 = P.demand_growth(kw, s["shelf_keyword"], s["cluster_keywords"])
    dg = run.read("demand_growth.json")
    chk("V-DG", abs(dg2["D"] - dg["D"]) < 0.01 and abs(dg2["G"] - dg["G"]) < 0.01, f"stored D {dg['D']} G {dg['G']} recomputed D {dg2['D']} G {dg2['G']}")
    chk("V-KW", dg["primary_kw"].lower() == s["shelf_keyword"].lower(), "demand primary must be the shelf keyword")
    sc = run.read("score.json")
    if not ineligible:
        cand = run.read("candidates.json")
        kinds = {w.split(":")[0] for v in cand["candidates"].values() for w in v}
        chk("V-CAND", len(cand["candidates"]) >= K.MIN_CANDIDATES and {"apify", "keepa_finder", "keepa_search", "datarova_top3"} <= kinds,
            f"{len(cand['candidates'])} candidates, sources {sorted(kinds)}")
        chk("C1-WINNERS", set(cand["datarova_top3"]) <= set(cand["candidates"]), "every Datarova top-3 ASIN is a candidate")
        g = run.read("gate/decisions.json")
        dec = g["decisions"]
        unsure = sum(1 for d in dec.values() if d["verdict3"] == "UNSURE")
        fb = sum(1 for d in dec.values() if d.get("judge_fallback"))
        chk("V-GATE", fb == 0 and unsure == g["judge_calls"], f"unsure {unsure}, judge calls {g['judge_calls']}, fallback {fb}")
        judge_logged = sum(1 for c in calls if c["tool"] == "anthropic" and str(c["query"].get("label", "")).startswith("judge_"))
        chk("V-JUDGE-LOG", judge_logged >= g["judge_calls"], f"{judge_logged} logged judge calls vs {g['judge_calls']}")
        fams = run.read("ranking.json")["families"]
        top = run.read("top12.json")
        asins = [a for f in fams for a in f["asins"]]
        chk("V-FAM", len(asins) == len(set(asins)), "no ASIN in two families")
        order = [(-(f["monthly_sold"] or 0), f["best_rank90"] or 9e9) for f in fams]
        chk("I7-RANK", order == sorted(order), "ranked by badge sum then 90-day rank")
        chk("V-TOP12", [f["family_id"] for f in top] == [f["family_id"] for f in fams[:K.SHELF_SIZE]], "top12 = first 12 families")
        man = run.read("manual_decisions.json")["decisions"] if run.exists("manual_decisions.json") else {}
        open_checks = [f["family_id"] for f in top if man.get(f["family_id"], {}).get("decision") == "NEEDS_CHECK"]
        chk("V-FOP", not open_checks, f"[NEEDS CHECK] in top 12: {open_checks}")
        c = run.read("competition.json")
        c2 = P.competition(fams, fams[:K.SHELF_SIZE])
        chk("V-COMP", abs(c2["C"] - c["C"]) < 0.001 and abs(c2["moat"] - c["moat"]) < 0.001, f"stored C {c['C']} recomputed {c2['C']}")
        d = run.read("diff.json")
        dcalls = [run.read(f"diff/call_{i}.json") for i in (1, 2, 3) if run.exists(f"diff/call_{i}.json")]
        chk("V-DIFF", len(dcalls) >= 2 and all(x.get("prompt_sha") for x in dcalls), f"{len(dcalls)} diff calls")
        sc2 = sorted(x["score"] for x in dcalls)
        exp = sc2[1] if len(dcalls) == 3 else sum(sc2) / 2
        chk("V-DIFF-AGG", abs(exp - d["score"]) < 1e-6, f"diff {d['score']} expected {exp}")
        r = P.composite(dg["D"], dg["G"], c["C"], d["score"], demand_ok=dg["demand_gate"]["pass"], n_kept=c["n_kept"],
                        n_sig=m.get("n_sig", c["n_sig"]), moat=c["moat"])
        chk("V-SCORE", abs(r["raw"] - sc["raw"]) < 0.01 and r["score"] == sc["score"] and set(r["soft"]) <= set(sc["soft"]),
            f"stored {sc['score']} recomputed {r['score']}")
        x = run.read("crosschecks.json")
        chk("X1-WINNER-GAP", "winner_gap" not in x["flags"], "a Datarova click winner is not in the top 12 (read its gate reason)", sev="WARN")
        chk("PAGE-PRESENCE", "shelf_page_mismatch" not in x["flags"], f"{x['page_presence']} of 12 on pages 1-2", sev="WARN")
    cap = m.get("shelf_cap_usd", K.DEFAULT_SHELF_CAP_USD)
    chk("V-COST", m["cost_usd"] <= cap, f"${m['cost_usd']} vs cap ${cap}", sev="WARN")
    rep = {"run_id": run.run_id, "validated_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
           "blockers_failed": sum(1 for o in out if o["severity"] == "BLOCKER" and not o["pass"]), "checks": out}
    run.save("EVAL_REPORT.json", rep)
    md = ["# Validation report " + run.run_id, ""] + [f"- {'PASS' if o['pass'] else 'FAIL'} [{o['severity']}] {o['check']}: {o['detail']}" for o in out]
    run.save("EVAL_REPORT.md", "\n".join(md) + "\n")
    return rep
