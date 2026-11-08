import sys, os, unittest
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from shelfscorer import pillars as P, config as K


class T(unittest.TestCase):
    def test_rala_worked_example(self):
        # Spec 3.5(e): R-ALA M1 392, M2 2070.67, M3 374.1 -> C_v8 6.6031; C = 8.70 + .25*(6.6031-9.61) = 7.948
        cv = P.c_v8({"M1": 392, "M2": 2070.67, "M3": 374.1})
        self.assertAlmostEqual(cv, 6.6031, places=3)
        self.assertAlmostEqual(8.70 + 0.25 * (cv - 9.61), 7.948, places=3)
        # 3.7: D 5, G 8.6, C 7.948, Diff 5.08 -> raw 65.27
        r = P.composite(5, 8.6, 7.948, 5.08, demand_ok=True, n_kept=20, n_sig=12, moat=9.61)
        self.assertAlmostEqual(r["raw"], 65.27, places=1)
        self.assertEqual(r["tier"], "strong")

    def test_caps_hold_at_59_9(self):
        r = P.composite(8, 8, 9, 9, demand_ok=True, n_kept=20, n_sig=5, moat=9)
        self.assertEqual(r["score"], 59.9)
        self.assertIn("sales_rank_pending", r["soft"])

    def test_hard_gates(self):
        r = P.composite(2, 8, 9, 9, demand_ok=True, n_kept=20, n_sig=12, moat=9)
        self.assertEqual(r["tier"], "ineligible")

    def test_demand_bands(self):
        self.assertEqual(P.demand_score(12000, 60000, 21)[3], 3 + 2 + 2)
        self.assertEqual(P.demand_gate(99, 9, 1e6)[0], False)
        self.assertEqual(P.demand_gate(1500, 2, 0)[0], True)

    def test_growth(self):
        tot = {f"2025-{m:02d}-01": [100, 10] for m in range(1, 13)}
        tot["2026-01-01"] = [200, 20]
        g3, g6, y = P.growth_windows(tot)
        self.assertEqual(y, 100.0)
        self.assertEqual(P.ws(None), 4)

    def test_diff_applicable_vectors(self):
        v = {k: 6 for k in K.DIFF_VECTORS}
        v["cfu_strain_specificity"] = 0
        self.assertEqual(P.diff_from_vectors(v, microbial=False), 6)
        self.assertEqual(P.diff_from_vectors(v, microbial=True), 5)

    def test_measures(self):
        M = P.shelf_measures([10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 1, 1])
        self.assertEqual(M["M2"], 9)
        self.assertEqual(M["M1"], 4.5)


if __name__ == "__main__":
    unittest.main()
