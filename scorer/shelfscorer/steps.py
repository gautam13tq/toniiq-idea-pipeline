"""The 15 steps of one run (spec section 4). Each step reads the previous artifacts, writes its own, and records a
pass/fail check. A step refuses to start until the steps before it have passed."""
import datetime as dt
import json
import re

from . import clients, config as K, pillars as P
from . import gate_adapter as GA
from .runlog import StepFailed, now

REQUIRED_SPEC = ["shelf_keyword", "hero_regex", "cluster_keywords", "microbial", "written_at"]


# ---------------- step 1: spec ----------------
def step_spec(run, spec):
    miss = [k for k in REQUIRED_SPEC if k not in spec]
    if miss:
        run.step_done("spec", "V-SPEC", False, f"missing fields {miss}")
    if run.calls():
        run.step_done("spec", "V-SPEC", False, "spec must be written before any data call")
    H = re.compile(spec["hero_regex"], re.I)
    bad = [k for k in spec["cluster_keywords"] if not H.search(k)]
    if spec["shelf_keyword"] not in spec["cluster_keywords"]:
        bad.append("shelf_keyword not in cluster_keywords")
    q = spec.get("qualifier_regex")
    if q:
        bad += [k for k in spec["cluster_keywords"] if not re.search(q, k, re.I)]
    if not 1 <= len(spec["cluster_keywords"]) <= 12:
        bad.append("cluster_keywords must be 1 to 12")
    run.save("spec.json", spec)
    run.step_done("spec", "V-SPEC", not bad, "; ".join(bad))


# ---------------- step 2: Datarova ----------------
def month_window(today=None):
    today = today or dt.date.today()
    latest = (today.replace(day=1) - dt.timedelta(days=1)).replace(day=1)   # latest complete month
    start = latest.replace(year=latest.year - 1)
    return start.isoformat(), latest.isoformat()


def step_datarova(run):
    run.require("spec")
    s = run.read("spec.json")
    kws = list(dict.fromkeys(s["cluster_keywords"] + ([s["parent_keyword"]] if s.get("parent_keyword") else [])
                             + list(s.get("candidate_subniches") or [])))
    start, end = month_window()
    got = []
    try:
        for i in range(0, len(kws), K.DATAROVA_BATCH):
            r = clients.datarova_keywords(run, kws[i:i + K.DATAROVA_BATCH], start, end, f"keywords_{i // K.DATAROVA_BATCH}")
            got += (r.get("data") or {}).get("keywords") or []
        asin_kws = [s["shelf_keyword"]] + [k for k in s["cluster_keywords"] if k != s["shelf_keyword"]][:3]
        for k in asin_kws:
            clients.datarova_keywords(run, [k], start, end, f"{k.replace(' ', '_')}__asins", include_asins=True)
    except RuntimeError as e:
        if "datarova_auth_error" in str(e):
            run.update(status="infra_abort")
            run.step_done("datarova", "V-DR", False, "Datarova auth error: infra abort, no score")
        raise
    seen = {k["keyword"].lower() for k in got}
    missing = [k for k in kws if k.lower() not in seen]
    run.save("datarova/merged_keywords.json", {"keywords": got, "missing": missing, "window": [start, end]})
    has_shelf = s["shelf_keyword"].lower() in seen
    run.step_done("datarova", "V-DR", has_shelf, f"no_data: {missing}" if missing else "")


