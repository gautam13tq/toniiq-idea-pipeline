"""Gate v11.4 = v11.3 + the powder stick/packet fix (27 Nov 2026). v11.3 and older files are not edited.

Known gap logged 25 Nov 2026 (records/amazon-ideas-system/CONTEXT.md): powder stick/packet shelves lost real
competitors two ways. Gautam's 20 Nov rule is that a Grocery-listed powder stick counts when the format matches and the
shelf ingredient leads, counted once per line (the variant collapse keeps the best-selling flavour).

R15-1 Grocery drink-mix powders. The v9.3 "beverage category" exclusion (Grocery > Beverages crumb and no supplement
      hint in the title) is undone when the title names a powder, drink mix, stick or packet and nothing marks it as
      ready to drink (fl oz, bottles, cans, ready-to-drink, RTD, liter). The listing is reclassified with the category
      crumb blanked, so every other rule (hero lead, format, sleeve co-term, kids, pets) still applies. Only on shelves
      with no format or the powder format.
R15-2 Brand words are not format words. A listing ruled "liquid on powder shelf" whose only liquid word is in the brand
      (Liquid I.V.) is reclassified with the brand blanked out of the title, so the format is read from the rest of
      the title, then bullets, then Item Form.
The title-only sleeve co-term (Gautam 19 Nov: the sleeve word must be in the title) is unchanged: a "16 Count" title
with no stick/packet word still needs the hand front-of-pack check.
"""
import re
import gate_v113 as V3
import gate_v112 as G2
from gate_v113 import SH, INC, sold, add_holdout_specs, spec_text, listing_text, collapse, merge_candidates  # noqa
from gate_v113 import judge_prompt, merge_prompt, judge, judge_merge, JUDGE_PROMPT, MERGE_PROMPT, DECISIONS  # noqa

I = re.I
POWDERMIX = re.compile(r"\b(powders?|drink\s*mix(es)?|stick\s*packs?|sticks?|stix|packets?|single[- ]serv\w*|"
                       r"hydration\s+multiplier|water\s+flavou?ring)\b", I)
RTD = re.compile(r"\b(fl\.?\s*oz|fluid\s+ounces?|bottles?|cans?|ready[- ]to[- ]drink|rtd|liters?|litres?|"
                 r"\d+\s*ml|shots?)\b", I)
LIQIV = re.compile(r"\bliquid\s*i\.?\s*v\b\.?", I)
LIQW = re.compile(r"\bliquids?\b", I)


def _blank(t, pat):
    return pat.sub(lambda m: " " * len(m.group(0)), t)


def _brand_blank(x):
    t = x.get("title") or ""
    b = (x.get("brand") or "").strip()
    if len(b) >= 3:
        t = re.sub(re.escape(b), lambda m: " " * len(m.group(0)), t, flags=I)
    return _blank(t, LIQIV)


def classify3(shelf, x):
    r = V3.classify3(shelf, x)
    x2, notes = dict(x), []
    fmt = SH[shelf].get("fmt")
    for _ in range(3):
        v, code, det, f, u = r
        t = x2.get("title") or ""
        if (v == "OUT" and code == "EX_NOT_SUPPLEMENT" and det == "beverage category" and fmt in (None, "", "powder")
                and "R15-1" not in notes and POWDERMIX.search(t) and not RTD.search(t)):
            x2["crumbs"] = ""
            notes.append("R15-1")
        elif (v == "OUT" and code == "EX_FORMAT_MISMATCH" and str(det).startswith("liquid on") and "R15-2" not in notes
              and LIQW.search(t) and not LIQW.search(_brand_blank(x2))):
            x2["title"] = _brand_blank(x2)
            notes.append("R15-2")
        else:
            break
        r = V3.classify3(shelf, x2)
    if notes:
        v, code, det, f, u = r
        return v, code, f"{det} [{'+'.join(notes)} powder stick fix]", f, u
    return r


def run_shelf(shelf, recs, k=12, judge_fn=None, merge_fn=None):
    """Same as v11.3 run_shelf, with classify3 from v11.4 (module-level swap, as v11.3 does)."""
    G2.classify3 = classify3
    try:
        return G2.run_shelf(shelf, recs, k=k, judge_fn=judge_fn, merge_fn=merge_fn)
    finally:
        G2.classify3 = V3._V112_CLASSIFY3
