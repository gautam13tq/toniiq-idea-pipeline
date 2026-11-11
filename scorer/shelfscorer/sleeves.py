"""Sleeve rule (Gautam, 11 Nov 2026). Replaces the 10 Nov "idea's own phrase if 100+ clicks" pre-registration rule
and the same-day parent-keyword rule.

Toniiq looks for sleeves: a format, dose, audience, variety or pairing inside a parent ("colostrum capsules",
"astaxanthin 24mg") that has its own demand and weaker leaders. Parents are usually too competitive.

1. Sleeve cluster. A sleeve's demand and growth come from every Datarova phrasing of the same sleeve: format synonyms
   (capsules, caps, pills, tablets, softgels), modifiers (bovine, organic, supplement) and word order. Each phrasing
   must name the hero and the sleeve qualifier (and the spec's form), and must not name another format.
2. The parent is context only. Competition and Diff come from the sleeve's own top 12.
3. Default format. If 75%+ of the parent's top 12 by badge are already in the sleeve's format, the sleeve is the
   parent: score the parent keyword and cluster (scored_on = parent_default_format). Only format sleeves can be the
   default; doses, audiences, varieties and pairings are always sleeves.
4. Sleeve gate. A sleeve passes when its cluster has >= 1,000 latest-month clicks over 2+ keyword rows AND its top 12
   sells >= 2,000 a month in summed monthly-sold badges. Parents keep the old gate.
All of these are pure functions; tools/sleeve_terms.py does the Datarova, autocomplete and Keepa pulls.
"""
import re

from . import config as K

GATE_FMT = {  # same words as gate/gate.py FMT, used to read a title's format and to drop other-format phrasings
    "gummy": r"gumm(?:y|ies)",
    "chew": r"soft[- ]?chews?|\bchews?\b(?!able)",
    "pill": r"capsules?|\bcaps\b|vcaps?|veg[- ]?caps|tablets?|softgels?|soft gels|caplets?|\bpills?\b|lozenges?",
    "powder": r"powder\w*|\bground\b|drink mix|stick packs?|\bscoops?\b",
    "liquid": r"liquid|\bdrops\b|tincture|syrup|\bshots?\b|elixir",
    "tea": r"\btea\b", "coffee": r"\bcoffee\b",
}
FORMAT_WORDS = {  # phrasings generated for a format sleeve
    "pill": ["capsules", "capsule", "caps", "pills", "tablets", "softgels", "veggie capsules"],
    "gummy": ["gummies", "gummy", "gummy bears"],
    "powder": ["powder", "powdered", "drink mix", "drink powder"],
    "liquid": ["liquid", "drops", "tincture"],
}
MODIFIERS = ["", "supplement", "supplements", "organic", "pure", "extract", "for women", "for men", "for kids",
             "500mg", "1000mg", "unflavored", "vegan", "high potency", "best"]
PREFIX_MODS = {"organic", "pure", "vegan", "high potency", "best"}   # buyers put these before the hero


def fmt_of(title):
    best = None
    for k, rx in GATE_FMT.items():
        m = re.search(rx, title or "", re.I)
        if m and (best is None or m.start() < best[1]):
            best = (k, m.start())
    return best[0] if best else None


def mode(spec):
    """'sleeve' or 'parent' (parent shelves and parent_default_format)."""
    return "sleeve" if spec.get("scored_on") == "sleeve" else "parent"


def phrasing_ok(k, spec):
    """A Datarova phrasing belongs to the sleeve: hero, sleeve qualifier and form named; no other format; no exclusion."""
    if not re.search(spec["hero_regex"], k, re.I):
        return False
    if spec.get("form") and not re.search(spec["form"], k, re.I):
        return False
    if spec.get("hero_exclude_regex") and re.search(spec["hero_exclude_regex"], k, re.I):
        return False
    if spec.get("scored_on") != "sleeve":
        return True
    if spec.get("sleeve_regex") and not re.search(spec["sleeve_regex"], k, re.I):
        return False
    f = spec.get("gate_format")
    if spec.get("sleeve_kind") == "format" and f:
        others = [x for x in GATE_FMT if x != f and re.search(GATE_FMT[x], k, re.I)]
        if others:
            return False
    return True


