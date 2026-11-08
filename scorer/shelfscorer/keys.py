"""API keys: environment first, then Supabase system_config with the service role key. Keys are never written or logged."""
import json
import os
import urllib.request

NAMES = {"datarova": ("DATAROVA_API_KEY", "datarova_api_key"), "keepa": ("KEEPA_API_KEY", "keepa_api_key"),
         "apify": ("APIFY_API_TOKEN", "apify_api_token"), "anthropic": ("ANTHROPIC_API_KEY", "anthropic_api_key")}
_cache = {}


def _system_config():
    url, key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        return {}
    req = urllib.request.Request(f"{url}/rest/v1/system_config?select=key,value",
                                 headers={"apikey": key, "Authorization": f"Bearer {key}"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return {row["key"]: row["value"] for row in json.load(r)}


def get(name):
    if name in _cache:
        return _cache[name]
    env, cfg = NAMES[name]
    v = os.environ.get(env)
    if not v:
        if "_sc" not in _cache:
            _cache["_sc"] = _system_config()
        v = _cache["_sc"].get(cfg)
    if not v:
        raise RuntimeError(f"{name} key not found (env {env} or system_config {cfg})")
    _cache[name] = v
    return v
