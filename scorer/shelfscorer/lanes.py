"""Lane vs parent shelf (Gautam, 11 Nov 2026).

The competitor set stays the lane the idea names (capsules, gummies, powder, for women ...) when that lane has real
sellers. When the lane's top 12 has too few genuine sellers, the idea is rescored on the parent shelf (the demand
keyword) and the result is flagged scored_on=parent, with the lane run kept as evidence.
"""
from . import config as K

LANE_FIELDS = ("gate_format", "form", "other_forms", "required_regex", "qualifier_regex", "audience", "modifier")


def is_lane_spec(spec):
    dk = (spec.get("demand_keyword") or "").lower()
    return bool(dk) and dk != spec["shelf_keyword"].lower()


def needs_parent_fallback(spec, score, n_sig):
    """True when a lane run did not find enough genuine sellers to stand as the competitor set."""
    if not is_lane_spec(spec):
        return False
    hard = score.get("hard") or []
    soft = score.get("soft") or []
    thin = any("fewer than 3 genuine competitors" in h for h in hard) or any(s.startswith("thin_shelf") for s in soft)
    return thin or (n_sig or 0) < K.LANE_MIN_BADGED


def parent_spec(spec, lane_run_id, written_at):
    """The parent-shelf spec: shelf keyword = demand keyword, lane co-terms removed, same hero and exclusions."""
    p = {k: v for k, v in spec.items() if k not in LANE_FIELDS}
    dk = spec["demand_keyword"]
    cl = [dk] + [k for k in (spec.get("demand_cluster") or []) if k.lower() != dk.lower()]
    p.update(shelf_keyword=dk, cluster_keywords=cl[:12], finder_terms=[dk], candidate_subniches=[],
             scored_on="parent", lane_shelf_keyword=spec["shelf_keyword"], lane_run=lane_run_id, written_at=written_at,
             spec_round=(spec.get("spec_round") or "") + f" | parent fallback from lane '{spec['shelf_keyword']}'")
    return p
