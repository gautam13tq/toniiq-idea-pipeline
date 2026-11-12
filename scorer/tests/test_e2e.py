import os, sys, json, shutil, tempfile, unittest
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.dirname(__file__))
import fake_apis
from shelfscorer import steps as S, validate as V, write_score as W, clients
from shelfscorer.runlog import Run, now
import run_shelf

SPEC = {"shelf_keyword": "astaxanthin 12mg", "hero_regex": "astaxanthin|astaxanthine|astapure|bioastin",
        "cluster_keywords": ["astaxanthin 12mg", "astaxanthin 12 mg", "astaxanthin 12mg softgels"],
        "parent_keyword": "astaxanthin", "microbial": False, "hero_name": "astaxanthin",
        "demand_keyword": "astaxanthin 12mg", "scored_on": "parent"}


class E2E(unittest.TestCase):
    def setUp(self):
        self.saved = {n: getattr(clients, n) for n in ("datarova_keywords", "keepa", "apify_search", "anthropic")}
        fake_apis.install(lambda mod, n, f: setattr(mod, n, f))
        self.tmp = tempfile.mkdtemp()

    def tearDown(self):
        for n, f in self.saved.items():
            setattr(clients, n, f)
        shutil.rmtree(self.tmp)

    def new_run(self):
        r = Run.open(self.tmp, "idea-x", SPEC["shelf_keyword"], "test", {"shelf_cap_usd": 5})
        r.step_done("open", "V-OPEN", True)
        S.step_spec(r, dict(SPEC, written_at=now()))
        return r

    def _apify_401(self):
        def fail(run, keyword, label):
            def fn():
                raise clients.ApifyFailed("apify failed: HTTPError 401", 401)
            return run.call("apify", clients.K.APIFY_ACTOR, {"keyword": keyword}, fn, raw_rel=f"apify/{label}.json")
        clients.apify_search = fail

    def test_no_apify_fallback_is_opt_in(self):
        self._apify_401()
        r = self.new_run()
        with self.assertRaises(clients.ApifyFailed):
            run_shelf.go(r)

    def test_no_apify_fallback_flags_the_score_and_warns(self):
        self._apify_401()
        r = Run.open(self.tmp, "idea-x", SPEC["shelf_keyword"], "test", {"shelf_cap_usd": 5, "allow_no_apify": True})
        r.step_done("open", "V-OPEN", True)
        S.step_spec(r, dict(SPEC, written_at=now()))
        run_shelf.go(r)
        rep = V.validate(r)
        self.assertEqual(rep["blockers_failed"], 0, json.dumps([c for c in rep["checks"] if not c["pass"]], indent=1))
        warns = {c["check"] for c in rep["checks"] if not c["pass"] and c["severity"] == "WARN"}
        self.assertTrue({"V-CALLS-APIFY", "V-CAND-APIFY"} <= warns)
        self.assertIn("no_apify_page1", r.read("score.json")["info"])
        cand = r.read("candidates.json")
        self.assertTrue(any(w.startswith("keepa_page1:") for v in cand["candidates"].values() for w in v))
        self.assertTrue(cand["page_pos"])

    def test_apify_checks_stay_blockers_without_the_flag(self):
        r = self.new_run()
        run_shelf.go(r)
        rep = V.validate(r)
        sev = {c["check"]: c["severity"] for c in rep["checks"]}
        self.assertEqual(sev["V-CALLS-APIFY"], "BLOCKER")
        self.assertEqual(sev["V-CAND-APIFY"], "BLOCKER")

    def test_full_run_validates_and_publishes(self):
        r = self.new_run()
        run_shelf.go(r)
        rep = V.validate(r)
        failed = [c for c in rep["checks"] if not c["pass"] and c["severity"] == "BLOCKER"]
        self.assertEqual(failed, [], json.dumps(failed, indent=1))
        sc = r.read("score.json")
        self.assertEqual(len(r.read("top12.json")), 12)
        self.assertIsNotNone(sc["score"])
        row = W.publish(r, supabase=False)
        self.assertEqual(row["score"], sc["score"])

    def test_missing_datarova_call_blocks(self):
        r = self.new_run()
        run_shelf.go(r)
        lines = [l for l in r.calls_path.read_text().splitlines() if '"datarova"' not in l]
        r.calls_path.write_text("\n".join(lines) + "\n")
        rep = V.validate(r)
        self.assertTrue(any(c["check"] == "V-CALLS" and not c["pass"] for c in rep["checks"]))
        with self.assertRaises(W.Refused):
            W.publish(r, supabase=False)

    def test_hand_edited_number_blocks(self):
        r = self.new_run()
        run_shelf.go(r)
        p = r.dir / "competition.json"
        c = json.loads(p.read_text()); c["C"] = 9.9; p.write_text(json.dumps(c))
        rep = V.validate(r)
        bad = {c["check"] for c in rep["checks"] if not c["pass"]}
        self.assertIn("V-SHA", bad)
        self.assertIn("V-COMP", bad)

    def test_placeholder_diff_blocks(self):
        r = self.new_run()
        run_shelf.go(r)
        (r.dir / "diff" / "call_2.json").unlink()
        rep = V.validate(r)
        self.assertTrue(any(c["check"] == "V-DIFF" and not c["pass"] for c in rep["checks"]))

    def test_sleeve_run_validates_with_the_sales_gate(self):
        sleeve = dict(SPEC, scored_on="sleeve", sleeve_kind="dose", sleeve_regex="12 ?mg",
                      sleeve_cluster=["astaxanthin 12mg", "astaxanthin 12 mg"])
        r = Run.open(self.tmp, "idea-s", sleeve["shelf_keyword"], "test", {"shelf_cap_usd": 5})
        r.step_done("open", "V-OPEN", True)
        S.step_spec(r, dict(sleeve, written_at=now()))
        run_shelf.go(r)
        rep = V.validate(r)
        failed = [c for c in rep["checks"] if not c["pass"] and c["severity"] == "BLOCKER"]
        self.assertEqual(failed, [], json.dumps(failed, indent=1))
        sc = r.read("score.json")
        self.assertIn("sleeve_sales_gate", sc)
        self.assertEqual(r.read("demand_growth.json")["demand_gate"]["path"], "sleeve")

    def test_cannot_skip_a_step(self):
        r = self.new_run()
        with self.assertRaises(Exception):
            S.step_gate(r)


if __name__ == "__main__":
    unittest.main()
