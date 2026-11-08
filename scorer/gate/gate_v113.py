"""Gate v11.3 = frozen v11.2 + two rules Gautam confirmed on 8 Nov 2026. v11.2 files are not edited.

R14-1 condition-led formulas OUT (29 Oct ruling): handled by the judge through the decisions file; a hero-first title
       under a condition headline is sent to the judge (UNSURE) rather than passed.
R14-2 whole food by weight with no supplement form and no serving dose -> OUT EX_NOT_SUPPLEMENT; a weight unit with a
       form word -> UNSURE (judge).
"""
import os, re
import gate_v112 as G2
from gate_v112 import SH, INC, sold, add_holdout_specs, spec_text, listing_text, collapse, merge_candidates  # noqa

I = re.I
_D = os.path.dirname(os.path.abspath(__file__))
JUDGE_PROMPT = os.path.join(_D, "judge_prompt_v112.txt")
MERGE_PROMPT = os.path.join(_D, "judge_merge_prompt_v111.txt")
DECISIONS = os.path.join(_D, "GAUTAM_DECISIONS_v113.md")

WEIGHT = re.compile(r"\b\d+(?:\.\d+)?\s*(?:oz|ounces?|lbs?|pounds?|g|grams?|kg|kilograms?)\b", I)
FORMW = re.compile(r"\b(capsules?|caps|vcaps|softgels?|tablets?|tabs|gumm(?:y|ies)|chewables?|drops|tincture|liquid|"
                   r"extract|supplement|powder)\b", I)
SERVE = re.compile(r"\bserving|\bper\s+day|\bscoop|\bteaspoon|\btsp\b|\btablespoon|\bdaily\s+dose|\btake\s+\d", I)
CONDITION = re.compile(r"^\s*(?:[\w'’&-]+\s+){0,3}(joint|sciatic|sciatica|nerve|bone|prostate|liver|kidney|heart|blood\s+sugar|"
                       r"sleep|stress|immune|gut|digestive|eye|vision|memory|brain|menopause|thyroid|hair)\s+"
                       r"(relief|support|formula|health|complex|care|defense)\b", I)


def _copy(x):
    b = x.get("bullets")
    b = " | ".join(b) if isinstance(b, list) else str(b or "")
    return b + " | " + str(x.get("ingredients") or "") + " | " + str(x.get("description") or "")


_V112_CLASSIFY3 = G2.classify3


def classify3(shelf, x):
    v, code, det, f, u = _V112_CLASSIFY3(shelf, x)
    t = x.get("title") or ""
    if v != "OUT" and WEIGHT.search(t):
        if not FORMW.search(t + " " + str(x.get("item_form") or "")) and not SERVE.search(_copy(x)):
            return "OUT", "EX_NOT_SUPPLEMENT", "R14-2 whole food sold by weight, no supplement form or serving dose", f, None
        if v == "IN" and not SERVE.search(_copy(x)) and not re.search(r"\b(capsules?|softgels?|tablets?|gumm)", t, I):
            return "UNSURE", code, det, f, "U14 weight unit in title with a form word (R14-2, judge)"
    if v == "IN" and CONDITION.search(t):
        return "UNSURE", code, det, f, "U15 condition-led headline (R14-1, judge)"
    return v, code, det, f, u


def judge_prompt(shelf, x):
    x = G2._fold_rec(x)
    return open(JUDGE_PROMPT).read().replace("{{SPEC}}", spec_text(shelf)).replace("{{LISTING}}", listing_text(x)) \
        .replace("{{DECISIONS}}", open(DECISIONS).read())


def merge_prompt(shelf, a, b):
    return open(MERGE_PROMPT).read().replace("{{SPEC}}", spec_text(shelf)).replace("{{LISTING_A}}", listing_text(a)) \
        .replace("{{LISTING_B}}", listing_text(b)).replace("{{DECISIONS}}", open(DECISIONS).read())


def run_shelf(shelf, recs, k=12, judge_fn=None, merge_fn=None):
    """Same as v11.2 run_shelf, with classify3 from v11.3. Implemented by swapping the module-level classify3."""
    G2.classify3 = classify3
    try:
        return G2.run_shelf(shelf, recs, k=k, judge_fn=judge_fn, merge_fn=merge_fn)
    finally:
        G2.classify3 = _V112_CLASSIFY3
