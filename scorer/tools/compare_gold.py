"""Compare one run's gate decisions with Grok's hand-labelled gold set (gold_set_v7, 28 Oct 2026) on the ASINs both saw.
Usage: python3 tools/compare_gold.py RUN_DIR SHELF [golden/gold_set_v7.json]
Gold 'in' includes EX_VARIANT_DUP rows (in-shelf, collapsed). Prints agreement and every disagreement."""
import json
import sys
from pathlib import Path

run, shelf = Path(sys.argv[1]), sys.argv[2]
gold_p = sys.argv[3] if len(sys.argv) > 3 else str(Path(__file__).resolve().parent.parent / "golden" / "gold_set_v7.json")
gold = {l["asin"]: l for l in json.load(open(gold_p))["listings"] if l["shelf"] == shelf}
dec = json.load(open(run / "gate" / "decisions.json"))
man = json.load(open(run / "manual_decisions.json"))["decisions"] if (run / "manual_decisions.json").exists() else {}
out, agree, rows = [], 0, 0
for a, g in gold.items():
    d = dec["decisions"].get(a)
    if d is None:
        continue
    rows += 1
    ours = bool(d.get("include")) or bool(d.get("dup_of"))
    m = man.get(a, {}).get("decision")
    if m in ("IN", "OUT"):
        ours = m == "IN"
    theirs = g.get("label") == "in" or g.get("code") == "EX_VARIANT_DUP"
    if ours == theirs:
        agree += 1
    else:
        out.append({"asin": a, "gold": g.get("label"), "gold_code": g.get("code"), "ours": "in" if ours else "out",
                    "our_code": d.get("code"), "title": (g.get("title") or "")[:90]})
res = {"shelf": shelf, "gold_rows": len(gold), "overlap": rows, "agree": agree,
       "agreement": round(agree / rows, 3) if rows else None, "disagreements": out}
(run / "gold_compare.json").write_text(json.dumps(res, indent=1))
print(json.dumps(res, indent=1))
