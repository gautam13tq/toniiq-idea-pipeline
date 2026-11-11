"""Parent shelves only (sleeves use tools/sleeve_terms.py): pick the demand keyword and demand cluster from Datarova.

Usage: python3 tools/demand_terms.py <spec.json> <log.json> "parent candidate 1" "parent candidate 2" ...

- Parent candidates are head terms that are just the ingredient (e.g. "colostrum", "mastic gum", "ginseng").
  A candidate counts only if it matches hero_regex (and the spec's form, if any). The demand keyword is the one
  with the most clicks in the latest month.
- The demand cluster is every keyword with data among the parent candidates, their format/dose/audience variants
  and the lane cluster, that matches hero_regex (and form), largest first, up to 44 with the lane cluster.
- Writes demand_keyword and demand_cluster into the spec and every candidate's clicks into the log.
"""
import json
import re
import sys
import time
import urllib.error
import urllib.parse

sys.path.insert(0, __import__("os").path.dirname(__import__("os").path.dirname(__import__("os").path.abspath(__file__))))
from shelfscorer import clients, keys, config as K  # noqa: E402
from shelfscorer.steps import month_window  # noqa: E402

MODS = ["supplement", "supplements", "capsules", "pills", "tablets", "powder", "gummies", "liquid", "drops", "extract",
        "softgels", "for women", "for men", "for kids", "organic", "500mg", "1000mg", "chewable", "tea", "complex"]


def pull(kws, start, end):
    out = {}
    for i in range(0, len(kws), K.DATAROVA_BATCH):
        q = {"marketplace": "US", "keywords": ",".join(kws[i:i + K.DATAROVA_BATCH]), "start_date": start, "end_date": end,
             "interval": "monthly"}
        for t in range(6):
            try:
                r = clients._http(f"{K.DATAROVA_BASE}/keywords?" + urllib.parse.urlencode(q),
                                  headers={"Authorization": f"Bearer {keys.get('datarova')}"})
                break
            except urllib.error.HTTPError as e:
                if e.code != 429 or t == 5:
                    raise
                time.sleep(20 * (t + 1))
        time.sleep(2)
        for x in (r.get("data") or {}).get("keywords") or []:
            rec = sorted(x.get("records") or [], key=lambda r: r.get("date") or r.get("start_date"))
            out[x["keyword"].lower()] = (rec[-1].get("clicks") or 0, rec[-1].get("date") or rec[-1].get("start_date")) if rec else (0, None)
    return out


def main(spec_path, log_path, parents):
    s = json.load(open(spec_path))
    H = re.compile(s["hero_regex"], re.I)
    form = re.compile(s["form"], re.I) if s.get("form") else None
    ok = lambda k: bool(H.search(k)) and (form is None or bool(form.search(k)))
    parents = [p for p in parents if ok(p)]
    variants = [f"{p} {m}" for p in parents for m in MODS]
    cands = list(dict.fromkeys(parents + variants + s["cluster_keywords"]))
    start, end = month_window()
    data = pull(cands, start, end)
    clicks = {k: data.get(k.lower(), (0, None))[0] for k in cands}
    dk = max(parents, key=lambda p: clicks[p])
    with_data = sorted([k for k in cands if clicks[k] > 0 and ok(k)], key=lambda k: -clicks[k])
    lane = list(s["cluster_keywords"])
    room = K.DEMAND_PULL_MAX - len(set(lane) | {dk})
    cl = [dk] + [k for k in with_data if k != dk and k not in lane][:max(0, room)]
    s["demand_keyword"], s["demand_cluster"] = dk, cl
    json.dump(s, open(spec_path, "w"), indent=1)
    log = {"window": [start, end], "parent_candidates": {p: clicks[p] for p in parents}, "demand_keyword": dk,
           "why": f"highest latest-month clicks among head terms that are just the ingredient ({clicks[dk]:,})",
           "lane_keyword": s["shelf_keyword"], "lane_clicks": clicks.get(s["shelf_keyword"], 0),
           "demand_cluster": {k: clicks[k] for k in cl}, "cluster_clicks": sum(clicks[k] for k in set(cl) | set(lane)),
           "no_data": [k for k in cands if clicks[k] == 0]}
    json.dump(log, open(log_path, "w"), indent=1)
    print(s["shelf_keyword"], "->", dk, clicks[dk], "| lane", log["lane_clicks"], "| cluster", log["cluster_clicks"], len(cl))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], sys.argv[3:])
