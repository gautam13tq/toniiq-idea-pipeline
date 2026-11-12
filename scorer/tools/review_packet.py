"""Review packet for the broker's blind check (12 Nov 2026). Usage: python3 tools/review_packet.py RUN_DIR [--out review]

Writes review/<run_id>/ (run_id = <shelf>__<date>__<hex>):
  shelf.json      the run's spec (what the shelf is), plus the shelf keyword and the rules version
  listings.json   the top 18 families by summed monthly-sold badge, plus near misses the gate held OUT that sell at
                  least as much as rank 12; asin, brand, title, bullets, image URL, monthly_sold, reviews.
                  NO scorer decisions, codes or reasons: this is the blind copy the judges see.
  RULES.md        shelf rulebook + Gautam's decisions + R1-R4 + the sleeve and growth rules + this shelf's own rules
  decisions.json  the scorer's decisions on the same rows (IN/OUT, gate code, front-of-pack rule, rank), for
                  tools/reconcile_review.py only. Judges must not be given this file.
"""
import argparse
import json
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from shelfscorer import config as K, gate_adapter as GA, steps as S  # noqa: E402
from shelfscorer.runlog import Run  # noqa: E402

N_TOP = 18
N_NEAR = 6


def readme_section(title):
    t = (ROOT / "README.md").read_text()
    m = re.search(r"^## " + re.escape(title) + r".*?(?=^## |\Z)", t, re.S | re.M)
    return m.group(0).strip() if m else ""


def fop_rules_doc():
    import shelfscorer.fop_rules as FR
    return (FR.__doc__ or "").strip()


def shelf_rules(spec):
    lines = [f"- Shelf keyword: **{spec['shelf_keyword']}**; scored on: {spec.get('scored_on')}"]
    for k, label in (("hero_regex", "Hero must be named (regex)"), ("hero_names", "Hero names"),
                     ("form", "Required form (regex)"), ("gate_format", "Required format"),
                     ("sleeve_kind", "Sleeve kind"), ("sleeve_regex", "Sleeve qualifier (regex)"),
                     ("audience", "Audience (R1/R4)"), ("modifier", "Modifier"), ("hero_exclude_regex", "Excluded (regex)"),
                     ("hero_strong_regex", "Unless also named (regex)"), ("must_out", "Always OUT (ASINs)")):
        if spec.get(k):
            lines.append(f"- {label}: `{spec[k]}`")
    lines.append("- Dose rule: if the front prints another ingredient at a bigger mg dose than the hero, the hero does "
                 "not lead (OUT). A printed total or blend weight is not another ingredient.")
    return "\n".join(lines)


def rules_md(spec):
    g = ROOT / "gate"
    parts = [f"# Rules for judging the shelf \"{spec['shelf_keyword']}\"",
             "Judge each listing in listings.json: IN if it is a genuine competitor on this shelf (a buyer searching "
             "the shelf keyword would see it as the same kind of product, the hero leads), else OUT. Answer per ASIN "
             "with IN or OUT and one line why.",
             "## This shelf", shelf_rules(spec),
             "## Gautam's front-of-pack rules (10 Nov 2026)", fop_rules_doc(),
             readme_section("Sleeve rule"), readme_section("Growth is a penalty"),
             "## Gautam's decisions (gate v11.3)", (g / "GAUTAM_DECISIONS_v113.md").read_text(),
             "## Gautam's decisions (28 Oct 2026)", (g / "GAUTAM_DECISIONS_2026-10-28.md").read_text(),
             "## Shelf rulebook", (g / "SHELF_RULEBOOK.md").read_text()]
    return "\n\n".join(p for p in parts if p) + "\n"