# ---------------- step 3: demand and growth ----------------
def step_demand_growth(run):
    run.require("datarova")
    s = run.read("spec.json")
    kw = run.read("datarova/merged_keywords.json")["keywords"]
    dg = P.demand_growth(kw, s["shelf_keyword"], s["cluster_keywords"])
    if s.get("parent_keyword"):
        par = next((k for k in kw if k["keyword"].lower() == s["parent_keyword"].lower()), None)
        dg["parent_clicks"] = (sorted(par["records"], key=P.rec_month)[-1].get("clicks") if par and par.get("records") else None)
    # V-KW: the spec's shelf keyword must also be the most relevant keyword with data (it must carry the cluster)
    top = dg["rows"][0]["keyword"] if dg["rows"] else None
    dg["v_kw"] = {"shelf_keyword_has_data": dg["primary_clicks"] > 0, "largest_cluster_kw": top}
    run.save("demand_growth.json", dg)
    eligible = dg["demand_gate"]["pass"] and dg["D"] >= 3 and dg["G"] >= 1
    run.update(eligible_after_demand=eligible)
    run.step_done("demand_growth", "V-DG", dg["primary_clicks"] > 0 or not dg["demand_gate"]["pass"],
                  f"D={dg['D']} G={dg['G']} gate={dg['demand_gate']}")
    return eligible


# ---------------- step 4: discovery ----------------
def step_discover(run):
    run.require("demand_growth")
    s = run.read("spec.json")
    src = {}

    def add(a, why):
        if a:
            src.setdefault(a, set()).add(why)
    queries = [s["shelf_keyword"]] + [k for k in s["cluster_keywords"] if k != s["shelf_keyword"]][:K.APIFY_MAX_QUERIES - 1]
    pagepos = {}
    for qi, q in enumerate(queries):
        items = clients.apify_search(run, q, f"search_{qi}") or []
        for it in items:
            a = it.get("asin")
            add(a, f"apify:{q}")
            if q == s["shelf_keyword"] and a and a not in pagepos:
                pagepos[a] = (it.get("page") or 1, it.get("searchResultPosition") or it.get("position") or 99)
    aliases = s.get("finder_terms") or [s["shelf_keyword"]]
    for ai, term in enumerate(aliases):
        for page in range(K.KEEPA_FINDER_PAGES):
            sel = {"title": term, "perPage": 100, "page": page, "sort": [["current_SALES", "asc"]],
                   "productType": [0, 1, 2], "rootCategory": [K.KEEPA_ROOT_CATEGORY]}
            d = clients.keepa(run, "query", {"domain": K.KEEPA_DOMAIN, "selection": json.dumps(sel)}, f"finder_{ai}_p{page}")
            for a in d.get("asinList") or []:
                add(a, f"keepa_finder:{term}")
        d = clients.keepa(run, "search", {"domain": K.KEEPA_DOMAIN, "type": "product", "term": term, "page": 0, "stats": 0},
                          f"search_{ai}")
        for p in d.get("products") or []:
            add(p.get("asin"), f"keepa_search:{term}")
    winners = datarova_winners(run)
    for a in winners:
        add(a, "datarova_top3")
    for a in s.get("seed_asins") or []:
        add(a, "seed")
    cand = {a: sorted(v) for a, v in src.items()}
    run.save("candidates.json", {"candidates": cand, "page_pos": pagepos, "datarova_top3": sorted(winners)})
    kinds = {w.split(":")[0] for v in cand.values() for w in v}
    need = {"apify", "keepa_finder", "keepa_search", "datarova_top3"}
    ok = len(cand) >= K.MIN_CANDIDATES and need <= kinds
    run.step_done("discover", "V-CAND", ok, f"{len(cand)} candidates; sources {sorted(kinds)}")


def datarova_winners(run):
    out = set()
    for p in sorted((run.dir / "datarova").glob("*__asins.json")):
        d = json.loads(p.read_text())
        for k in (d.get("data") or {}).get("keywords") or []:
            for r in k.get("records") or []:
                for i in (1, 2, 3):
                    a = r.get(f"asin_{i}")
                    if a and a.get("asin"):
                        out.add(a["asin"])
    return out


# ---------------- step 5: Keepa pass 1 ----------------
def keepa_products(run, asins, label, extra=None):
    prods = {}
    for i in range(0, len(asins), 100):
        params = {"domain": K.KEEPA_DOMAIN, "asin": ",".join(asins[i:i + 100]), "stats": 90, "history": 1}
        params.update(extra or {})
        d = clients.keepa(run, "product", params, f"{label}_{i // 100}")
        for p in d.get("products") or []:
            if p.get("asin"):
                prods[p["asin"]] = p
    return prods


