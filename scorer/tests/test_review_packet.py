"""Review packet and reconcile (12 Nov 2026): the blind listings carry no scorer decisions; reconcile lists disagreements."""
import json, os, shutil, subprocess, sys, tempfile, unittest
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.dirname(__file__))
import fake_apis
from shelfscorer import steps as S, clients
from shelfscorer.runlog import Run, now
import run_shelf
from test_e2e import SPEC

TOOLS = os.path.join(os.path.dirname(__file__), "..", "tools")
sys.path.insert(0, TOOLS)
import review_packet  # noqa: E402


class Packet(unittest.TestCase):
    def setUp(self):
        self.saved = {n: getattr(clients, n) for n in ("datarova_keywords", "keepa", "apify_search", "anthropic")}
        fake_apis.install(lambda mod, n, f: setattr(mod, n, f))
        self.tmp = tempfile.mkdtemp()
        r = Run.open(self.tmp, "idea-x", SPEC["shelf_keyword"], "test", {"shelf_cap_usd": 5})
        r.step_done("open", "V-OPEN", True)
        S.step_spec(r, dict(SPEC, written_at=now()))
        run_shelf.go(r)
        self.run = r

    def tearDown(self):
        for n, f in self.saved.items():
            setattr(clients, n, f)
        shutil.rmtree(self.tmp)

    def test_packet_is_blind_and_reconcile_flags_disagreements(self):
        out, n = review_packet.build(self.run.dir, os.path.join(self.tmp, "review"))
        for f in ("shelf.json", "listings.json", "RULES.md", "decisions.json"):
            self.assertTrue((out / f).exists(), f)
        L = json.loads((out / "listings.json").read_text())["listings"]
        self.assertEqual(len(L), n)
        self.assertLessEqual(len(L), review_packet.N_TOP + review_packet.N_NEAR)
        for x in L:
            self.assertEqual(set(x), {"asin", "brand", "title", "bullets", "image", "monthly_sold", "reviews", "family_asins"})
        rules = (out / "RULES.md").read_text()
        for w in ("R1 Adults & Kids", "Sleeve rule", "Growth is a penalty", "astaxanthin 12mg"):
            self.assertIn(w, rules)
        dec = json.loads((out / "decisions.json").read_text())["decisions"]
        self.assertEqual(set(dec), {x["asin"] for x in L})
        agree = {a: d["scorer"] for a, d in dec.items()}
        flip = dict(agree); a0 = next(iter(flip)); flip[a0] = "OUT" if flip[a0] == "IN" else "IN"
        (out / "judge_grok.json").write_text(json.dumps({"judge": "grok", "verdicts": {a: {"decision": v} for a, v in agree.items()}}))
        (out / "judge_cursor.json").write_text(json.dumps(flip))
        p = subprocess.run([sys.executable, os.path.join(TOOLS, "reconcile_review.py"), str(out)], capture_output=True, text=True)
        self.assertEqual(p.returncode, 1, p.stderr)
        rec = json.loads((out / "reconcile.json").read_text())
        self.assertEqual([r["asin"] for r in rec["check"]], [a0])
        self.assertEqual(rec["check"][0]["disagreeing"], ["cursor"])


if __name__ == "__main__":
    unittest.main()
