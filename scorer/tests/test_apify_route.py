"""Apify routes (12 Nov 2026): the apify-proxy edge function first; if it is refused or not deployed, the
system_config token; if neither works, ApifyFailed(unavailable=True), which only the opt-in no_apify_page1 fallback acts on."""
import io
import json
import os
import shutil
import sys
import tempfile
import unittest
import urllib.error

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from shelfscorer import clients, keys  # noqa: E402
from shelfscorer.runlog import Run  # noqa: E402


def http_error(url, code):
    return urllib.error.HTTPError(url, code, "x", {}, io.BytesIO(b"{}"))


class ApifyRoute(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.run = Run.open(self.tmp, "i", "x", "test", {})
        self.saved = (clients._http, keys.has, keys.get, keys.supabase, clients.time.sleep)
        clients._APIFY["direct_refused"] = False
        clients.time.sleep = lambda s: None
        keys.supabase = lambda: ("https://sb.example", "service-key")
        self.calls = []

    def tearDown(self):
        clients._http, keys.has, keys.get, keys.supabase, clients.time.sleep = self.saved
        clients._APIFY["direct_refused"] = False
        shutil.rmtree(self.tmp)

    def fake(self, direct_code=None, proxy_code=None, has_token=True):
        keys.has = lambda n: has_token
        keys.get = lambda n: "tok"

        def http(url, data=None, headers=None, timeout=180):
            self.calls.append((url, json.loads(data) if data else None, headers))
            if "api.apify.com" in url:
                if direct_code:
                    raise http_error(url, direct_code)
                return [{"asin": "B0DIRECT"}]
            if url.endswith("/functions/v1/apify-proxy"):
                if proxy_code:
                    raise http_error(url, proxy_code)
                return [{"asin": "B0PROXY"}]
            raise AssertionError(url)
        clients._http = http

    def test_proxy_first(self):
        self.fake()
        self.assertEqual(clients.apify_search(self.run, "mastic gum", "s0"), [{"asin": "B0PROXY"}])
        self.assertEqual(self.run.manifest()["apify_route"], "proxy")
        self.assertEqual(len(self.calls), 1)
        url, body, headers = self.calls[0]
        self.assertEqual(url, "https://sb.example/functions/v1/apify-proxy")
        self.assertEqual(body["method"], "POST")
        self.assertEqual(body["path"], "acts/axesso_data~amazon-search-scraper/run-sync-get-dataset-items")
        self.assertEqual(body["json"]["input"][0]["keyword"], "mastic gum")
        self.assertEqual(headers["Authorization"], "Bearer service-key")
        self.assertNotIn("token", json.dumps(body))           # the proxy adds the token server-side

    def test_proxy_refused_falls_back_to_the_token(self):
        for code in (401, 403, 404):
            self.calls.clear()
            self.fake(proxy_code=code)
            self.assertEqual(clients.apify_search(self.run, "x", f"s{code}"), [{"asin": "B0DIRECT"}])
            self.assertEqual(self.run.manifest()["apify_route"], "direct")

    def test_no_supabase_uses_the_token(self):
        def none():
            raise RuntimeError("no supabase")
        keys.supabase = none
        self.fake()
        self.assertEqual(clients.apify_search(self.run, "x", "s0"), [{"asin": "B0DIRECT"}])

    def test_both_refused_is_unavailable(self):
        self.fake(direct_code=401, proxy_code=404)
        with self.assertRaises(clients.ApifyFailed) as cm:
            clients.apify_search(self.run, "x", "s0")
        self.assertTrue(cm.exception.unavailable)

    def test_transient_error_is_not_unavailable(self):
        self.fake(proxy_code=500)
        with self.assertRaises(clients.ApifyFailed) as cm:
            clients.apify_search(self.run, "x", "s0")
        self.assertFalse(cm.exception.unavailable)          # the no-Apify fallback must not hide outages

if __name__ == "__main__":
    unittest.main()
