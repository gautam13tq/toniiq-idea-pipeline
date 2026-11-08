"""Keepa product -> gate record; the gate run with Claude as judge and merge judge (every call logged)."""
import json
import os
import re
import sys
import tempfile

from . import clients

GATE_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "gate")
if GATE_DIR not in sys.path:
    sys.path.insert(0, GATE_DIR)
import gate_v113 as GATE  # noqa: E402

GATE_VERSION = "v11.3"


def keepa_stat(p, kind, idx):
    v = ((p.get("stats") or {}).get(kind) or [])
    return v[idx] if len(v) > idx and v[idx] is not None and v[idx] >= 0 else None


def product_fields(p):
    """The numbers the scorer uses from one Keepa product."""
    price = keepa_stat(p, "avg90", 18) or keepa_stat(p, "current", 18) or keepa_stat(p, "avg90", 0) or keepa_stat(p, "current", 0)
    rating = keepa_stat(p, "current", 16)
    imgs = p.get("images") or []
    img = None
    if imgs and isinstance(imgs[0], dict):
        img = imgs[0].get("l") or imgs[0].get("m")
    elif p.get("imagesCSV"):
        img = p["imagesCSV"].split(",")[0]
    return {
        "asin": p["asin"], "title": p.get("title") or "", "brand": p.get("brand") or "",
        "parent": p.get("parentAsin"), "monthly_sold": p.get("monthlySold") or 0,
        "reviews": keepa_stat(p, "current", 17) or 0, "rating": (rating / 10) if rating else None,
        "price": round(price / 100, 2) if price else None,
        "bsr": keepa_stat(p, "current", 3) or keepa_stat(p, "avg30", 3), "rank90": keepa_stat(p, "avg90", 3),
        "last_update": p.get("lastUpdate"), "image": f"https://m.media-amazon.com/images/I/{img}" if img else None,
    }


def gate_record(p, page_pos=None):
    f = product_fields(p)
    crumbs = " > ".join(c.get("name", "") for c in (p.get("categoryTree") or []))
    pg, ps = (page_pos or (9, 99))
    return {
        "id": p["asin"], "asin": p["asin"], "title": f["title"], "brand": f["brand"],
        "bullets": list(p.get("features") or []), "ingredients": p.get("ingredients") or p.get("description") or "",
        "description": p.get("description") or "", "item_form": p.get("itemForm") or "", "crumbs": crumbs,
        "variantAsins": [v.get("asin") for v in (p.get("variations") or []) if v.get("asin")],
        "mpv": f"{f['monthly_sold']}+ bought in past month" if f["monthly_sold"] else "",
        "reviews": f["reviews"], "price": f["price"], "page": pg, "pos": ps,
    }


def register_spec(spec):
    """Load the shelf spec into the gate through its own add_holdout_specs (as Grok did)."""
    entry = {spec["shelf_keyword"]: {"hero": spec["hero_regex"], "deliv": spec.get("modifier"), "form": spec.get("form"),
                                     "ofo": spec.get("other_forms"), "fmt": spec.get("gate_format"),
                                     "req": spec.get("required_regex"), "cls": spec.get("class_regex"),
                                     "allow": spec.get("allow") or []}}
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as t:
        json.dump(entry, t)
    GATE.add_holdout_specs(t.name)
    os.unlink(t.name)
    return entry


def make_judges(run):
    n = {"judge": 0, "merge": 0}

    def judge(shelf, x):
        n["judge"] += 1
        p = GATE.judge_prompt(shelf, x)
        text, ps = clients.anthropic(run, f"judge_{x['asin']}", messages=[{"role": "user", "content": p}], max_tokens=400)
        try:
            o = clients.extract_json(text)
        except Exception:
            return {"verdict": None, "rule_id": "JUDGE_PARSE_FAIL", "reason": text[:200], "prompt_sha": ps}
        o["prompt_sha"] = ps
        run_log(run, "gate/judge_calls.jsonl", {"asin": x["asin"], **o})
        return o

    def merge(shelf, a, b):
        n["merge"] += 1
        p = GATE.merge_prompt(shelf, a, b)
        text, ps = clients.anthropic(run, f"merge_{a['asin']}_{b['asin']}", messages=[{"role": "user", "content": p}], max_tokens=400)
        try:
            o = clients.extract_json(text)
        except Exception:
            return {"verdict": None, "rule_id": "MERGE_PARSE_FAIL", "reason": text[:200], "prompt_sha": ps}
        o["prompt_sha"] = ps
        run_log(run, "gate/merge_calls.jsonl", {"a": a["asin"], "b": b["asin"], **o})
        return o
    return judge, merge, n


def run_log(run, rel, rec):
    p = run.dir / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    with open(p, "a") as f:
        f.write(json.dumps(rec) + "\n")


def hero_pos(title, hero_regex):
    m = re.search(hero_regex, title or "", re.I)
    return m.start() if m else None
