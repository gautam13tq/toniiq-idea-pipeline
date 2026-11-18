"""booster_names_hero (18 Nov 2026): on a nitric oxide shelf "Nitric Oxide Booster" names the hero; the frozen gate's
precursor/booster rule still holds everywhere else."""
import os, sys, unittest
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from shelfscorer import gate_adapter as GA  # noqa: E402
from shelfscorer.steps import booster_title  # noqa: E402

SPEC = {"shelf_keyword": "test nitric oxide booster shelf", "hero_regex": "nitric oxide|\\bnitric\\b"}


def rec(title):
    return {"id": "B000TEST01", "asin": "B000TEST01", "title": title, "brand": "Nutricost", "bullets": [], "ingredients": "",
            "description": "", "item_form": "Capsule", "crumbs": "", "variantAsins": [], "mpv": "1000+ bought in past month",
            "reviews": 100, "price": 20, "page": 1, "pos": 1}


class BoosterNamesHero(unittest.TestCase):
    T = "Nutricost Nitric Oxide Booster 2250mg, 180 Capsules, Gluten Free"

    def setUp(self):
        GA.register_spec(SPEC)

    def code(self, title):
        out = GA.GATE.classify3(SPEC["shelf_keyword"], rec(title))
        return out[1]

    def test_rewrite(self):
        self.assertEqual(booster_title(SPEC, self.T), "Nutricost Nitric Oxide supplement 2250mg, 180 Capsules, Gluten Free")
        self.assertEqual(booster_title(SPEC, "Jacked Factory N.O. XT Nitric Oxide Boosting Agent"),
                         "Jacked Factory N.O. XT Nitric Oxide supplement")

    def test_default_gate_unchanged(self):
        self.assertEqual(self.code(self.T), "EX_HERO_MISSING")

    def test_rewritten_title_names_hero(self):
        self.assertNotEqual(self.code(booster_title(SPEC, self.T)), "EX_HERO_MISSING")


if __name__ == "__main__":
    unittest.main()