def build(run_dir, out_root):
    run = Run.load(run_dir)
    spec = run.read("spec.json")
    if not run.exists("ranking.json"):
        raise SystemExit(f"{run.run_id}: no ranking.json (run ended before ranking), no packet")
    fams = run.read("ranking.json")["families"]
    g = run.read("gate/decisions.json")
    dec = g["decisions"]
    manual = run.read("manual_decisions.json")["decisions"] if run.exists("manual_decisions.json") else {}
    prods = S.load_products(run, "product_pass1")
    if (run.dir / "keepa" / "product_pass2_0.json").exists():
        prods.update(S.load_products(run, "product_pass2"))
    top = run.read("top12.json") if run.exists("top12.json") else []
    top_ids = {f["family_id"] for f in top}
    cut = fams[K.SHELF_SIZE - 1]["monthly_sold"] if len(fams) >= K.SHELF_SIZE else 0

    def bullets(a):
        return list((prods.get(a) or {}).get("features") or [])

    listings, decisions = [], {}
    for i, f in enumerate(fams[:N_TOP]):
        a = f["primary_asin"]
        listings.append({"asin": a, "brand": f["brand"], "title": f["title"], "bullets": bullets(a), "image": f["image"],
                         "monthly_sold": f["monthly_sold"], "reviews": f["reviews"], "family_asins": f["asins"]})
        m = manual.get(f["family_id"]) or manual.get(a) or {}
        decisions[a] = {"scorer": "IN", "rank": i + 1, "in_top12": f["family_id"] in top_ids,
                        "gate_code": dec.get(f["family_id"], {}).get("code"), "source": f.get("decision_source"),
                        "fop_rule": m.get("rule"), "manual": m.get("decision") if m.get("source") in ("manual", "manual_fop") else None}
    near = []
    for a, d in dec.items():
        if d.get("include") or d.get("dup_of") or a not in prods:
            continue
        fld = GA.product_fields(prods[a])
        m = manual.get(a, {})
        if m.get("decision") == "IN":
            continue
        if cut and (fld["monthly_sold"] or 0) >= cut and re.search(spec["hero_regex"], fld["title"] or "", re.I):
            near.append((fld, d, m))
    near.sort(key=lambda t: -(t[0]["monthly_sold"] or 0))
    for fld, d, m in near[:N_NEAR]:
        a = fld["asin"]
        listings.append({"asin": a, "brand": fld["brand"], "title": fld["title"], "bullets": bullets(a), "image": fld["image"],
                         "monthly_sold": fld["monthly_sold"], "reviews": fld["reviews"], "family_asins": [a]})
        decisions[a] = {"scorer": "OUT", "rank": None, "in_top12": False, "gate_code": d.get("code"),
                        "source": m.get("source") or "gate", "fop_rule": m.get("rule"), "near_miss": True,
                        "manual": m.get("decision") if m.get("source") in ("manual", "manual_fop") else None}
    listings.sort(key=lambda x: -(x["monthly_sold"] or 0))      # badge order only: nothing tells IN from OUT
    out = Path(out_root) / run.run_id
    out.mkdir(parents=True, exist_ok=True)
    shelf = {"run_id": run.run_id, "shelf_keyword": spec["shelf_keyword"], "gate_version": GA.GATE_VERSION,
             "scorer_version": run.manifest().get("scorer_version"), "spec": spec}
    (out / "shelf.json").write_text(json.dumps(shelf, indent=1, ensure_ascii=False))
    (out / "listings.json").write_text(json.dumps({"run_id": run.run_id, "shelf_keyword": spec["shelf_keyword"],
                                                   "listings": listings}, indent=1, ensure_ascii=False))
    (out / "RULES.md").write_text(rules_md(spec))
    (out / "decisions.json").write_text(json.dumps({"run_id": run.run_id, "decisions": decisions}, indent=1, ensure_ascii=False))
    blind = json.dumps(json.loads((out / "listings.json").read_text()))
    assert not re.search(r'"(scorer|gate_code|decision|fop_rule|source|in_top12|rank)"', blind), "decision leaked into listings.json"
    return out, len(listings)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("runs", nargs="+")
    ap.add_argument("--out", default=str(ROOT / "review"))
    a = ap.parse_args()
    for r in a.runs:
        o, n = build(r, a.out)
        print(f"{o} ({n} listings)")
