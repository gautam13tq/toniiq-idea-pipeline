"""Pre-register a sleeve: its cluster of phrasings and the default-format check (sleeve rule, Gautam 11 Nov 2026).

Usage: python3 tools/sleeve_terms.py <spec.json> <log.json> [--prereg-runs <dir>] [--no-default-check]

The spec must say scored_on = "sleeve", sleeve_kind (format | dose | audience | variety | pairing), sleeve_regex
(what every phrasing must contain besides the hero), hero_names (how buyers name the hero) and parent_keyword.

1. Candidates: hero names x sleeve words x modifiers in both word orders (sleeves.candidate_phrasings), the spec's
   cluster, and Amazon autocomplete for the sleeve stems. Datarova has no related-keywords endpoint, so autocomplete is
   where new phrasings come from. Every candidate must pass sleeves.phrasing_ok.
2. Datarova: latest-month clicks and the 12-month trend for every candidate and for the parent (context only).
   The sleeve cluster is every phrasing with data, largest first, within the 44-keyword pull.
3. Default format (format sleeves only): Keepa finder on the parent keyword, the parent's top 12 by monthly-sold badge
   (hero named, one row per parent ASIN), share in the sleeve's format. At 75%+ the spec becomes the parent
   (scored_on = parent_default_format) using the spec's demand_cluster as the parent cluster.
Every call is logged in a pre-registration run folder (calls.jsonl, raw files, cost).
"""
import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from shelfscorer import clients, keys, config as K, sleeves as SL, gate_adapter as GA  # noqa: E402
from shelfscorer.runlog import Run, now  # noqa: E402
from shelfscorer.steps import month_window  # noqa: E402

AC_URL = "https://completion.amazon.com/api/2017/suggestions"


def autocomplete(run, prefix):
    def fn():
        q = {"mid": "ATVPDKIKX0DER", "alias": "aps", "prefix": prefix}
        return clients._http(AC_URL + "?" + urllib.parse.urlencode(q), timeout=30)
    try:
        r = run.call("amazon", "/autocomplete", {"prefix": prefix}, fn, raw_rel=f"autocomplete/{prefix.replace(' ', '_')}.json",
                     rows_fn=lambda r: len(r.get("suggestions") or []))
    except Exception:
        return []
    return [s.get("value") for s in r.get("suggestions") or [] if s.get("value")]


def datarova(run, kws, start, end):
    out = {}
    for i in range(0, len(kws), K.DATAROVA_BATCH):
        batch = kws[i:i + K.DATAROVA_BATCH]
        for t in range(6):
            try:
                r = clients.datarova_keywords(run, batch, start, end, f"keywords_{i // K.DATAROVA_BATCH}")
                break
            except urllib.error.HTTPError as e:
                if e.code != 429 or t == 5:
                    raise
                time.sleep(20 * (t + 1))
            except RuntimeError as e:
                if "429" not in str(e) or t == 5:
                    raise
                time.sleep(20 * (t + 1))
        time.sleep(2)
        for x in (r.get("data") or {}).get("keywords") or []:
            rec = sorted(x.get("records") or [], key=lambda r: r.get("date") or r.get("start_date"))
            if rec:
                out[x["keyword"].lower()] = [(r.get("date") or r.get("start_date"), r.get("clicks") or 0) for r in rec]
    return out


def trend(series):
    """Latest clicks, clicks 12 months earlier, and the change in %."""
    if not series:
        return 0, None, None
    last = series[-1][1]
    first = series[0][1] if len(series) >= 13 else None
    pct = round((last - first) / first * 100, 1) if first else None
    return last, first, pct


