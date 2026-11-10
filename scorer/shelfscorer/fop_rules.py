"""Gautam's shelf rules from the 10 Nov 2026 label round, as pure functions (unit-tested in tests/test_fop_rules.py).

R1 Adults & Kids on a kids shelf: IN only if kids is first or bigger on the front of the pack, else OUT.
R2 Condition-led formula containing the hero: IN only if the hero is the biggest word on the front, else OUT.
R3 Hero sharing the front equally with another ingredient: IN (the bigger-printed-dose rule still applies).
R4 Unisex ("men & women") product on a "for women" / "for men" shelf: OUT.

A spec opts into R1/R4 with "audience": "kids" | "women" | "men". R2 and R3 apply on every shelf.
The front-of-pack reader quotes the front largest text first, so "first in front_text" means "first or bigger".
"""
import re

_B, _E = r"(?<![a-z])", r"(?![a-z])"
AUDIENCE = {
    "women": (_B + r"(?:wom[ae]n'?s?|female|ladies|her)" + _E, _B + r"(?:men'?s?|male|him|unisex)" + _E),
    "men": (_B + r"(?:men'?s?|male|him)" + _E, _B + r"(?:wom[ae]n'?s?|female|ladies|her|unisex)" + _E),
    "kids": (_B + r"(?:kids?'?s?|child(?:ren)?'?s?|toddlers?|little ones)" + _E,
             _B + r"(?:adults?|grown[- ]?ups?|whole family|family)" + _E),
}
# Title words that may mark a condition-led formula; the front-of-pack reader then says whether the headline is one.
CONDITION_HINT = re.compile(r"\b(support|relief|flush|health|formula|defen[cs]e|care|cleanse|detox|recovery|sleep|"
                            r"calm|stress|memory|focus|immune|joint|uric|gout|mood)\b", re.I)


def _pos(rx, text):
    m = re.search(rx, text or "", re.I)
    return m.start() if m else None


def audience_mixed(text, audience):
    """True when the text names both the shelf audience and another audience (e.g. 'Adults & Kids')."""
    if audience not in AUDIENCE:
        return False
    tgt, oth = AUDIENCE[audience]
    return _pos(tgt, text) is not None and _pos(oth, text) is not None


def r4_unisex_out(title, audience):
    """R4: on a for-women / for-men shelf a unisex title is OUT."""
    return audience in ("women", "men") and audience_mixed(title, audience)


def r1_kids_front(front_text):
    """R1: True if kids comes first (largest first) on the front, False if not or kids is missing, None if unreadable."""
    if not front_text:
        return None
    tgt, oth = AUDIENCE["kids"]
    k, a = _pos(tgt, front_text), _pos(oth, front_text)
    if k is None:
        return False
    return a is None or k < a


def r2_condition_ok(fop, hero_regex):
    """R2: a condition-led pack counts only when the hero is the biggest word on the front."""
    big = fop.get("largest_text") or ""
    return bool(big) and re.search(hero_regex, big, re.I) is not None


def hero_leads(fop, hero_regex):
    """Hero is the main ingredient, or shares the lead equally (R3); then the printed-dose rule. Returns (bool|None, note)."""
    mi = fop.get("main_ingredient")
    co = [c for c in (fop.get("co_leads") or []) if isinstance(c, str)]
    if not mi and not co:
        return None, None
    lead = bool(mi and re.search(hero_regex, mi, re.I))
    note = None
    if not lead and any(re.search(hero_regex, c, re.I) for c in co):
        lead, note = True, "R3 hero shares the front equally"
    doses = [x for x in (fop.get("front_doses") or []) if isinstance(x, dict) and isinstance(x.get("mg"), (int, float))]
    hero_mg = max([x["mg"] for x in doses if re.search(hero_regex, str(x.get("ingredient")), re.I)], default=None)
    other_mg = max([x["mg"] for x in doses if not re.search(hero_regex, str(x.get("ingredient")), re.I)], default=None)
    if lead and hero_mg is not None and other_mg is not None and other_mg > hero_mg:
        return False, f"another ingredient printed at {other_mg} mg vs hero {hero_mg} mg"
    return lead, note


def decide(fop, spec, title, was_in, gate_code=None):
    """Front-of-pack decision for one listing. Returns (decision, reason): decision is "IN", "OUT", "NEEDS_CHECK"
    or None (no change to the gate verdict)."""
    hero = spec["hero_regex"]
    ft = fop.get("front_text") or ""
    aud = spec.get("audience")
    lead, note = hero_leads(fop, hero)
    if lead is None:
        return "NEEDS_CHECK", "front of pack unreadable"
    # R4 and R1 first: they decide on audience whatever the ingredient order.
    if r4_unisex_out(title, aud) or r4_unisex_out(ft, aud):
        return ("OUT", "R4 unisex product on a single-gender shelf") if was_in else (None, "R4 blocks a rescue")
    kids_rule = aud == "kids" and (audience_mixed(title, "kids") or audience_mixed(ft, "kids"))
    if kids_rule and not r1_kids_front(ft):
        return ("OUT", "R1 adults named first or bigger than kids on the front") if was_in else (None, "R1 blocks a rescue")
    cond = fop.get("headline_is_condition") is True
    if cond and not r2_condition_ok(fop, hero):
        return ("OUT", "R2 condition-led and the hero is not the biggest word on the front") if was_in \
            else (None, "R2 blocks a rescue")
    if lead is False:
        return ("OUT", note or "another ingredient leads the front") if was_in else (None, note)
    # lead is True from here
    if was_in:
        return None, note
    named = re.search(hero, ft, re.I) is not None
    excluded = gate_code == "EX_SPEC_EXCLUDE" or (spec.get("hero_exclude_regex")
                                                  and re.search(spec["hero_exclude_regex"], ft, re.I))
    if named and not excluded:
        why = "R2 condition-led but the hero is the biggest word" if cond else (note or "hero leads the front")
        if kids_rule:
            why += "; R1 kids first on the front"
        return "IN", why
    return None, "rescue refused (hero not on the front or spec exclusion)"
