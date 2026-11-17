"""Gautam, 17 Nov 2026: Diff = mean of 3 judge runs at temp 0 with the spread recorded; and an info-only
"small market" flag when the top 12 sell under about 3,000 a month (epicatechin)."""
import unittest

from shelfscorer import config as K, pillars as P


class DiffMean(unittest.TestCase):
    def test_three_runs(self):
        self.assertEqual(K.DIFF_CALLS, 3)

    def test_mean_not_median(self):
        a = P.diff_aggregate([5.0, 5.2, 7.0])
        self.assertAlmostEqual(a["score"], 17.2 / 3)
        self.assertAlmostEqual(a["spread"], 2.0)
        self.assertTrue(a["unstable"])

    def test_tight_runs(self):
        a = P.diff_aggregate([6.0, 6.2, 6.4])
        self.assertAlmostEqual(a["score"], 6.2)
        self.assertAlmostEqual(a["spread"], 0.4)
        self.assertFalse(a["unstable"])


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
