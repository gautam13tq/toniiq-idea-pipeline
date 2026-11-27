"""Gate v11.4 R15-1 / R15-2 (27 Nov 2026): powder stick/packet shelves keep Grocery drink mixes and Liquid I.V."""
import json
import os
import unittest

from shelfscorer import gate_adapter as GA

D = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "specs")
GROC = ("Grocery & Gourmet Food > Beverages > Bottled Beverages, Water & Drink Mixes > Powdered Drink Mixes & "
        "Flavorings > Sports Drink Mixes")
HH = "Health & Household > Vitamins, Minerals & Supplements > Sports Nutrition > Electrolyte Replacements"


def rec(asin, title, brand, crumbs=GROC, item_form="Powder"):
    return {"id": asin, "asin": asin, "title": title, "brand": brand, "bullets": ["Mix one stick with 16 oz water"],
            "ingredients": "", "description": "", "item_form": item_form, "crumbs": crumbs, "variantAsins": [],
            "mpv": "", "reviews": 100, "price": 20, "page": 1, "pos": 1}


def load(path):
    spec = json.load(open(os.path.join(D, path)))
    GA.register_spec(spec)
    return spec["shelf_keyword"]


class PowderStickGate(unittest.TestCase):
    def c(self, shelf, r):
        return GA.GATE.classify3(shelf, r)

    def test_version(self):
        self.assertEqual(GA.GATE_VERSION, "v11.4")

    def test_grocery_electrolyte_sticks_in(self):
        sh = load("eca-2026-11-19/f19-electrolyte-packets.json")
        for asin, t, b in (("B0CRFNYRB9", "4C Energy Rush Electrolyte Drink Mix Variety Pack, 40 Sticks, 3 Flavors", "4C"),
                           ("B0TLMNT001", "LMNT Zero Sugar Electrolytes - Citrus Salt | Drink Mix | 30 Stick Packs", "LMNT"),
                           ("B0TPROP001", "Propel Powder Packets with Electrolytes, Vitamins and No Sugar, 50 Count", "Propel")):
            v, code, det, _, _ = self.c(sh, rec(asin, t, b))
            self.assertEqual(v, "IN", t)
            self.assertIn("R15-1", det)

    def test_liquid_iv_brand_not_a_format(self):
        sh = load("eca-2026-11-19/f19-electrolyte-packets.json")
        t = ("Liquid I.V. Hydration Multiplier - Lemon Lime - Electrolyte Powder Drink Mix, Easy Open Single-Serving "
             "Stick, 16 Count")
        for crumbs in (HH, GROC):
            v, code, det, _, _ = self.c(sh, rec("B0TLIQIV01", t, "Liquid I.V.", crumbs=crumbs))
            self.assertEqual(v, "IN", crumbs)

    def test_title_coterm_rule_kept(self):
        # Gautam 19 Nov: the sleeve word must be in the title. No stick/packet word -> still OUT (hand FOP check).
        sh = load("eca-2026-11-19/f19-electrolyte-packets.json")
        v, code, _, _, _ = self.c(sh, rec("B0TLIQIV02", "Liquid I.V. Sugar-Free Hydration Multiplier Electrolyte "
                                                        "Drink Mix, 16 Count", "Liquid I.V."))
        self.assertEqual(v, "OUT")
        self.assertNotEqual(code, "EX_NOT_SUPPLEMENT")

    def test_ready_to_drink_stays_out(self):
        sh = load("eca-2026-11-19/f19-electrolyte-packets.json")
        for t in ("Electrolyte Drink, Ready to Drink, 16.9 fl oz Bottles, 12 Pack Sticks",
                  "Electrolyte Water 1 Liter Bottles, 12 Pack"):
            v, code, _, _, _ = self.c(sh, rec("B0TRTD0001", t, "X", item_form="Liquid"))
            self.assertEqual((v, code), ("OUT", "EX_NOT_SUPPLEMENT"), t)

    def test_creatine_electrolyte_grocery_stick_in(self):
        sh = load("creatine-2026-11-18/creatine-electrolytes.json")
        t = "Creatine Monohydrate + Electrolytes Drink Mix Stick Packs, 5g Creatine, 30 Sticks"
        v, code, det, _, _ = self.c(sh, rec("B0TCRE0001", t, "Brandx"))
        self.assertEqual(v, "IN", det)

    def test_pill_shelf_untouched(self):
        sh = load("creatine-2026-11-18/creatine-capsules.json")
        v, code, det, _, _ = self.c(sh, rec("B0TCRE0002", "Creatine Monohydrate Drink Mix Powder Sticks, 30 Count",
                                            "Brandx"))
        self.assertEqual(v, "OUT")
        self.assertNotIn("R15", str(det))


if __name__ == "__main__":
    unittest.main()
