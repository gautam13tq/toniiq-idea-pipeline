"""Open gap tier (Gautam, 12 Nov 2026): the sleeve passes demand but fewer than 3 specialised products serve it."""
import unittest

from shelfscorer import config as K, pillars as P, steps as S


def comp(n_kept, demand_ok=True, sales_ok=False, D=6):
    return P.composite(D, 7.2, 6.9, 5.6, demand_ok=demand_ok, n_kept=n_kept, n_sig=1, moat=8, info=[],
                       sales_ok=sales_ok)


class OpenGapTier(unittest.TestCase):
    def test_one_specialised_product_is_open_gap(self):
        r = comp(1)
        self.assertEqual(r["tier"], K.OPEN_GAP)
        self.assertIsNone(r["score"])
        self.assertIn("fewer than 3 genuine competitors", r["hard"])

    def test_open_gap_needs_demand(self):
        self.assertEqual(comp(1, demand_ok=False)["tier"], "ineligible")
        self.assertEqual(comp(1, D=2)["tier"], "ineligible")

    def test_sales_gate_alone_stays_ineligible(self):
        self.assertEqual(comp(5, sales_ok=False)["tier"], "ineligible")

    def test_three_competitors_scores_normally(self):
        r = comp(3, sales_ok=True)
        self.assertNotIn(r["tier"], (K.OPEN_GAP, "ineligible"))
        self.assertIsNotNone(r["score"])

    def test_report(self):
        dg = {"agg_clicks": 15245, "cluster_keywords_with_data": list(range(16)), "yoy": 145.8,
              "primary_kw": "magnesium complex for men"}
        top = [{"asins": ["A1"], "primary_asin": "A1", "brand": "Micro", "title": "Mg for Men", "monthly_sold": 600}]
        pp = {"A1": [1, 3], "U1": [1, 1], "U2": [1, 2], "U3": [1, 4], "P2": [2, 1]}
        dec = {"U1": {"code": "EX_UNISEX"}, "U2": {"code": "EX_UNISEX"}, "U3": {"code": "EX_HERO_MISSING"}}
        mon = {"A1": 600, "U1": 5000, "U2": 3000, "U3": 400}
        r = S.open_gap_report(dg, top, pp, dec, mon)
        self.assertEqual(r["demand"], {"clicks": 15245, "phrasings": 16, "yoy_pct": 145.8,
                                       "primary_kw": "magnesium complex for men"})
        self.assertEqual(r["page1"]["listings"], 4)
        self.assertEqual(r["page1"]["specialised"], 1)
        self.assertEqual(r["page1"]["other_share"], 0.75)
        self.assertEqual(r["page1"]["other_badge_share"], round(8400 / 9000, 3))
        self.assertEqual(r["page1"]["other_by_gate_code"], {"EX_UNISEX": 2, "EX_HERO_MISSING": 1})
        self.assertEqual(r["specialised"][0]["monthly_sold"], 600)


if __name__ == "__main__":
    unittest.main()