def step_keepa1(run):
    run.require("discover")
    cand = run.read("candidates.json")["candidates"]
    prods = keepa_products(run, sorted(cand), "product_pass1")
    missing = sorted(set(cand) - set(prods))
    run.save("keepa/pass1_index.json", {"asins": sorted(prods), "keepa_missing": missing, "pulled_at": now()})
    run.step_done("keepa_pass1", "V-KEEPA1", len(prods) > 0, f"{len(prods)} products, {len(missing)} missing")


def load_products(run, prefix):
    out = {}
    for p in sorted((run.dir / "keepa").glob(f"{prefix}_*.json")):
        for x in json.loads(p.read_text()).get("products") or []:
            if x.get("asin"):
                out[x["asin"]] = x
    return out


# ---------------- step 6-7: gate and collapse ----------------
def step_gate(run):
    run.require("keepa_pass1")
    s = run.read("spec.json")
    GA.register_spec(s)
    prods = load_products(run, "product_pass1")
    pp = run.read("candidates.json")["page_pos"]
    recs = [GA.gate_record(p, tuple(pp[a]) if a in pp else None) for a, p in prods.items() if p.get("title")]
    judge, merge, n = GA.make_judges(run)
    res = GA.GATE.run_shelf(s["shelf_keyword"], recs, k=K.SHELF_SIZE, judge_fn=judge, merge_fn=merge)
    dec = res["dec"]
    # Spec exclusion (added 9 Nov 2026 after the PEA cloud run): a listing whose title matches the spec's
    # hero_exclude_regex (e.g. pea protein / fiber on the PEA shelf) is OUT unless it also names the hero
    # unambiguously (hero_strong_regex). Recorded on the decision so the evidence shows why.
    excluded = []
    xr = s.get("hero_exclude_regex")
    if xr:
        strong = s.get("hero_strong_regex")
        for r in recs:
            t = r["title"]
            if re.search(xr, t, re.I) and not (strong and re.search(strong, t, re.I)):
                d = dec.setdefault(r["asin"], {})
                d.update({"include": False, "code": "EX_SPEC_EXCLUDE", "spec_exclude": xr})
                excluded.append(r["asin"])
        res["kept"] = [a for a in res["kept"] if a not in excluded]
    unsure = sum(1 for d in dec.values() if d.get("verdict3") == "UNSURE")
    fallback = sum(1 for d in dec.values() if d.get("judge_fallback"))
    run.save("gate/decisions.json", {"gate_version": GA.GATE_VERSION, "decisions": dec, "kept": res["kept"],
                                     "merges": res["merges"], "judge_calls": n["judge"], "merge_calls": n["merge"],
                                     "spec_excluded": excluded})
    ok = fallback == 0 and unsure == n["judge"]
    run.step_done("gate", "V-GATE", ok, f"{len(res['kept'])} kept; unsure {unsure}; judge calls {n['judge']}; fallback {fallback}; spec-excluded {len(excluded)}")


