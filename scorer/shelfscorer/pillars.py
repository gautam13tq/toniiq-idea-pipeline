"""Pure scoring maths. No I/O. Every function here is re-run by the validator from raw files.

Sources: scoring_core.ts (computeDemandPillar L883, computeGrowthPillar L917, computeCompetitivePillar L973),
an_cluster.py / an_screen.py (Grok), c74.py (C_v8 and blend). Spec sections 3.1, 3.2, 3.5, 3.7.
"""
import math
import statistics
from . import config as K


# ---------------- Demand (3.1) ----------------
def rec_month(r):
    return r.get("start_date") or r.get("date")


def keyword_rows(datarova_keywords, cluster):
    """datarova_keywords: list of {keyword, records:[{start_date|date, clicks, sales}]}. Returns per-keyword latest rows
    for cluster keywords that have data, plus monthly cluster totals {month: [clicks, sales]}."""
    want = {k.lower() for k in cluster}
    rows, tot = [], {}
    for k in datarova_keywords:
        if k["keyword"].lower() not in want:
            continue
        rec = sorted(k.get("records") or [], key=rec_month)
        if not rec or not any((r.get("clicks") or 0) for r in rec):
            continue
        for r in rec:
            a = tot.setdefault(rec_month(r), [0, 0])
            a[0] += r.get("clicks") or 0
            a[1] += r.get("sales") or 0
        L = rec[-1]
        rows.append({"keyword": k["keyword"], "clicks": L.get("clicks") or 0, "sales": L.get("sales") or 0,
                     "month": rec_month(L)})
    rows.sort(key=lambda r: -r["clicks"])
    return rows, tot


def demand_gate(primary_clicks, n_rows, cluster_clicks):
    if primary_clicks < K.DEMAND_MIN_PRIMARY:
        return False, f"primary {primary_clicks} < {K.DEMAND_MIN_PRIMARY} clicks"
    if n_rows >= 5:
        return True, "rows >= 5"
    if primary_clicks >= 1000 and n_rows >= 2:
        return True, "primary >= 1,000 with >= 2 rows"
    if cluster_clicks >= 5000 and n_rows >= 2:
        return True, "cluster >= 5,000 with >= 2 rows"
    return False, f"only {n_rows} keyword rows with data"


def demand_score(primary_clicks, cluster_clicks, cvr_pct):
    a = 4 if primary_clicks >= 1e5 else 3 if primary_clicks >= 1e4 else 2 if primary_clicks >= 1e3 else 1 if primary_clicks >= 100 else 0
    b = 3 if cluster_clicks >= 2e5 else 2 if cluster_clicks >= 5e4 else 1 if cluster_clicks >= 1e4 else 0
    c = 3 if cvr_pct >= 30 else 2 if cvr_pct >= 20 else 1 if cvr_pct >= 15 else 0
    return a, b, c, a + b + c


# ---------------- Growth (3.2), an_screen.py growth/ws ----------------
def growth_windows(tot):
    m = sorted(tot)
    nz = [i for i, x in enumerate(m) if tot[x][0] > 0]
    if not nz:
        return None, None, None
    li = max(nz)

    def w(n):
        if li < n:
            return None
        r = m[li - n + 1:li + 1]
        p = m[max(0, li - 2 * n + 1):li - n + 1]
        if not p:
            return None
        a = sum(tot[x][0] for x in r) / len(r)
        b = sum(tot[x][0] for x in p) / len(p)
        return round((a - b) / b * 100, 1) if b > 0 else None

    y = None
    if li >= 12 and tot[m[li - 12]][0] > 0:
        y = round((tot[m[li]][0] - tot[m[li - 12]][0]) / tot[m[li - 12]][0] * 100, 1)
    return w(3), w(6), y


def ws(p):
    if p is None:
        return 4
    return 10 if p > 100 else 8 if p > 50 else 6 if p > 20 else 4 if p > 0 else 2 if p > -20 else 0


def growth_score(g3, g6, yoy):
    return round(0.4 * ws(g3) + 0.3 * ws(g6) + 0.3 * ws(yoy), 4)


