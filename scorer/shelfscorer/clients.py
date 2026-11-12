"""Thin HTTP clients. Every call goes through Run.call so it is logged with query, rows, cost and raw file."""
import gzip
import json
import time
import urllib.error
import urllib.parse
import urllib.request

from . import config as K, keys

UA = {"User-Agent": "toniiq-shelf-scorer/1"}


def _http(url, data=None, headers=None, timeout=180):
    req = urllib.request.Request(url, data=data, headers={**UA, **(headers or {})})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        b = r.read()
    if b[:2] == b"\x1f\x8b":
        b = gzip.decompress(b)
    return json.loads(b)


# ---------------- Datarova ----------------
def datarova_keywords(run, keywords, start, end, label, include_asins=False):
    q = {"marketplace": "US", "keywords": ",".join(keywords), "start_date": start, "end_date": end, "interval": "monthly"}
    if include_asins:
        q["include_asins"] = "true"

    def fn():
        url = f"{K.DATAROVA_BASE}/keywords?" + urllib.parse.urlencode(q)
        try:
            return _http(url, headers={"Authorization": f"Bearer {keys.get('datarova')}"})
        except urllib.error.HTTPError as e:
            if e.code in (401, 403):
                raise RuntimeError(f"datarova_auth_error {e.code}") from None
            raise
    return run.call("datarova", "/keywords", q, fn, raw_rel=f"datarova/{label}.json",
                    rows_fn=lambda r: len(((r or {}).get("data") or {}).get("keywords") or []))


# ---------------- Keepa ----------------
def keepa(run, path, params, label):
    def fn():
        direct = keys.has("keepa")
        for _ in range(10):
            try:
                if direct:
                    url = f"https://api.keepa.com/{path}?" + urllib.parse.urlencode({**params, "key": keys.get("keepa")})
                    return _http(url, timeout=180)
                # No key in env or system_config: go through the keepa-proxy edge function,
                # which holds KEEPA_API_KEY as a Supabase secret.
                url, sk = keys.supabase()
                return _http(f"{url}/functions/v1/keepa-proxy",
                             data=json.dumps({"path": path, "params": params}).encode(),
                             headers={"Authorization": f"Bearer {sk}", "Content-Type": "application/json"},
                             timeout=180)
            except urllib.error.HTTPError as e:
                body = e.read()
                if body[:2] == b"\x1f\x8b":
                    body = gzip.decompress(body)
                d = json.loads(body or b"{}")
                if e.code == 429:
                    time.sleep(max(60, (d.get("refillIn") or 60000) / 1000))
                    continue
                raise RuntimeError(f"keepa {e.code} {str(d)[:200]}") from None
        raise RuntimeError("keepa kept rate-limiting")

    def rows(r):
        return len(r.get("products") or r.get("asinList") or [])
    return run.call("keepa", f"/{path}", params, fn, raw_rel=f"keepa/{label}.json", rows_fn=rows,
                    tokens_fn=lambda r: r.get("tokensConsumed") or 0)


# ---------------- Apify ----------------
class ApifyFailed(RuntimeError):
    """code: the HTTP code of the last failure. unavailable: no working Apify route (direct token refused and the
    apify-proxy missing or refusing), which is the only case the opt-in no_apify_page1 fallback acts on."""
    def __init__(self, msg, code=None, unavailable=None):
        super().__init__(msg)
        self.code = code
        self.unavailable = (code == 401) if unavailable is None else unavailable


_APIFY = {"direct_refused": False}      # once the direct token answers 401, later calls go straight to the proxy
AUTH_CODES = (401, 403)


def _apify_direct(path, body, timeout):
    url = f"https://api.apify.com/v2/{path}?" + urllib.parse.urlencode({"token": keys.get("apify"), "timeout": timeout})
    return _http(url, data=json.dumps(body).encode(), headers={"Content-Type": "application/json"}, timeout=timeout + 20)


def _apify_proxy(path, body, timeout):
    """apify-proxy edge function (holds APIFY_API_TOKEN as a Supabase secret; path relative to /v2/)."""
    url, sk = keys.supabase()
    req = {"method": "POST", "path": path, "params": {"timeout": timeout}, "json": body}
    return _http(f"{url}/functions/v1/apify-proxy", data=json.dumps(req).encode(),
                 headers={"Authorization": f"Bearer {sk}", "Content-Type": "application/json"}, timeout=timeout + 20)


