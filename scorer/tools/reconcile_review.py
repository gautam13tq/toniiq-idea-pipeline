"""Reconcile the blind judges with the scorer. Usage:
  python3 tools/reconcile_review.py review/<run_id> [judge files...]
Judge files default to every review/<run_id>/judge_*.json. Each judge file: {"judge": "grok", "verdicts":
{"<asin>": {"decision": "IN"|"OUT", "why": "..."}}} (a bare {"<asin>": "IN"} map is accepted too).
Writes reconcile.json next to them: every row where any judge disagrees with the scorer, or a judge left a row out.
Only these rows go to a hand check. Exit code 0 when all agree, 1 when there is anything to check."""
import json
import sys
from pathlib import Path


def load_judge(p):
    d = json.loads(Path(p).read_text())
    name = d.get("judge") or Path(p).stem.replace("judge_", "")
    v = d.get("verdicts", d)
    out = {}
    for a, x in v.items():
        dec = x if isinstance(x, str) else (x or {}).get("decision")
        out[a] = {"decision": (dec or "").upper() or None, "why": None if isinstance(x, str) else (x or {}).get("why")}
    return name, out


def main():
    folder = Path(sys.argv[1])
    files = sys.argv[2:] or sorted(str(p) for p in folder.glob("judge_*.json"))
    dec = json.loads((folder / "decisions.json").read_text())["decisions"]
    listings = {x["asin"]: x for x in json.loads((folder / "listings.json").read_text())["listings"]}
    judges = dict(load_judge(f) for f in files)
    rows = []
    for a, d in dec.items():
        votes = {j: v.get(a) for j, v in judges.items()}
        disagree = [j for j, v in votes.items() if not v or v["decision"] != d["scorer"]]
        if disagree:
            rows.append({"asin": a, "title": listings.get(a, {}).get("title"), "brand": listings.get(a, {}).get("brand"),
                         "monthly_sold": listings.get(a, {}).get("monthly_sold"), "scorer": d["scorer"], "scorer_detail": d,
                         "judges": votes, "disagreeing": disagree})
    res = {"run_id": json.loads((folder / "shelf.json").read_text())["run_id"], "judges": sorted(judges),
           "rows": len(dec), "to_check": len(rows), "check": rows}
    (folder / "reconcile.json").write_text(json.dumps(res, indent=1, ensure_ascii=False))
    print(f"{res['run_id']}: {len(rows)} of {len(dec)} rows to check (judges {', '.join(sorted(judges)) or 'none'})")
    sys.exit(1 if rows else 0)


if __name__ == "__main__":
    main()