def demand_terms(spec):
    """Sleeve rule (Gautam, 11 Nov 2026), see sleeves.py.
    Sleeve (scored_on = sleeve): primary = the shelf keyword, cluster = every Datarova phrasing of the same sleeve
    (spec sleeve_cluster, pre-registered by tools/sleeve_terms.py) plus the spec's own cluster.
    Parent (a plain-ingredient shelf, or a sleeve whose format is the parent's default): primary = demand_keyword
    (the parent head term), cluster = demand_cluster plus the spec's cluster. Older specs fall back to the shelf keyword.
    Capped at K.DEMAND_PULL_MAX keywords."""
    if spec.get("scored_on") == "sleeve":
        primary = spec["shelf_keyword"]
        cl = [primary] + list(spec.get("sleeve_cluster") or []) + list(spec["cluster_keywords"])
    else:
        primary = spec.get("demand_keyword") or spec["shelf_keyword"]
        cl = [primary] + list(spec.get("demand_cluster") or []) + list(spec["cluster_keywords"])
    cl = list(dict.fromkeys(k.lower() for k in cl))
    return primary, cl[:K.DEMAND_PULL_MAX]


def demand_growth(datarova_keywords, shelf_keyword, cluster_keywords, mode="parent"):
    """Full 3.1 + 3.2 from raw Datarova keyword records.
    mode "parent": a band and the old gate on the primary keyword's clicks.
    mode "sleeve": a band on the whole sleeve cluster (every phrasing of the sleeve) and the sleeve gate
    (>= 1,000 cluster clicks over 2+ rows; the 2,000-badge half is checked after ranking)."""
    rows, tot = keyword_rows(datarova_keywords, cluster_keywords)
    out = {"rows": rows, "monthly": {m: tot[m] for m in sorted(tot)}, "mode": mode}
    prim = next((r for r in rows if r["keyword"].lower() == shelf_keyword.lower()), None)
    out["primary_kw"] = shelf_keyword
    out["primary_clicks"] = prim["clicks"] if prim else 0
    out["agg_clicks"] = sum(r["clicks"] for r in rows)
    if tot:
        lm = sorted(tot)[-1]
        out["latest_month"] = lm
        out["cvr"] = round(tot[lm][1] / tot[lm][0] * 100, 2) if tot[lm][0] else 0.0
    else:
        out["latest_month"], out["cvr"] = None, 0.0
    if mode == "sleeve":
        from . import sleeves as SL
        ok, why = SL.sleeve_gate(out["agg_clicks"], len(rows))
        a_in = out["agg_clicks"]
    else:
        ok, why = demand_gate(out["primary_clicks"], len(rows), out["agg_clicks"])
        a_in = out["primary_clicks"]
    out["demand_gate"] = {"pass": ok, "why": why, "path": mode}
    out["a_band_clicks"] = a_in
    a, b, c, D = demand_score(a_in, out["agg_clicks"], out["cvr"])
    out.update(a=a, b=b, c=c, D=D)
    g3, g6, y = growth_windows(tot) if tot else (None, None, None)
    out.update(g3=g3, g6=g6, yoy=y, ws3=ws(g3), ws6=ws(g6), wsy=ws(y), G=growth_score(g3, g6, y))
    flags = []
    if a_in < 1000 and ((g3 or 0) > 100 or (g6 or 0) > 100):
        flags.append("small_base")
    vals = [v[0] for v in tot.values() if v[0] > 0]
    if y is not None and vals and max(vals) >= 2.0 * min(vals):
        flags.append("seasonal")
    if all(v is not None and v < -10 for v in (g3, g6, y)):
        flags.append("declining_trend")
    out["flags"] = flags
    out["cluster_keywords_with_data"] = [r["keyword"] for r in rows]
    return out


def lane_clicks(datarova_keywords, keyword):
    """Latest monthly clicks for one keyword (the lane), 0 when it has no data."""
    k = next((x for x in datarova_keywords if x["keyword"].lower() == keyword.lower()), None)
    rec = sorted((k or {}).get("records") or [], key=rec_month)
    return (rec[-1].get("clicks") or 0) if rec else 0