def build_families(run):
    """Family = a kept listing plus every listing the gate folded into it (dup_of). Badge = sum of Keepa monthlySold
    across members, counting a shared parent-level badge once (I6)."""
    g = run.read("gate/decisions.json")
    prods = load_products(run, "product_pass1")
    if (run.dir / "keepa" / "product_pass2_0.json").exists():
        prods.update(load_products(run, "product_pass2"))
    manual = run.read("manual_decisions.json")["decisions"] if run.exists("manual_decisions.json") else {}
    kept = [a for a in g["kept"] if manual.get(a, {}).get("decision") != "OUT"]
    kept += [a for a, m in manual.items() if m.get("decision") == "IN" and a not in kept]
    root = {}
    for a, d in g["decisions"].items():
        b = a
        seen = set()
        while g["decisions"].get(b, {}).get("dup_of") and b not in seen:
            seen.add(b)
            b = g["decisions"][b]["dup_of"]
        root[a] = b
    fams = []
    for k in kept:
        members = sorted({a for a, r in root.items() if r == k} | {k})
        F = [GA.product_fields(prods[a]) for a in members if a in prods]
        if not F:
            continue
        badge, seen_pb = 0, set()
        for f in F:
            key = (f["parent"], f["monthly_sold"]) if f["parent"] and f["monthly_sold"] else (f["asin"], f["monthly_sold"])
            if key in seen_pb:
                continue
            seen_pb.add(key)
            badge += f["monthly_sold"] or 0
        prim = sorted(F, key=lambda f: (-(f["monthly_sold"] or 0), f["rank90"] or 9e9))[0]
        r90 = [f["rank90"] for f in F if f["rank90"]]
        fams.append({"family_id": k, "asins": members, "primary_asin": prim["asin"], "brand": prim["brand"],
                     "title": prim["title"], "monthly_sold": badge, "best_rank90": min(r90) if r90 else None,
                     "reviews": max(f["reviews"] or 0 for f in F), "price": prim["price"], "rating": prim["rating"],
                     "bsr": prim["bsr"], "image": prim["image"], "last_update": max((f["last_update"] or 0) for f in F),
                     "decision_source": manual.get(k, {}).get("source") or g["decisions"].get(k, {}).get("code")})
    fams = merge_shared_reviews(fams)
    fams.sort(key=lambda f: (-(f["monthly_sold"] or 0), f["best_rank90"] or 9e9))
    return fams


def merge_shared_reviews(fams):
    """Amazon shows one review pool per product, so two families from the same brand with the same review count
    (>= 20) are sizes of one product (NOW Magtein 90/180 ct, Kappa, Jarrow S. boulardii). Fold the smaller-badge one
    into the bigger. Runs on the final families, so front-of-pack rescues and pass-2 review counts are covered
    (9 Nov 2026)."""
    out, byk = [], {}
    for f in sorted(fams, key=lambda f: (-(f["monthly_sold"] or 0), f["best_rank90"] or 9e9)):
        k = ((f["brand"] or "").strip().lower(), f["reviews"] or 0)
        if k[0] and k[1] >= 20 and k in byk:
            t = byk[k]
            t["asins"] = sorted(set(t["asins"]) | set(f["asins"]))
            t["monthly_sold"] = (t["monthly_sold"] or 0) + (f["monthly_sold"] or 0)
            r = [x for x in (t["best_rank90"], f["best_rank90"]) if x]
            t["best_rank90"] = min(r) if r else None
            t.setdefault("merged_families", []).append(f["family_id"])
            continue
        if k[0] and k[1] >= 20:
            byk[k] = f
        out.append(f)
    return out


def step_collapse(run):
    run.require("gate")
    fams = build_families(run)
    all_asins = [a for f in fams for a in f["asins"]]
    run.save("families.json", {"families": fams})
    run.step_done("collapse", "V-FAM", len(all_asins) == len(set(all_asins)), f"{len(fams)} families")


def _in_family(asin, dec, top_asins):
    """True when the ASIN, or any listing it was folded into (gate dup_of chain), is on the shelf."""
    b, seen = asin, set()
    while b and b not in seen:
        if b in top_asins:
            return True
        seen.add(b)
        b = (dec.get(b) or {}).get("dup_of")
    return any((dec.get(t) or {}).get("dup_of") == asin for t in top_asins)


# ---------------- step 8: rank + front of pack ----------------
FOP_PROMPT = ("Quote the exact words on the front of this pack, largest text first. Which single ingredient does the "
              "pack lead with (the biggest or first-named ingredient)? If the pack's headline is a health condition or "
              "benefit (for example 'Sciatic Nerve Support') rather than an ingredient, say so. "
              "List every ingredient dose printed on the front (amount in mg; convert g to mg). "
              "Answer JSON only: {\"front_text\": \"...\", \"main_ingredient\": \"...\", \"headline_is_condition\": true|false, "
              "\"front_doses\": [{\"ingredient\": \"...\", \"mg\": 0}]}.")
