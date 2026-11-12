"""Sleeve rule (Gautam, 11 Nov 2026): shelfscorer/sleeves.py and the sleeve paths in pillars/steps."""
import unittest

from shelfscorer import pillars as P, sleeves as SL


def kw(name, clicks, sales=None, months=13):
    recs = [{"date": f"{2025 + (i + 9) // 12}-{(i + 9) % 12 + 1:02d}-01", "clicks": clicks, "sales": sales or clicks // 4}
            for i in range(months)]
    return {"keyword": name, "records": recs}


SLEEVE = {"shelf_keyword": "colostrum capsules", "hero_regex": "colostrum", "gate_format": "pill",
          "qualifier_regex": "capsule|pill", "parent_keyword": "colostrum", "scored_on": "sleeve", "sleeve_kind": "format",
          "sleeve_regex": SL.GATE_FMT["pill"], "hero_names": ["colostrum", "bovine colostrum"],
          "cluster_keywords": ["colostrum capsules", "colostrum pills"],
          "sleeve_cluster": ["colostrum capsules", "colostrum pills", "bovine colostrum capsules", "colostrum supplement capsules"]}
DATA = [kw("colostrum capsules", 845), kw("colostrum pills", 290), kw("bovine colostrum capsules", 150),
        kw("colostrum supplement capsules", 40), kw("colostrum", 15509), kw("colostrum powder", 9000)]


class SleeveCluster(unittest.TestCase):
    def test_phrasing_must_be_the_same_sleeve(self):
        ok = lambda k: SL.phrasing_ok(k, SLEEVE)
        self.assertTrue(ok("bovine colostrum capsules"))
        self.assertTrue(ok("colostrum tablets"))
        self.assertTrue(ok("organic colostrum softgels"))
        self.assertFalse(ok("colostrum powder"))                 # another format
        self.assertFalse(ok("colostrum"))                        # the parent is context only
        self.assertFalse(ok("colostrum capsules and powder"))    # names another format
        self.assertFalse(ok("lactoferrin capsules"))             # not the hero

    def test_candidates_cover_synonyms_modifiers_and_word_order(self):
        c = SL.candidate_phrasings(SLEEVE, autocomplete=["Colostrum capsules for gut health", "colostrum powder"])
        for k in ("colostrum caps", "colostrum pills", "colostrum softgels", "bovine colostrum capsules",
                  "colostrum supplement capsules", "organic colostrum capsules", "colostrum capsules for gut health"):
            self.assertIn(k, c)
        self.assertNotIn("colostrum powder", c)
        self.assertEqual(len(c), len(set(c)))

    def test_powdered_word_order(self):
        s = {"shelf_keyword": "magnesium glycinate powder", "hero_regex": r"magnes\w*", "form": "glycinate",
             "gate_format": "powder", "scored_on": "sleeve", "sleeve_kind": "format",
             "sleeve_regex": SL.GATE_FMT["powder"], "hero_names": ["magnesium glycinate"],
             "cluster_keywords": ["magnesium glycinate powder"]}
        c = SL.candidate_phrasings(s)
        self.assertIn("powdered magnesium glycinate", c)
        self.assertNotIn("magnesium citrate powder", c)

    def test_variety_sleeve_needs_its_qualifier(self):
        s = {"shelf_keyword": "korean red ginseng", "hero_regex": "ginseng", "scored_on": "sleeve",
             "sleeve_kind": "variety", "sleeve_regex": r"korean|\bred\b|\bkrg\b", "cluster_keywords": ["korean red ginseng"]}
        self.assertTrue(SL.phrasing_ok("red ginseng extract", s))
        self.assertTrue(SL.phrasing_ok("korean red ginseng capsules", s))   # a format inside a variety is still the variety
        self.assertFalse(SL.phrasing_ok("panax ginseng", s))


class SleeveDemand(unittest.TestCase):
    def test_demand_reads_the_whole_sleeve_not_one_phrase(self):
        prim, cl = P.demand_terms(SLEEVE)
        self.assertEqual(prim, "colostrum capsules")
        self.assertNotIn("colostrum", cl)                          # parent is context only
        dg = P.demand_growth(DATA, prim, cl, SL.mode(SLEEVE))
        self.assertEqual(dg["agg_clicks"], 845 + 290 + 150 + 40)
        self.assertEqual(dg["a_band_clicks"], dg["agg_clicks"])
        self.assertEqual(dg["a"], 2)                               # 1,325 sleeve clicks, not the 845 of one phrase
        self.assertTrue(dg["demand_gate"]["pass"])
        self.assertEqual(dg["demand_gate"]["path"], "sleeve")

    def test_one_phrase_alone_fails_the_sleeve_gate(self):
        dg = P.demand_growth([kw("colostrum capsules", 1500)], "colostrum capsules", ["colostrum capsules"], "sleeve")
        self.assertFalse(dg["demand_gate"]["pass"])                # 1 row
        dg = P.demand_growth(DATA[:2], "colostrum capsules", ["colostrum capsules", "colostrum pills"], "sleeve")
        self.assertTrue(dg["demand_gate"]["pass"])                 # 1,135 over 2 rows
        dg = P.demand_growth([kw("x capsules", 500), kw("x pills", 400)], "x capsules", ["x capsules", "x pills"], "sleeve")
        self.assertFalse(dg["demand_gate"]["pass"])                # 900 < 1,000

    def test_parent_keeps_the_old_gate_and_primary(self):
        s = {"shelf_keyword": "colostrum", "cluster_keywords": ["colostrum"], "scored_on": "parent",
             "demand_keyword": "colostrum", "demand_cluster": ["colostrum powder"]}
        prim, cl = P.demand_terms(s)
        dg = P.demand_growth(DATA, prim, cl, SL.mode(s))
        self.assertEqual(dg["a_band_clicks"], 15509)
        self.assertEqual(dg["demand_gate"]["path"], "parent")
        self.assertEqual(dg["demand_gate"]["why"], "primary >= 1,000 with >= 2 rows")

    def test_sales_gate(self):
        top = [{"monthly_sold": 150}] * 12
        self.assertFalse(SL.sleeve_sales_gate(SLEEVE, top)[0])     # 1,800
        self.assertTrue(SL.sleeve_sales_gate(SLEEVE, [{"monthly_sold": 200}] * 10)[0])
        self.assertTrue(SL.sleeve_sales_gate(dict(SLEEVE, scored_on="parent"), top)[0])

    def test_sales_gate_is_a_hard_stop_in_the_composite(self):
        r = P.composite(6, 5, 7, 7, demand_ok=True, n_kept=20, n_sig=12, moat=9, sales_ok=False)
        self.assertEqual(r["tier"], "ineligible")
        self.assertIn("sleeve top 12 sells < 2,000/month", r["hard"])


class GrowthIsAPenalty(unittest.TestCase):
    def test_shrinking_keyword_is_scored_not_disqualified(self):
        # Gautam, 12 Nov 2026: "rather just be a penalty with a low score rather than a disqualify"
        r = P.composite(6, 0.8, 7, 7, demand_ok=True, n_kept=20, n_sig=12, moat=9)
        self.assertNotEqual(r["tier"], "ineligible")
        self.assertEqual(r["hard"], [])
        self.assertIn("shrinking", r["info"])
        self.assertAlmostEqual(r["raw"], 10 * (0.25 * 6 + 0.05 * 0.8 + 0.45 * 7 + 0.25 * 7), places=3)
        self.assertNotIn("shrinking", P.composite(6, 1.0, 7, 7, demand_ok=True, n_kept=20, n_sig=12, moat=9)["info"])

    def test_d_below_3_still_disqualifies(self):
        self.assertIn("D < 3", P.composite(2, 5, 7, 7, demand_ok=True, n_kept=20, n_sig=12, moat=9)["hard"])


class DefaultFormat(unittest.TestCase):
    def top(self, titles):
        return [{"asin": f"A{i}", "title": t, "monthly_sold": 1000 - i} for i, t in enumerate(titles)]

    def test_mostly_capsules_parent_is_the_default(self):
        t = ["Mastic Gum 1000mg 120 Capsules"] * 9 + ["Mastic Gum 500 mg"] + ["Mastic Gum Powder", "Mastic Gum Chewing Gum"]
        share, rows = SL.default_format_share(self.top(t), "pill")
        self.assertAlmostEqual(share, 10 / 11)                       # dose-stated = pill; chewing gum not counted
        self.assertTrue(SL.is_default_format(dict(SLEEVE, parent_keyword="mastic gum"), share))

    def test_mixed_parent_keeps_the_sleeve(self):
        t = ["Colostrum Powder"] * 6 + ["Colostrum Capsules"] * 6
        share, _ = SL.default_format_share(self.top(t), "pill")
        self.assertEqual(share, 0.5)
        self.assertFalse(SL.is_default_format(SLEEVE, share))

    def test_share_counts_supplement_formats_only(self):
        # Mastic gum shelf as scored 11 Nov: tears and a chewing gum are not supplement formats (Gautam, 12 Nov 2026)
        t = (["Jarrow Mastic Gum 1000mg, 60 Capsules", "Horbaach Mastic Gum | 1500mg | 100 Capsules",
              "NOW Gastro Comfort with Mastic Gum, 60 Veg Caps",
              "Chios Mastic Gum 50g/1.76oz Medium Tears, 100% Pure Chios Mastic Tears",
              "Chios Mastic Gum 100g/3.53oz Large Tears", "ARG Mastica Chios Mastic Gum Resin Digestive, 120 Capsules",
              "Vitamatic Mastic Gum 1000 mg per Serving, 120 Capsules", "Best Naturals Mastic Gum 500 mg 60 Capsules",
              "SOLARAY Mastic Gum Extract 500 mg 45 Count", "Mastic Gum/DGL Licorice Chewable Tablets, 60 Tablets",
              "Remineralizing Chewing Gum with Hydroxyapatite, Xylitol", "Mastic Gum Gummies with Zinc Carnosine, 90 Count"])
        share, rows = SL.default_format_share(self.top(t), "pill")
        self.assertEqual([r["title"][:12] for r in rows if not r["counted"]],
                         ["Chios Mastic", "Chios Mastic", "Remineralizi"])
        self.assertAlmostEqual(share, 8 / 9)                        # 8 pills of 9 supplement listings (gummy counts)
        self.assertTrue(SL.is_default_format(dict(SLEEVE, parent_keyword="mastic gum"), share))
        self.assertTrue(SL.is_supplement_format("ARG Mastic Gum Resin, 120 Capsules"))   # a format word wins

    def test_only_format_sleeves_can_be_default(self):
        self.assertFalse(SL.is_default_format(dict(SLEEVE, sleeve_kind="dose"), 1.0))

    def test_parent_default_spec(self):
        p = SL.parent_default_spec(SLEEVE, ["colostrum", "bovine colostrum", "colostrum supplement"], 0.8, "t")
        self.assertEqual(p["shelf_keyword"], "colostrum")
        self.assertEqual(p["scored_on"], "parent_default_format")
        self.assertEqual(p["demand_keyword"], "colostrum")
        self.assertEqual(p["sleeve_shelf_keyword"], "colostrum capsules")
        for f in ("gate_format", "qualifier_regex", "sleeve_regex", "sleeve_cluster"):
            self.assertNotIn(f, p)


if __name__ == "__main__":
    unittest.main()
