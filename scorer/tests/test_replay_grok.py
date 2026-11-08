"""Test A (spec section 7): our maths reproduces Grok's fork v7.4 on all 69 rows within 0.05.
Needs Grok's raw export laid out at /workspace/challenge-65 (handoff code + grok_raw_export_2026-11-08.zip)."""
import os, sys, unittest
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from shelfscorer import pillars as P

W = "/workspace/challenge-65/fork/v74"


@unittest.skipUnless(os.path.exists(W + "/c74.py"), "Grok raw export not laid out at /workspace/challenge-65")
class ReplayGrok(unittest.TestCase):
    def test_69_rows(self):
        cwd = os.getcwd()
        sys.path.insert(0, W)
        os.chdir(W)
        try:
            import c74
            rows = c74.run(cmode="v8", blend="moatpart", ps_cap=False, T=61.5)
        finally:
            os.chdir(cwd)
        n = 0
        for x in rows:
            if x["C_old"] is None:
                continue
            C = x["C_old"] + 0.25 * (P.c_v8({k: x[k] for k in ("M1", "M2", "M3")}) - x["moat"]) if (x.get("n_top") or 0) >= 3 else x["C_old"]
            raw = 10 * (0.25 * x["D"] + 0.05 * x["G"] + 0.45 * C + 0.25 * x["Df"])
            self.assertAlmostEqual(raw, x["fork_raw"], delta=0.05, msg=x["full"])
            n += 1
        self.assertEqual(n, 69)