# Blind on purpose (9 Nov 2026 dev round): when the prompt carried the hero pattern, the model named the hero as the
# main ingredient even on melatonin or fisetin packs. hero_is_main is now decided in code from main_ingredient.


def needs_fop(f, dec, hero):
    d = dec.get(f["family_id"], {})
    pos = GA.hero_pos(f["title"], hero)
    return bool(d.get("judge")) or pos is None or pos > 60


def step_rank_fop(run):
    run.require("collapse")
    s = run.read("spec.json")
    g = run.read("gate/decisions.json")
    dec = g["decisions"]
    manual = {"decisions": {}} if not run.exists("manual_decisions.json") else run.read("manual_decisions.json")
    checked = set(manual.get("checked", []))
    for _ in range(4):
        fams = build_families(run)
        top15 = fams[:15]
        cut = fams[K.SHELF_SIZE - 1]["monthly_sold"] if len(fams) >= K.SHELF_SIZE else 0
        todo = [f for f in top15 if needs_fop(f, dec, s["hero_regex"]) and f["family_id"] not in checked]
        prods = load_products(run, "product_pass1")
        near = []
        for a, d in dec.items():
            if not d["include"] and d.get("code") in ("HERO_SECONDARY", "JUDGE_OUT") and a in prods and a not in checked \
                    and a not in set(s.get("must_out") or []):
                f = GA.product_fields(prods[a])
                if cut and (f["monthly_sold"] or 0) >= cut:
                    near.append({"family_id": a, "image": f["image"], "title": f["title"]})
        if not todo and not near:
            break
        for f in todo + near:
            a = f["family_id"]
            checked.add(a)
            if not f.get("image"):
                manual["decisions"][a] = {"decision": "NEEDS_CHECK", "source": "fop_no_image", "date": now()}
                continue
            text, ps = clients.anthropic(run, f"fop_{a}", max_tokens=400, messages=[{"role": "user", "content": [
                {"type": "image", "source": {"type": "url", "url": f["image"]}},
                {"type": "text", "text": FOP_PROMPT}]}])
            try:
                o = clients.extract_json(text)
            except Exception:
                o = {"hero_is_main": None, "raw": text[:300]}
            mi0 = o.get("main_ingredient")
            o["hero_is_main"] = None if not mi0 else bool(re.search(s["hero_regex"], mi0, re.I))
            # Dose rule (9 Nov 2026): if the front prints a bigger dose for another ingredient than for the hero,
            # the hero does not lead (e.g. "L-THEANINE 1000MG GABA 2000MG").
            doses = [x for x in (o.get("front_doses") or []) if isinstance(x, dict) and isinstance(x.get("mg"), (int, float))]
            hero_mg = max([x["mg"] for x in doses if re.search(s["hero_regex"], str(x.get("ingredient")), re.I)], default=None)
            other_mg = max([x["mg"] for x in doses if not re.search(s["hero_regex"], str(x.get("ingredient")), re.I)], default=None)
            if o["hero_is_main"] and hero_mg is not None and other_mg is not None and other_mg > hero_mg:
                o["hero_is_main"] = False
                o["dose_rule"] = f"another ingredient printed at {other_mg} mg vs hero {hero_mg} mg"
            run.save(f"fop/{a}.json", {**o, "prompt_sha": ps, "image": f["image"]})
            was_in = a in g["kept"]
            # A gate OUT is only overturned when the pack names the hero, its headline is not a condition,
            # and the spec exclusion does not apply (9 Nov 2026 fix: Vital Fiber and a sciatic-nerve formula got in).
            ft = o.get("front_text") or ""
            mi = o.get("main_ingredient") or ""
            rescue_ok = (re.search(s["hero_regex"], ft, re.I) and re.search(s["hero_regex"], mi, re.I)
                         and o.get("headline_is_condition") is False
                         and dec.get(a, {}).get("code") != "EX_SPEC_EXCLUDE"
                         and not (s.get("hero_exclude_regex") and re.search(s["hero_exclude_regex"], ft, re.I)))
            if o.get("hero_is_main") is True and not was_in and rescue_ok:
                manual["decisions"][a] = {"decision": "IN", "source": "front_of_pack", "wording": o.get("front_text"), "date": now()}
            elif o.get("hero_is_main") is False and was_in:
                manual["decisions"][a] = {"decision": "OUT", "source": "front_of_pack", "wording": o.get("front_text"), "date": now()}
            elif o.get("hero_is_main") is None:
                manual["decisions"][a] = {"decision": "NEEDS_CHECK", "source": "fop_unreadable", "date": now()}
        manual["checked"] = sorted(checked)
        run.save("manual_decisions.json", manual)
    fams = build_families(run)
    run.save("ranking.json", {"families": fams})
    n_sig = sum(1 for f in fams[:K.SHELF_SIZE] if (f["monthly_sold"] or 0) > 0)
    open_checks = [a for a, m in manual["decisions"].items() if m["decision"] == "NEEDS_CHECK"
                   and a in {f["family_id"] for f in fams[:K.SHELF_SIZE]}]
    run.update(n_sig=n_sig)
    run.step_done("rank_fop", "V-RANK/V-FOP", not open_checks, f"n_sig {n_sig}; open checks {open_checks}")


