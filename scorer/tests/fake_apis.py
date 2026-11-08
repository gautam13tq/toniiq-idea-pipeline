"""Offline fakes for every API, so the whole pipeline can be exercised without spending anything."""
import json
import random
from shelfscorer import clients

R = random.Random(7)
BRANDS = ["NOW", "Doctor's Best", "Sports Research", "Nutricost", "Life Extension", "Jarrow", "Nature's Bounty",
          "Solgar", "Thorne", "Pure Encapsulations", "Swanson", "BulkSupplements", "Horbaach", "Nutrivein", "Vitacost"]
ASINS = [f"B0TEST{i:04d}" for i in range(60)]


def product(i):
    a = ASINS[i]
    hero = i < 40
    title = (f"{BRANDS[i % 15]} Astaxanthin 12mg Softgels, {60 + i} Count" if hero else
             f"{BRANDS[i % 15]} Fish Oil Omega 3 with Astaxanthin, {60 + i} Softgels" if i < 50 else
             f"{BRANDS[i % 15]} Krill Oil 1000mg Softgels")
    km_now = 8_000_000
    return {"asin": a, "title": title, "brand": BRANDS[i % 15], "parentAsin": None, "features": ["Supports eye health", "12mg per softgel"],
            "description": "Supplement Facts: Astaxanthin 12 mg" if hero else "Fish oil 1000mg, astaxanthin 0.1mg",
            "itemForm": "Softgel", "categoryTree": [{"name": "Health & Household"}],
            "monthlySold": max(0, 5000 - i * 120), "lastUpdate": km_now + 10**7,
            "images": [{"l": f"img{i}.jpg"}],
            "stats": {"current": [None] * 3 + [2000 + i * 300] + [None] * 12 + [45, 300 + i * 400, 2500],
                      "avg90": [None] * 3 + [2100 + i * 300] + [None] * 14 + [2499], "avg30": [None] * 4}}


def install(monkey):
    def dr(run, keywords, start, end, label, include_asins=False):
        def fn():
            ks = []
            for k in keywords:
                base = 30000 if k == "astaxanthin 12mg" else 4000
                recs = [{"start_date": f"2025-{m:02d}-01", "clicks": base + m * 300, "sales": int((base + m * 300) * .22),
                         **({f"asin_{j}": {"asin": ASINS[j - 1], "clicks": 3000} for j in (1, 2, 3)} if include_asins else {})}
                        for m in range(1, 13)]
                recs.append({"start_date": "2026-01-01", "clicks": base * 2, "sales": int(base * 2 * .22)})
                ks.append({"keyword": k, "records": recs})
            return {"data": {"keywords": ks}}
        return run.call("datarova", "/keywords", {"keywords": keywords}, fn, raw_rel=f"datarova/{label}.json", rows_fn=lambda r: 1)

    def kp(run, path, params, label):
        def fn():
            if path == "query":
                return {"asinList": ASINS[:45], "tokensConsumed": 10}
            if path == "search":
                return {"products": [{"asin": a} for a in ASINS[40:60]], "tokensConsumed": 10}
            ids = params["asin"].split(",")
            return {"products": [product(ASINS.index(a)) for a in ids], "tokensConsumed": len(ids)}
        return run.call("keepa", f"/{path}", params, fn, raw_rel=f"keepa/{label}.json", rows_fn=lambda r: 1,
                        tokens_fn=lambda r: r["tokensConsumed"])

    def ap(run, keyword, label):
        return run.call("apify", clients.K.APIFY_ACTOR, {"keyword": keyword}, lambda: [
            {"asin": ASINS[i], "page": 1 + i // 24, "searchResultPosition": i % 24 + 1} for i in range(30)],
            raw_rel=f"apify/{label}.json", rows_fn=len, cost_usd=0.003)

    def an(run, label, *, system=None, messages, max_tokens=1500, temperature=0):
        def fn():
            if label.startswith("diff"):
                v = {k: {"score": 6 if k != "cfu_strain_specificity" else 0, "reasoning": "fixture"} for k in clients.K.DIFF_VECTORS}
                t = json.dumps({"vectors": v, "reasoning": "fixture"})
            elif label.startswith("fop"):
                t = json.dumps({"front_text": "Astaxanthin 12mg", "main_ingredient": "astaxanthin", "hero_is_main": True})
            elif label.startswith("merge"):
                t = json.dumps({"verdict": "SEPARATE", "rule_id": "M1", "reason": "fixture"})
            else:
                t = json.dumps({"verdict": "OUT", "rule_id": "R7-1", "reason": "fixture"})
            return {"content": [{"type": "text", "text": t}], "usage": {"input_tokens": 1000, "output_tokens": 100}}
        res = run.call("anthropic", "/v1/messages", {"label": label, "prompt_sha": "x"}, fn, raw_rel=f"llm/{label}.json",
                       rows_fn=lambda r: 1, cost_usd=0.0045)
        return res["content"][0]["text"], f"sha-{label}"
    for name, f in (("datarova_keywords", dr), ("keepa", kp), ("apify_search", ap), ("anthropic", an)):
        monkey(clients, name, f)
