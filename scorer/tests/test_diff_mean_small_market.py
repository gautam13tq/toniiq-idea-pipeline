"""Gautam, 17 Nov 2026: Diff = mean of 3 judge runs at temp 0 with the spread recorded; and an info-only
"small market" flag when the top 12 sell under about 3,000 a month (epicatechin)."""
import unittest

from shelfscorer import config as K, pillars as P


class DiffMean(unittest.TestCase):
    """Legacy v1 rule (17-25 Nov 2026), still used to validate runs whose diff.json says method "mean"."""
    def test_mean_not_median(self):
        a = P.diff_aggregate([5.0, 5.2, 7.0], "mean")
        self.assertAlmostEqual(a["score"], 17.2 / 3)
        self.assertAlmostEqual(a["spread"], 2.0)
        self.assertTrue(a["unstable"])

    def test_tight_runs(self):
        a = P.diff_aggregate([6.0, 6.2, 6.4], "mean")
        self.assertAlmostEqual(a["score"], 6.2)
        self.assertAlmostEqual(a["spread"], 0.4)
        self.assertFalse(a["unstable"])


class DiffMedianV11(unittest.TestCase):
    """Gautam, 25 Nov 2026: Diff = median of 5 judge runs, with a score band."""
    def test_five_runs_median(self):
        self.assertEqual(K.DIFF_CALLS, 5)
        a = P.diff_aggregate([3.4, 3.4, 4.8, 4.8, 4.8])
        self.assertAlmostEqual(a["score"], 4.8)
        self.assertEqual(a["method"], "median")


class NewEntrantCapLift(unittest.TestCase):
    """Gautam, 25 Nov 2026: 2+ new entrants in the top 12 lift the moat and C caps."""
    NOW = 1795000000.0

    def fam(self, i, months_ago, reviews, sold):
        km = int((self.NOW - months_ago * 30.4375 * 86400) / 60) - P.KEEPA_EPOCH_MIN
        return {"family_id": f"A{i}", "asins": [f"A{i}"], "reviews": reviews, "monthly_sold": sold}, {f"A{i}": km}

    def entrants(self, *specs):
        top, listed = [], {}
        for i, s in enumerate(specs):
            f, l = self.fam(i, *s); top.append(f); listed.update(l)
        return P.new_entrants(top, listed, self.NOW)

    def test_counts_only_new_small_selling(self):
        ne = self.entrants((6, 300, 2000), (20, 900, 1000), (30, 300, 5000), (6, 1500, 5000), (6, 300, 900))
        self.assertEqual([x["family_id"] for x in ne], ["A0", "A1"])

    def test_lift_needs_two(self):
        args = dict(demand_ok=True, n_kept=20, n_sig=12, moat=5)
        self.assertEqual(P.composite(8, 8, 5, 8, n_new_entrants=1, **args)["score"], 59.9)
        r = P.composite(8, 8, 5, 8, n_new_entrants=2, **args)
        self.assertGreater(r["score"], 59.9)
        self.assertIn("cap lifted: 2 new entrants in the top 12", r["info"])

    def test_other_caps_still_hold(self):
        r = P.composite(8, 8, 5, 8, demand_ok=True, n_kept=20, n_sig=5, moat=5, n_new_entrants=3)
        self.assertEqual(r["score"], 59.9)
        self.assertEqual(r["soft"], ["sales_rank_pending"])


class SmallMarket(unittest.TestCase):
    def top(self, *units):
        return [{"monthly_sold": u} for u in units]

    def test_under_3000_flags(self):
        self.assertEqual(P.small_market(self.top(1000, 900, 500, None)), (True, 2400))

    def test_3000_or_more_does_not(self):
        self.assertEqual(P.small_market(self.top(2000, 1000)), (False, 3000))

    def test_flag_does_not_change_score(self):
        args = dict(demand_ok=True, n_kept=10, n_sig=10, moat=9)
        a = P.composite(6, 6, 7, 6, info=[], **args)
        b = P.composite(6, 6, 7, 6, info=["small market (2,400/month across the top 12)"], **args)
        self.assertEqual((a["raw"], a["score"], a["tier"]), (b["raw"], b["score"], b["tier"]))


if __name__ == "__main__":
    unittest.main()