# ---------------- step 9: Keepa pass 2 ----------------
def step_keepa2(run):
    run.require("rank_fop")
    fams = run.read("ranking.json")["families"]
    asins = sorted({a for f in fams[:15] for a in f["asins"]})
    keepa_products(run, asins, "product_pass2", {"rating": 1, "buybox": 1})
    fams = build_families(run)
    run.save("ranking.json", {"families": fams})
    cutoff = (dt.datetime.now(dt.timezone.utc) - dt.datetime(2011, 1, 1, tzinfo=dt.timezone.utc)).total_seconds() / 60 \
        - K.MAX_DATA_AGE_DAYS * 24 * 60
    stale = [f for f in fams[:K.SHELF_SIZE] if (f["last_update"] or 0) < cutoff]
    note = ""
    if stale:
        # Force Keepa to refresh the stale listings once (update=0; costs extra tokens). A listing Keepa still cannot
        # refresh is treated as dead: it leaves the shelf with a logged decision (9 Nov 2026, tart cherry).
        keepa_products(run, sorted({a for f in stale for a in f["asins"]}), "product_pass2_refresh", {"rating": 1, "buybox": 1, "update": 0})
        fams = build_families(run)
        still = [f["family_id"] for f in fams[:K.SHELF_SIZE] if (f["last_update"] or 0) < cutoff]
        if still:
            manual = run.read("manual_decisions.json") if run.exists("manual_decisions.json") else {"decisions": {}}
            for a in still:
                manual["decisions"][a] = {"decision": "OUT", "source": "stale_keepa", "date": now(),
                                          "wording": f"Keepa data older than {K.MAX_DATA_AGE_DAYS} days after a forced refresh"}
            run.save("manual_decisions.json", manual)
            fams = build_families(run)
        run.save("ranking.json", {"families": fams})
        note = f"refreshed {[f['family_id'] for f in stale]}; dropped as dead {still}"
    stale_now = [f["family_id"] for f in fams[:K.SHELF_SIZE] if (f["last_update"] or 0) < cutoff]
    run.step_done("keepa_pass2", "I10", not stale_now, f"stale: {stale_now}; {note}")


