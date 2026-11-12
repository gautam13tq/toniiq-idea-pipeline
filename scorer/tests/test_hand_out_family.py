"""A hand OUT on a folded duplicate drops the whole family (12 Nov 2026: Urinozinc B0046H39D8 was a variant dup of
B0HD2JSYS3, so the blind-check OUT missed the kept listing and Urinozinc stayed #3 on beta-sitosterol)."""
import unittest
from unittest import mock

from shelfscorer import steps as S


def P(asin, sold, brand):
    return {"asin": asin, "parent": None, "monthly_sold": sold, "rank90": 1000, "brand": brand, "title": brand + " x",
            "price": 20, "rating": 4.5, "bsr": 1000, "image": None, "last_update": 1, "reviews": 10}


class FakeRun:
    def __init__(self, files):
        self.files, self.dir = files, mock.MagicMock()
        self.dir.__truediv__.return_value.__truediv__.return_value.exists.return_value = False

    def read(self, rel):
        return self.files[rel]

    def exists(self, rel):
        return rel in self.files


GATE = {"kept": ["K1", "K2"], "decisions": {
    "K1": {"include": True, "code": "IN_OK"}, "D1": {"include": False, "code": "EX_VARIANT_DUP", "dup_of": "K1"},
    "K2": {"include": True, "code": "IN_OK"}}}
PRODS = {"K1": P("K1", 1300, "Urinozinc"), "D1": P("D1", 0, "Urinozinc"), "K2": P("K2", 900, "NOW")}


def fams(manual):
    files = {"gate/decisions.json": GATE, "manual_decisions.json": {"decisions": manual}}
    with mock.patch.object(S, "load_products", return_value=dict(PRODS)), \
            mock.patch.object(S.GA, "product_fields", side_effect=lambda p: p):
        return [f["family_id"] for f in S.build_families(FakeRun(files))]


class HandOutFamily(unittest.TestCase):
    def test_out_on_duplicate_drops_family(self):
        self.assertEqual(fams({"D1": {"decision": "OUT"}}), ["K2"])

    def test_out_on_kept_listing_drops_family(self):
        self.assertEqual(fams({"K1": {"decision": "OUT"}}), ["K2"])

    def test_hand_in_on_kept_listing_wins(self):
        self.assertEqual(fams({"D1": {"decision": "OUT"}, "K1": {"decision": "IN"}}), ["K1", "K2"])

    def test_no_hand_decisions(self):
        self.assertEqual(fams({}), ["K1", "K2"])


if __name__ == "__main__":
    unittest.main()