def candidate_phrasings(spec, autocomplete=()):
    """Every phrasing worth asking Datarova about: hero names x sleeve words x modifiers in both word orders, the spec's
    own cluster, and Amazon autocomplete suggestions. Filtered with phrasing_ok."""
    heroes = list(spec.get("hero_names") or [spec.get("parent_keyword") or spec["shelf_keyword"]])
    words = list(spec.get("sleeve_words") or [])
    if not words and spec.get("sleeve_kind") == "format":
        words = FORMAT_WORDS.get(spec.get("gate_format"), [])
    out = []
    for h in heroes:
        for w in words or [""]:
            for m in MODIFIERS:
                if spec.get("sleeve_kind") == "format":
                    out.append(" ".join(x for x in ((m, h, w) if m in PREFIX_MODS else (h, m, w)) if x))
                    if m and m not in PREFIX_MODS:
                        out.append(" ".join(x for x in (h, w, m) if x))       # "colostrum capsules for women"
                    if w.endswith("ed"):          # "powdered magnesium glycinate"
                        out.append(" ".join(x for x in (w, h, m) if x))
                else:                              # dose / audience / variety / pairing: the word is part of the name
                    out.append(" ".join(x for x in ((m, w, h) if m in PREFIX_MODS else (w, h, m)) if x))
                    out.append(" ".join(x for x in (h, w, m) if x))
    out += list(spec["cluster_keywords"]) + [a.lower().strip() for a in autocomplete]
    seen, res = set(), []
    for k in out:
        k = re.sub(r"\s+", " ", k.lower()).strip()
        if k and k not in seen and phrasing_ok(k, spec):
            seen.add(k)
            res.append(k)
    return res


def default_format_share(parent_top, fmt):
    """Share of the parent's top 12 by monthly-sold badge already in the sleeve's format.
    parent_top: [{asin, title, monthly_sold}] sorted by badge, at most 12. A pill shelf counts a title with no format
    word but a printed mg dose as a pill (the gate's FORMAT_INFERRED_PILL)."""
    if not parent_top:
        return 0.0, []
    rows = []
    for p in parent_top[:K.SHELF_SIZE]:
        f = fmt_of(p.get("title") or "")
        if f is None and fmt == "pill" and re.search(r"\d\s*(mg|mcg|iu)\b", p.get("title") or "", re.I):
            f = "pill"
        rows.append({**p, "format": f, "in_format": f == fmt})
    return sum(r["in_format"] for r in rows) / len(rows), rows


def is_default_format(spec, share):
    return spec.get("sleeve_kind") == "format" and share >= K.DEFAULT_FORMAT_SHARE


LANE_FIELDS = ("gate_format", "form", "other_forms", "required_regex", "qualifier_regex", "audience", "modifier",
               "sleeve_regex", "sleeve_words", "sleeve_cluster", "sleeve_kind")


def parent_default_spec(spec, parent_cluster, share, written_at):
    """The format is the parent's default, so the shelf is the parent: parent keyword, parent cluster, no format gate.
    The spec's form (e.g. glycinate) is kept because it names the parent itself."""
    p = {k: v for k, v in spec.items() if k not in LANE_FIELDS or k == "form"}
    pk = spec["parent_keyword"]
    cl = [pk] + [k for k in parent_cluster if k.lower() != pk.lower()]
    p.update(shelf_keyword=pk, cluster_keywords=cl[:12], finder_terms=[pk], candidate_subniches=[],
             demand_keyword=pk, demand_cluster=cl[:K.DEMAND_PULL_MAX], scored_on="parent_default_format",
             sleeve_shelf_keyword=spec["shelf_keyword"], default_format_share=round(share, 3), written_at=written_at)
    return p


def sleeve_sales(top12):
    return sum((f.get("monthly_sold") or 0) for f in top12)


def sleeve_gate(cluster_clicks, n_rows):
    """Part 1 (before any Keepa spend): cluster clicks and rows."""
    if cluster_clicks < K.SLEEVE_MIN_CLICKS:
        return False, f"sleeve cluster {cluster_clicks:,} < {K.SLEEVE_MIN_CLICKS:,} clicks"
    if n_rows < K.SLEEVE_MIN_ROWS:
        return False, f"sleeve cluster has {n_rows} keyword row(s) with data, needs {K.SLEEVE_MIN_ROWS}"
    return True, f"sleeve cluster {cluster_clicks:,} clicks over {n_rows} rows"


def sleeve_sales_gate(spec, top12):
    """Part 2 (after ranking): the sleeve's top 12 must sell. Returns (pass, why); parents always pass here."""
    if mode(spec) != "sleeve":
        return True, "parent: old gate"
    s = sleeve_sales(top12)
    if s < K.SLEEVE_MIN_BADGES:
        return False, f"sleeve top 12 sells {s:,}/month < {K.SLEEVE_MIN_BADGES:,}"
    return True, f"sleeve top 12 sells {s:,}/month"