# ---------------- Competition (3.5) ----------------
def percentile(values, p):
    if not values:
        return None
    s = sorted(values)
    return s[int(math.floor((len(s) - 1) * p))]


def log_scale(v, lo, hi):
    if v <= 0:
        return 10.0
    return max(0.0, min(10.0, 10 - (math.log10(v) - math.log10(lo)) / (math.log10(hi) - math.log10(lo)) * 10))


def inv(x, lo, hi):
    if x <= lo:
        return 10.0
    if x >= hi:
        return 0.0
    return 10 - 10 * (math.log10(x / lo) / math.log10(hi / lo))


def shelf_measures(top_reviews):
    """M1 median of the top 12, M2 mean of #1-3, M3 mean of #3-12 (Gautam 27 Oct)."""
    rv = list(top_reviews)
    if len(rv) < 3:
        return None
    return {"M1": statistics.median(rv), "M2": sum(rv[0:3]) / len(rv[0:3]), "M3": sum(rv[2:12]) / len(rv[2:12])}


def c_v8(M):
    a = K.C8_ANCHORS
    return (inv(M["M1"], *a["M1"]) + inv(M["M2"], *a["M2"]) + inv(M["M3"], *a["M3"])) / 3


def norm_brand(b):
    import re
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]", " ", str(b or "").lower())).strip()


def competition(families, top12):
    """families: all kept families K in rank order (dicts with reviews, monthly_sold, price, rating, bsr, brand).
    top12: the first SHELF_SIZE of K. Returns every sub-part so the validator can recompute it."""
    o = {}
    # moat over TOP12 (spec change: top sellers' moat)
    rv = sorted([p["reviews"] for p in top12 if (p.get("reviews") or 0) > 0])
    p50, p90 = percentile(rv, 0.5) or 0, percentile(rv, 0.9) or 0
    mx = max(rv) if rv else 0
    o["moat"] = log_scale(p50, 500, 50000) * 0.55 + log_scale(p90, 1000, 100000) * 0.25 + log_scale(mx, 2000, 200000) * 0.20
    o["moat_inputs"] = {"p50": p50, "p90": p90, "max": mx}
    # rev per review over K
    ratios = [p["monthly_sold"] * p["price"] / p["reviews"] for p in families
              if (p.get("monthly_sold") or 0) > 0 and (p.get("price") or 0) > 0 and (p.get("reviews") or 0) > 0]
    r50 = (percentile(ratios, 0.5) or 0) if ratios else 0
    o["rr"] = 10 if r50 >= 50 else 8 if r50 >= 30 else 7 if r50 >= 15 else 5 if r50 >= 8 else 3 if r50 >= 3 else 1 if r50 > 0 else 0
    o["rr_inputs"] = {"p50_ratio": r50, "n": len(ratios)}
    # best BSR over K
    bs = sorted([p["bsr"] for p in families if (p.get("bsr") or 0) > 0])
    best = bs[0] if bs else 0
    s = 5 if best == 0 else 2 if best <= 200 else 4 if best <= 1000 else 6 if best <= 5000 else 8 if best <= 20000 else 10
    top3 = (bs[0] + bs[1] + bs[2]) / 3 if len(bs) >= 3 else best
    if top3 <= 500 and s > 4:
        s = max(3, s - 2)
    o["bsr"] = s
    o["bsr_inputs"] = {"best": best, "top3_avg": top3}
    # brand spread over top 20 of K
    t20 = families[:20]
    brands = {norm_brand(p.get("brand")) for p in t20} - {""}
    wts = {}
    for p in t20:
        b = norm_brand(p.get("brand"))
        if b:
            wts[b] = wts.get(b, 0) + ((p.get("monthly_sold") or 0) if (p.get("monthly_sold") or 0) > 0 else (p.get("reviews") or 0))
    tw = sum(wts.values())
    share = (max(wts.values()) / tw) if tw > 0 else 0
    nb = len(brands)
    o["br"] = 10 if nb >= 12 and share < .20 else 8 if nb >= 8 and share < .30 else 6 if nb >= 6 and share < .40 else 4 if nb >= 4 and share < .55 else 2 if nb >= 3 else 1
    o["br_inputs"] = {"distinct_brands": nb, "top_share": round(share, 4)}
    # density
    ic = len(families)
    o["den"] = 10 if 15 <= ic <= 50 else 8 if 8 <= ic < 15 else 7 if 50 <= ic <= 80 else 5 if 80 <= ic <= 100 else 3 if ic > 100 else 6 if ic >= 5 else 3
    # premium share of top 20
    prem = [p for p in t20 if (p.get("price") or 0) >= 25 and (p.get("rating") or 0) >= 4.3 and (p.get("reviews") or 0) >= 500]
    ps = len(prem) / len(t20) if t20 else 0
    o["pr"] = 10 if ps >= .5 else 8 if ps >= .3 else 6 if ps >= .2 else 4 if ps >= .1 else 2 if ps > 0 else 0
    o["sp"] = K.SPEC_WEDGE_FIXED
    w = K.C_OLD_WEIGHTS
    o["C_old"] = sum(o[k] * w[k] for k in w)
    M = shelf_measures([p.get("reviews") or 0 for p in top12])
    o["n_top"] = len(top12)
    if M and len(top12) >= 3:
        o.update(M)
        o["C_v8"] = c_v8(M)
        o["C"] = o["C_old"] + K.MOAT_BLEND * (o["C_v8"] - o["moat"])
    else:
        o["C_v8"] = None
        o["C"] = o["C_old"]
    return o