# ---------------- step 10: competition ----------------
def step_competition(run):
    run.require("keepa_pass2")
    fams = run.read("ranking.json")["families"]
    top = fams[:K.SHELF_SIZE]
    c = P.competition(fams, top)
    c["n_kept"] = len(fams)
    c["n_sig"] = sum(1 for f in top if (f["monthly_sold"] or 0) > 0)
    run.save("top12.json", [{"rank": i + 1, **f} for i, f in enumerate(top)])
    run.save("competition.json", c)
    run.step_done("competition", "V-COMP", True, f"C={c['C']:.3f} moat={c['moat']:.2f} n_top={c['n_top']}")


# ---------------- step 11: differentiation ----------------
DIFF_SYSTEM = open(__file__.replace("steps.py", "diff_prompt.txt")).read()


def step_diff(run):
    run.require("competition")
    s = run.read("spec.json")
    top = run.read("top12.json")
    fams = run.read("ranking.json")["families"]
    rv = sorted([f["reviews"] for f in fams if f["reviews"]])
    prices = sorted([f["price"] for f in fams if f["price"]])
    bs = [f["bsr"] for f in fams if f["bsr"]]
    comp = [{"brand": f["brand"], "title": f["title"][:200], "price": f["price"], "rating": f["rating"],
             "reviews": f["reviews"], "monthly_sold": f["monthly_sold"], "bsr": f["bsr"]} for f in top]
    user = (f"Niche: {s.get('hero_name', s['shelf_keyword'])} (hero) "
            f"{'· ' + s['modifier'] + ' delivery' if s.get('modifier') else ''}\n"
            f"Frame: {'strict_modifier' if s.get('modifier') or s.get('form') or s.get('format') else 'broad_hero'}\n"
            f"Concept name (for context only — DO NOT score against its spec): \"{s['shelf_keyword']}\"\n\n"
            f"Competitive landscape (Keepa-enriched, {len(fams)} included competitors after classification):\n"
            f"- Price p50: ${P.percentile(prices, .5) if prices else 'n/a'}\n"
            f"- Reviews — p50: {P.percentile(rv, .5) if rv else 'n/a'} / p90: {P.percentile(rv, .9) if rv else 'n/a'} / max: {max(rv) if rv else 'n/a'}\n"
            f"- Best BSR: {min(bs) if bs else 'n/a'}\n"
            f"- Distinct brands in top-20: {len({P.norm_brand(f['brand']) for f in fams[:20]} - {''})}\n\n"
            f"Top 12 included competitors:\n{json.dumps(comp, indent=1)}\n\n"
            "Score the 6 differentiation vectors strictly based on whether this niche has ROOM for Toniiq's playbook — "
            "independent of the concept's draft spec.")
    results = []

    def one(i):
        text, ps = clients.anthropic(run, f"diff_{i}", system=DIFF_SYSTEM, messages=[{"role": "user", "content": user}],
                                     max_tokens=K.DIFF_MAX_TOKENS)
        o = clients.extract_json(text)
        vec = {k: float((o.get("vectors") or {}).get(k, {}).get("score")) for k in K.DIFF_VECTORS}
        sc = P.diff_from_vectors(vec, s["microbial"])
        r = {"call": i, "prompt_sha": ps, "vectors": vec, "reasoning": {k: (o["vectors"][k].get("reasoning") or "")[:400]
             for k in K.DIFF_VECTORS}, "summary": o.get("reasoning"), "score": sc}
        run.save(f"diff/call_{i}.json", r)
        return r
    results = [one(1), one(2)]
    unstable = abs(results[0]["score"] - results[1]["score"]) > K.DIFF_UNSTABLE_DELTA
    if unstable:
        results.append(one(3))
        final = sorted(r["score"] for r in results)[1]
    else:
        final = (results[0]["score"] + results[1]["score"]) / 2
    run.save("diff.json", {"score": final, "unstable": unstable, "calls": len(results), "microbial": s["microbial"],
                           "vectors_available": sum(1 for v in results[0]["vectors"].values() if v >= 6)})
    run.step_done("diff", "V-DIFF", len(results) >= 2, f"Diff={final:.2f} unstable={unstable}")


