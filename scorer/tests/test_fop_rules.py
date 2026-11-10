"""Gautam's 10 Nov 2026 shelf rules R1-R4 (shelfscorer/fop_rules.py)."""
import unittest

from shelfscorer import fop_rules as FR

MG = {"hero_regex": r"magnes\w*", "audience": "kids"}
TC = {"hero_regex": r"tart cherr\w*|montmorency"}
CW = {"hero_regex": r"creatine|creapure", "audience": "women"}
LT = {"hero_regex": r"l-?theanine|theanine|suntheanine"}


def fop(front, main, largest=None, cond=False, co=None, doses=None):
    return {"front_text": front, "main_ingredient": main, "largest_text": largest or main, "headline_is_condition": cond,
            "co_leads": co or [], "front_doses": doses or []}


class R1KidsFront(unittest.TestCase):
    TITLE = "Magnesium Glycinate Gummies for Adults & Kids 4+, Sugar Free"

    def test_adults_first_on_front_is_out(self):
        o = fop("MAGNESIUM GLYCINATE GUMMIES For Adults & Kids 4+", "Magnesium Glycinate")
        self.assertEqual(FR.decide(o, MG, self.TITLE, was_in=True)[0], "OUT")

    def test_kids_first_on_front_stays_in(self):
        o = fop("KIDS MAGNESIUM Calm Gummies also for adults", "Magnesium")
        self.assertIsNone(FR.decide(o, MG, self.TITLE, was_in=True)[0])

    def test_no_kids_on_front_is_out(self):
        o = fop("MAGNESIUM GLYCINATE 500mg Sugar Free", "Magnesium Glycinate")
        self.assertEqual(FR.decide(o, MG, self.TITLE, was_in=True)[0], "OUT")

    def test_kids_only_title_not_affected(self):
        o = fop("KIDS MAGNESIUM GUMMIES", "Magnesium")
        self.assertIsNone(FR.decide(o, MG, "Center-Filled Kids Magnesium Gummies for Kids & Teens", was_in=True)[0])

    def test_women_men_kids_counts_as_mixed(self):
        o = fop("MAGNESIUM GLYCINATE GUMMIES for Women Men Kids", "Magnesium Glycinate")
        self.assertTrue(FR.audience_mixed("Magnesium Glycinate Gummies with Zinc for Women Men Kids", "kids"))
        self.assertEqual(FR.decide(o, MG, "Magnesium Glycinate Gummies for Women Men Kids", was_in=True)[0], "OUT")

    def test_rule_only_on_kids_shelves(self):
        o = fop("MAGNESIUM GLYCINATE For Adults & Kids", "Magnesium Glycinate")
        self.assertIsNone(FR.decide(o, {"hero_regex": r"magnes\w*"}, self.TITLE, was_in=True)[0])


class R2ConditionLed(unittest.TestCase):
    TITLE = "Purge Uric Acid Flush with Tart Cherry & Celery Seed, 120 Caps"

    def test_condition_led_hero_not_biggest_is_out(self):
        o = fop("URIC ACID FLUSH Tart Cherry Celery Seed", "Tart Cherry", largest="URIC ACID FLUSH", cond=True)
        self.assertEqual(FR.decide(o, TC, self.TITLE, was_in=True)[0], "OUT")

    def test_condition_led_hero_biggest_stays_in(self):
        o = fop("TART CHERRY Uric Acid Support", "Tart Cherry", largest="TART CHERRY", cond=True)
        self.assertIsNone(FR.decide(o, TC, self.TITLE, was_in=True)[0])

    def test_condition_led_hero_biggest_can_be_rescued(self):
        o = fop("TART CHERRY Uric Acid Support", "Tart Cherry", largest="TART CHERRY", cond=True)
        self.assertEqual(FR.decide(o, TC, self.TITLE, was_in=False, gate_code="JUDGE_OUT")[0], "IN")

    def test_condition_led_rescue_refused_when_hero_small(self):
        o = fop("SCIATIC NERVE SUPPORT with PEA", "PEA", largest="SCIATIC NERVE SUPPORT", cond=True)
        self.assertIsNone(FR.decide(o, {"hero_regex": r"\bpea\b"}, "Sciatic Nerve Support", was_in=False)[0])


class ConditionHint(unittest.TestCase):
    def test_calming_and_cortisol_titles_get_a_check(self):
        self.assertTrue(FR.CONDITION_HINT.search("UltraCalm Cortisol Calming Drink, Magnesium Glycinate Powder"))
        self.assertFalse(FR.CONDITION_HINT.search("Nutricost Magnesium Glycinate Powder (250 Grams) Unflavored"))


class R3EqualCoLead(unittest.TestCase):
    TITLE = "Liquid GABA L-Theanine Supplement for Stress Relief"

    def test_equal_co_lead_is_in(self):
        o = fop("GABA + L-THEANINE Liquid", "GABA", largest="GABA + L-THEANINE", co=["GABA", "L-Theanine"])
        self.assertEqual(FR.decide(o, LT, self.TITLE, was_in=False, gate_code="HERO_SECONDARY")[0], "IN")

    def test_equal_co_lead_still_obeys_dose_rule(self):
        o = fop("GABA 2000MG L-THEANINE 1000MG", "GABA", co=["GABA", "L-Theanine"],
                doses=[{"ingredient": "GABA", "mg": 2000}, {"ingredient": "L-Theanine", "mg": 1000}])
        self.assertEqual(FR.decide(o, LT, self.TITLE, was_in=True)[0], "OUT")

    def test_printed_total_is_not_another_ingredient(self):
        o = fop("CREATINE 5G + COLLAGEN 5G", "Creatine",
                doses=[{"ingredient": "Creatine", "mg": 5000}, {"ingredient": "Collagen", "mg": 5000},
                       {"ingredient": "Total per serving", "mg": 11700}])
        self.assertEqual(FR.hero_leads(o, CW["hero_regex"]), (True, None))

    def test_not_a_co_lead_is_not_rescued(self):
        o = fop("MELATONIN L-THEANINE VALERIAN", "Melatonin")
        self.assertIsNone(FR.decide(o, LT, "Melatonin drops", was_in=False, gate_code="HERO_SECONDARY")[0])


class R4Unisex(unittest.TestCase):
    def test_unisex_title_out(self):
        self.assertTrue(FR.r4_unisex_out("Creatine Monohydrate for Men & Women", "women"))
        self.assertTrue(FR.r4_unisex_out("Magnesium 12-in-1 Complex Function丨Women Men.", "men"))
        self.assertTrue(FR.r4_unisex_out("Creatine Gummies for Women, Unisex", "women"))

    def test_single_gender_title_kept(self):
        self.assertFalse(FR.r4_unisex_out("Creatine for Women, Glute Strength", "women"))
        self.assertFalse(FR.r4_unisex_out("Magnesium Complex 15-in-1 for Men", "men"))
        self.assertFalse(FR.r4_unisex_out("Creatine for Men & Women", None))

    def test_unisex_front_blocks_and_removes(self):
        o = fop("CREATINE For Men & Women", "Creatine")
        self.assertEqual(FR.decide(o, CW, "Creatine for Women", was_in=True)[0], "OUT")
        self.assertIsNone(FR.decide(o, CW, "Creatine for Women", was_in=False, gate_code="JUDGE_OUT")[0])


class Unreadable(unittest.TestCase):
    def test_no_ingredient_needs_check(self):
        self.assertEqual(FR.decide({"front_text": ""}, TC, "Tart cherry", was_in=True)[0], "NEEDS_CHECK")


if __name__ == "__main__":
    unittest.main()