# ---------------- Differentiation aggregate (decision 3) ----------------
def diff_from_vectors(vectors, microbial):
    keys = K.DIFF_VECTORS if microbial else [k for k in K.DIFF_VECTORS if k != "cfu_strain_specificity"]
    vals = [max(0.0, min(10.0, float(vectors[k]))) for k in keys]
    return sum(vals) / len(vals)


# ---------------- Composite (3.7) ----------------
def composite(D, G, C, Diff, *, demand_ok, n_kept, n_sig, moat, info=(), sales_ok=True):
    w = K.WEIGHTS
    raw = 10 * (w["D"] * D + w["G"] * G + w["C"] * C + w["Diff"] * Diff)
    hard, soft = [], []
    if not demand_ok:
        hard.append("demand gate failed")
    if not sales_ok:
        hard.append(f"sleeve top 12 sells < {K.SLEEVE_MIN_BADGES:,}/month")
    if D < 3:
        hard.append("D < 3")
    info = list(info)
    if G < 1 and "shrinking" not in info:   # growth is a penalty, not a gate (Gautam, 12 Nov 2026): the low G carries it
        info.append("shrinking")
    if n_kept < K.MIN_KEPT_HARD:
        hard.append(f"fewer than {K.MIN_KEPT_HARD} genuine competitors")
    if moat < K.MOAT_CAP:
        soft.append("moat < 8")
    if C < K.C_CAP:
        soft.append("C < 6")
    if n_sig < K.MIN_BADGED:
        soft.append("sales_rank_pending")
    if n_kept < K.MIN_KEPT_CAP:
        soft.append("thin_shelf < 8")
    if n_kept < K.SHELF_SIZE:
        info.append(f"thin_shelf ({n_kept} kept)")
    score = round(min(raw, K.CAP_SCORE) if soft else raw, 2)
    t = "ineligible" if hard else K.tier(score)
    # Open gap (Gautam, 12 Nov 2026): the sleeve has real demand but fewer than 3 specialised products serve it. That
    # is a finding, not a failure: no score, the evidence is reported instead. The sleeve sales gate fails with it,
    # because there are too few specialised products to sell 2,000 a month.
    gap_ok = {f"fewer than {K.MIN_KEPT_HARD} genuine competitors", f"sleeve top 12 sells < {K.SLEEVE_MIN_BADGES:,}/month"}
    if hard and f"fewer than {K.MIN_KEPT_HARD} genuine competitors" in hard and set(hard) <= gap_ok:
        t, score = K.OPEN_GAP, None
    return {"raw": round(raw, 4), "score": score, "tier": t, "hard": hard, "soft": soft, "info": info,
            "T": K.T_STRONG, "weights": w}
