"""Demand rule (Gautam, 11 Nov 2026): demand and growth on the parent head term; lane shelf with parent fallback."""
import unittest

from shelfscorer import pillars as P, lanes as L


def kw(name, clicks, sales=None, months=13):
    recs = [{"date": f"{2025 + (i + 9) // 12}-{(i + 9) % 12 + 1:02d}-01", "clicks": clicks, "sales": sales or clicks // 4}
            for i in range(months)]
    return {"keyword": name, "records": recs}


SPEC = {"shelf_keyword": "colostrum capsules", "hero_regex": "colostrum", "gate_format": "pill",
        "qualifier_regex": "capsule|pill", "cluster_keywords": ["colostrum capsules", "colostrum pills"],
        "demand_keyword": "colostrum", "demand_cluster": ["colostrum", "colostrum supplement", "colostrum powder"]}
DATA = [kw("colostrum capsules", 845), kw("colostrum pills", 290), kw("colostrum", 15509),
        kw("colostrum supplement", 3188), kw("colostrum powder", 9000)]


class DemandTerms(unittest.TestCase):
    def test_primary_is_parent_and_cluster_merges(self):
        prim, cl = P.demand_terms(SPEC)
        self.assertEqual(prim, "colostrum")
        self.assertEqual(cl[0], "colostrum")
        self.assertTrue({"colostrum capsules", "colostrum pills", "colostrum powder"} <= set(cl))

    def test_old_spec_falls_back_to_shelf_keyword(self):
        prim, cl = P.demand_terms({"shelf_keyword": "spermidine", "cluster_keywords": ["spermidine"]})
        self.assertEqual((prim, cl), ("spermidine", ["spermidine"]))

    def test_cluster_capped_at_pull_max(self):
        s = dict(SPEC, demand_cluster=[f"colostrum v{i}" for i in range(60)])
        self.assertEqual(len(P.demand_terms(s)[1]), 44)

    def test_long_tail_lane_no_longer_fails_the_demand_gate(self):
        lane = P.demand_growth(DATA, "colostrum capsules", ["colostrum capsules", "colostrum pills"])
        self.assertFalse(lane["demand_gate"]["pass"])           # the 10 Nov failure
        prim, cl = P.demand_terms(SPEC)
        dg = P.demand_growth(DATA, prim, cl)
        self.assertTrue(dg["demand_gate"]["pass"])
        self.assertEqual(dg["primary_clicks"], 15509)
        self.assertEqual(dg["agg_clicks"], 845 + 290 + 15509 + 3188 + 9000)
        self.assertEqual(dg["a"], 3)                             # 10k-100k band on the parent

    def test_lane_clicks_reported(self):
        self.assertEqual(P.lane_clicks(DATA, "colostrum capsules"), 845)
        self.assertEqual(P.lane_clicks(DATA, "colostrum lozenges"), 0)


class ParentFallback(unittest.TestCase):
    def test_thin_lane_falls_back(self):
        self.assertTrue(L.needs_parent_fallback(SPEC, {"hard": ["fewer than 3 genuine competitors"], "soft": []}, 2))
        self.assertTrue(L.needs_parent_fallback(SPEC, {"hard": [], "soft": ["thin_shelf < 8"]}, 9))
        self.assertTrue(L.needs_parent_fallback(SPEC, {"hard": [], "soft": []}, 6))

    def test_healthy_lane_stays(self):
        self.assertFalse(L.needs_parent_fallback(SPEC, {"hard": [], "soft": ["C < 6"]}, 12))

    def test_plain_shelf_never_falls_back(self):
        s = dict(SPEC, shelf_keyword="colostrum")
        self.assertFalse(L.needs_parent_fallback(s, {"hard": ["fewer than 3 genuine competitors"]}, 1))

    def test_parent_spec_drops_lane_terms(self):
        p = L.parent_spec(SPEC, "lane-run-1", "2026-11-11T00:00:00+00:00")
        self.assertEqual(p["shelf_keyword"], "colostrum")
        self.assertEqual(p["scored_on"], "parent")
        self.assertEqual(p["lane_run"], "lane-run-1")
        self.assertNotIn("gate_format", p)
        self.assertNotIn("qualifier_regex", p)
        self.assertEqual(p["cluster_keywords"][0], "colostrum")


if __name__ == "__main__":
    unittest.main()