def parent_top12(run, spec):
    pk = spec["parent_keyword"]
    sel = {"title": pk, "perPage": 100, "page": 0, "sort": [["current_SALES", "asc"]], "productType": [0, 1, 2],
           "rootCategory": [K.KEEPA_ROOT_CATEGORY]}
    d = clients.keepa(run, "query", {"domain": K.KEEPA_DOMAIN, "selection": json.dumps(sel)}, "parent_finder")
    asins = (d.get("asinList") or [])[:60]
    prods = {}
    if asins:
        r = clients.keepa(run, "product", {"domain": K.KEEPA_DOMAIN, "asin": ",".join(asins)}, "parent_products")
        prods = {p["asin"]: p for p in r.get("products") or [] if p.get("asin")}
    rows = {}
    for a in asins:
        p = prods.get(a)
        if not p:
            continue
        f = GA.product_fields(p)
        t = f["title"]
        if not re.search(spec["hero_regex"], t, re.I):
            continue
        if spec.get("form") and not re.search(spec["form"], t, re.I):
            continue
        if spec.get("hero_exclude_regex") and re.search(spec["hero_exclude_regex"], t, re.I):
            continue
        key = f.get("parent") or a
        row = {"asin": a, "title": t, "brand": f["brand"], "monthly_sold": f["monthly_sold"] or 0}
        if key not in rows or row["monthly_sold"] > rows[key]["monthly_sold"]:
            rows[key] = row
    return sorted(rows.values(), key=lambda x: -x["monthly_sold"])[:K.SHELF_SIZE]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("spec")
    ap.add_argument("log")
    ap.add_argument("--prereg-runs", default="runs_prereg")
    ap.add_argument("--no-default-check", action="store_true")
    ap.add_argument("--report-only", action="store_true", help="log the cluster, leave the spec unchanged")
    a = ap.parse_args()
    s = json.load(open(a.spec))
    assert s.get("scored_on") == "sleeve", "spec must be a sleeve (scored_on = sleeve)"
    run = Run.open(a.prereg_runs, "prereg", s["shelf_keyword"] + " prereg", "sleeve_terms", {"shelf_cap_usd": 1.0})
    # 1. candidates
    words = list(s.get("sleeve_words") or SL.FORMAT_WORDS.get(s.get("gate_format"), []) if s.get("sleeve_kind") == "format"
                 else s.get("sleeve_words") or [])
    stems = [s["shelf_keyword"]] + [f"{h} {w}" for h in s.get("hero_names") or [] for w in words[:4]]
    stems += [f"{w} {h}" for h in s.get("hero_names") or [] for w in words if w.endswith("ed")]
    ac = []
    for st in dict.fromkeys(stems):
        ac += autocomplete(run, st)
        time.sleep(0.5)
    cands = SL.candidate_phrasings(s, ac)
    # 2. Datarova
    start, end = month_window()
    ctx = [s["parent_keyword"]] if s.get("parent_keyword") else []
    data = datarova(run, cands + [c for c in ctx if c not in cands], start, end)
    rows = {k: trend(data.get(k)) for k in cands}
    with_data = sorted([k for k in cands if rows[k][0] > 0], key=lambda k: -rows[k][0])
    lane = [k.lower() for k in s["cluster_keywords"]]
    room = K.DEMAND_PULL_MAX - len(set(lane)) - len(ctx)
    cluster = list(dict.fromkeys([s["shelf_keyword"].lower()] + [k for k in with_data if k not in lane][:max(0, room)] +
                                 [k for k in lane if k in with_data]))
    cluster = [k for k in cluster if rows.get(k, (0,))[0] > 0 or k == s["shelf_keyword"].lower()]
    tot_last = sum(rows[k][0] for k in cluster if k in rows)
    both = [k for k in cluster if k in rows and rows[k][1]]          # 12-month trend on phrasings with both months
    tot_first = sum(rows[k][1] for k in both) or None
    tot_last_both = sum(rows[k][0] for k in both)
    par = trend(data.get(s["parent_keyword"].lower())) if s.get("parent_keyword") else None
    log = {"written_at": now(), "prereg_run": str(run.dir), "window": [start, end], "shelf_keyword": s["shelf_keyword"],
           "sleeve_kind": s.get("sleeve_kind"), "sleeve_regex": s.get("sleeve_regex"),
           "autocomplete_suggestions": sorted(set(x.lower() for x in ac)),
           "candidates_checked": len(cands),
           "sleeve_cluster": {k: {"clicks": rows[k][0], "clicks_12m_ago": rows[k][1], "trend_12m_pct": rows[k][2]}
                              for k in cluster if k in rows},
           "cluster_clicks": tot_last, "cluster_rows": sum(1 for k in cluster if rows.get(k, (0,))[0] > 0),
           "cluster_clicks_12m_ago": tot_first,
           "cluster_trend_12m_pct": round((tot_last_both - tot_first) / tot_first * 100, 1) if tot_first else None,
           "cluster_trend_basis": f"{len(both)} phrasings with data in both months",
           "parent_context": {"keyword": s.get("parent_keyword"), "clicks": par[0] if par else None,
                              "trend_12m_pct": par[2] if par else None},
           "no_data": [k for k in cands if rows[k][0] == 0]}
    ok, why = SL.sleeve_gate(log["cluster_clicks"], log["cluster_rows"])
    log["sleeve_gate_part1"] = {"pass": ok, "why": why}
    # 3. default format
    s2 = dict(s, sleeve_cluster=cluster)
    if s.get("sleeve_kind") == "format" and s.get("parent_keyword") and not a.no_default_check:
        top = parent_top12(run, s)
        share, frows = SL.default_format_share(top, s["gate_format"])
        log["default_format"] = {"parent": s["parent_keyword"], "share": round(share, 3), "threshold": K.DEFAULT_FORMAT_SHARE,
                                 "is_default": SL.is_default_format(s, share), "parent_top12": frows,
                                 "parent_top12_badges": sum(r["monthly_sold"] for r in frows)}
        if log["default_format"]["is_default"]:
            s2 = SL.parent_default_spec(s, s.get("demand_cluster") or [s["parent_keyword"]], share, now())
    log["scored_on"] = s2["scored_on"]
    log["cost_usd"] = run.manifest()["cost_usd"]
    log["keepa_tokens"] = run.manifest()["keepa_tokens"]
    if not a.report_only:
        s2["written_at"] = now()
        json.dump(s2, open(a.spec, "w"), indent=1)
    json.dump(log, open(a.log, "w"), indent=1)
    df = log.get("default_format")
    print(f"{s['shelf_keyword']}: cluster {tot_last:,} over {log['cluster_rows']} rows "
          f"(12m {log['cluster_trend_12m_pct']}%) | parent {log['parent_context']} | "
          f"default {df['share'] if df else '-'} -> {s2['scored_on']} | gate1 {why}")


if __name__ == "__main__":
    main()