# ---------------- step 12: cross-checks ----------------
def step_crosscheck(run):
    run.require("diff")
    s = run.read("spec.json")
    top = run.read("top12.json")
    top_asins = {a for f in top for a in f["asins"]}
    g = run.read("gate/decisions.json")["decisions"]
    wr = []
    p = run.dir / "datarova" / f"{s['shelf_keyword'].replace(' ', '_')}__asins.json"
    if p.exists():
        for k in (json.loads(p.read_text()).get("data") or {}).get("keywords") or []:
            recs = sorted(k.get("records") or [], key=P.rec_month)
            if recs:
                r = recs[-1]
                for i in (1, 2, 3):
                    a = r.get(f"asin_{i}")
                    if a and a.get("asin"):
                        wr.append({"asin": a["asin"], "clicks": a.get("clicks"),
                                   "share": round((a.get("clicks") or 0) / r["clicks"], 3) if r.get("clicks") else None,
                                   "in_top12": _in_family(a["asin"], g, top_asins),
                                   "gate": {k2: g.get(a["asin"], {}).get(k2) for k2 in ("include", "code", "detail")}})
    pp = run.read("candidates.json")["page_pos"]
    presence = sum(1 for f in top if any(a in pp for a in f["asins"]))
    tq = clients.keepa(run, "query", {"domain": K.KEEPA_DOMAIN, "selection": json.dumps(
        {"brand": ["Toniiq"], "perPage": 100, "page": 0, "productType": [0, 1, 2]})}, "toniiq_brand")
    toniiq_on_shelf = [f["primary_asin"] for f in top if "toniiq" in (f["brand"] or "").lower()]
    flags = []
    if any(not w["in_top12"] for w in wr):
        flags.append("winner_gap")
    if presence < 6:
        flags.append("shelf_page_mismatch")
    if toniiq_on_shelf:
        flags.append("toniiq_launched")
    out = {"winner_read": wr, "page_presence": presence, "toniiq_asins_listed": len(tq.get("asinList") or []),
           "toniiq_on_shelf": toniiq_on_shelf, "flags": flags}
    run.save("crosschecks.json", out)
    run.step_done("crosscheck", "V-XC", True, f"flags {flags}")


# ---------------- step 13: score ----------------
def step_score(run):
    run.require("crosscheck")
    dg = run.read("demand_growth.json")
    c = run.read("competition.json")
    d = run.read("diff.json")
    x = run.read("crosschecks.json")
    m = run.manifest()
    info = list(dg["flags"]) + list(x["flags"]) + (["diff_unstable"] if d["unstable"] else [])
    s = run.read("spec.json")
    if s.get("scored_on") == "parent":
        info.append("scored_on = parent")
    r = P.composite(dg["D"], dg["G"], c["C"], d["score"], demand_ok=dg["demand_gate"]["pass"], n_kept=c["n_kept"],
                    n_sig=m.get("n_sig", c["n_sig"]), moat=c["moat"], info=info)
    r.update(D=dg["D"], G=dg["G"], C=round(c["C"], 4), Diff=round(d["score"], 4), version=m["scorer_version"])
    run.save("score.json", r)
    run.step_done("score", "V-SCORE", True, f"{r['score']} {r['tier']}")


def score_ineligible(run, why):
    """Demand ended the run: write an ineligible score with the evidence so far."""
    dg = run.read("demand_growth.json")
    r = {"raw": None, "score": None, "tier": "ineligible", "hard": [why], "soft": [], "info": dg["flags"],
         "D": dg["D"], "G": dg["G"], "C": None, "Diff": None, "T": K.T_STRONG, "weights": K.WEIGHTS,
         "version": run.manifest()["scorer_version"]}
    run.save("score.json", r)
    run.step_done("score", "V-SCORE", True, f"ineligible: {why}")
