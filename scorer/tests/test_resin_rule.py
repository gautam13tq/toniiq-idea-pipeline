"""R14-3 (Gautam, 12 Nov 2026): raw resin or tears sold by weight are not supplements."""
import json
import os
import unittest

from shelfscorer import gate_adapter as GA

SPEC = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "specs", "rerun-2026-11-12",
                    "mastic-gum-capsules.json")
COPY = ["Chios Mastiha 100% natural resin. Uses include hard chewing gum, food ingredient and natural medicine or "
        "food supplement."]


def rec(asin, title, item_form="Gummy", crumbs="Grocery & Gourmet Food > Snacks & Sweets > Chewing & Bubble Gum"):
    return {"id": asin, "asin": asin, "title": title, "brand": "X", "bullets": COPY, "ingredients": "", "description": "",
            "item_form": item_form, "crumbs": crumbs, "variantAsins": [], "mpv": "", "reviews": 100, "price": 20,
            "page": 1, "pos": 1}


class ResinRule(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.spec = json.load(open(SPEC))
        GA.register_spec(cls.spec)
        cls.shelf = cls.spec["shelf_keyword"]

    def classify(self, r):
        return GA.GATE.classify3(self.shelf, r)

    def test_tears_by_weight_out(self):
        for asin, t in (("B008RT2UVI", "Chios Mastic Gum 100g/3.53oz Large Tears, 100% Pure Chios Mastic Tears"),
                        ("B07KXSBG42", "Chios Mastic Gum 50g/1.76oz Medium Tears, 100% Pure Chios Mastic Tears")):
            v, code, det, _, _ = self.classify(rec(asin, t))
            self.assertEqual((v, code), ("OUT", "EX_NOT_SUPPLEMENT"), t)
            self.assertIn("R14-3", det)

    def test_capsules_not_caught(self):
        v, code, det, _, _ = self.classify(rec("B0TEST0001", "Mastic Gum 1000 mg, 120 Capsules (2 x 60 count)",
                                               item_form="Capsule", crumbs="Health & Household > Vitamins & Supplements"))
        self.assertNotIn("R14-3", str(det))


if __name__ == "__main__":
    unittest.main()