def apify_post(run, path, body, timeout=180):
    """Direct with the system_config token; if that token is missing or answers 401, the apify-proxy. One retry each
    on transient errors. Raises ApifyFailed. The route used is recorded in the run manifest (apify_route)."""
    routes = []
    if keys.has("apify") and not _APIFY["direct_refused"]:
        routes.append(("direct", _apify_direct))
    try:
        keys.supabase()
        routes.append(("proxy", _apify_proxy))
    except RuntimeError:
        pass
    last, auth_fail = None, True
    for name, f in routes:
        for _ in range(2):
            try:
                res = f(path, body, timeout)
                run.update(apify_route=name)
                return res
            except urllib.error.HTTPError as e:
                last = e
                if e.code in AUTH_CODES or (name == "proxy" and e.code == 404):   # 404: proxy not deployed
                    if name == "direct" and e.code == 401:
                        _APIFY["direct_refused"] = True
                    break
                auth_fail = False
                time.sleep(3)
            except Exception as e:  # transient: one retry, as the app does
                last, auth_fail = e, False
                time.sleep(3)
        else:
            break                   # a transient failure twice: do not fall through to another route
    code = getattr(last, "code", None)
    raise ApifyFailed(f"apify failed: {type(last).__name__ if last else 'no route'}" + (f" {code}" if code else ""),
                      code, unavailable=auth_fail)


def apify_search(run, keyword, label):
    inp = {"input": [{"keyword": keyword, "domainCode": "com", "sortBy": "relevanceblender",
                      "maxPages": K.APIFY_MAX_PAGES, "category": "aps"}]}
    path = f"acts/{K.APIFY_ACTOR.replace('/', '~')}/run-sync-get-dataset-items"
    return run.call("apify", K.APIFY_ACTOR, {"keyword": keyword, "maxPages": K.APIFY_MAX_PAGES},
                    lambda: apify_post(run, path, inp), raw_rel=f"apify/{label}.json", rows_fn=lambda r: len(r or []),
                    cost_usd=lambda r: 0.0001 * len(r or []))


# ---------------- Anthropic ----------------
PRICE = {"in": 3.0 / 1e6, "out": 15.0 / 1e6}


def anthropic(run, label, *, system=None, messages, max_tokens=1500, temperature=0):
    body = {"model": K.MODEL, "max_tokens": max_tokens, "temperature": temperature, "messages": messages}
    if system:
        body["system"] = system

    def fn():
        for i in range(4):
            try:
                return _http("https://api.anthropic.com/v1/messages", data=json.dumps(body).encode(),
                             headers={"x-api-key": keys.get("anthropic"), "anthropic-version": "2023-06-01",
                                      "content-type": "application/json"}, timeout=300)
            except urllib.error.HTTPError as e:
                if e.code in (429, 500, 502, 503, 529) and i < 3:
                    time.sleep(5 * (i + 1))
                    continue
                raise
    from .runlog import sha
    prompt_sha = sha(json.dumps({"system": system, "messages": messages}, sort_keys=True))
    res = run.call("anthropic", "/v1/messages", {"label": label, "model": K.MODEL, "prompt_sha": prompt_sha}, fn,
                   raw_rel=f"llm/{label}.json", rows_fn=lambda r: 1,
                   cost_usd=lambda r: (r.get("usage", {}).get("input_tokens", 0) * PRICE["in"] +
                                       r.get("usage", {}).get("output_tokens", 0) * PRICE["out"]))
    text = "".join(b.get("text", "") for b in res.get("content", []) if b.get("type") == "text")
    return text, prompt_sha


def extract_json(text):
    """Return the LAST complete JSON object in the reply. The judge sometimes writes a JSON answer, then
    'let me reconsider', then a second JSON; the last one is its final answer (9 Nov 2026 blind test)."""
    dec = json.JSONDecoder()
    found, k = [], 0
    while True:
        i = text.find("{", k)
        if i < 0:
            break
        try:
            o, end = dec.raw_decode(text, i)
            if isinstance(o, dict):
                found.append(o)
            k = end
        except ValueError:
            k = i + 1
    if not found:
        raise ValueError("no JSON object in reply")
    return found[-1]
