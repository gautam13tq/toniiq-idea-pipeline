"""Run folder, manifest and the call log. Every network call in the scorer goes through Run.call()."""
import datetime as dt
import hashlib
import json
import os
import secrets
import time
from pathlib import Path

from . import config as K, VERSION

STEPS = ["open", "spec", "datarova", "demand_growth", "discover", "keepa_pass1", "gate", "collapse",
         "rank_fop", "keepa_pass2", "competition", "diff", "crosscheck", "score", "validate_write"]


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")


def sha(b):
    if isinstance(b, str):
        b = b.encode()
    return hashlib.sha256(b).hexdigest()


def slug(s):
    import re
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")[:60]


class StepFailed(Exception):
    pass


class Run:
    def __init__(self, root, run_id):
        self.dir = Path(root) / run_id
        self.run_id = run_id
        self.manifest_path = self.dir / "run_manifest.json"
        self.calls_path = self.dir / "calls.jsonl"

    # ---------- lifecycle
    @classmethod
    def open(cls, root, idea_id, shelf_keyword, operator, extra=None):
        rid = f"{slug(shelf_keyword)}__{dt.date.today().isoformat()}__{secrets.token_hex(4)}"
        r = cls(root, rid)
        r.dir.mkdir(parents=True, exist_ok=False)
        m = {"run_id": rid, "idea_id": idea_id, "shelf_keyword": shelf_keyword, "operator": operator,
             "started_at": now(), "config": K.frozen(), "scorer_version": VERSION, "steps": {}, "cost_usd": 0.0,
             "keepa_tokens": 0, "artifacts": {}, "status": "open"}
        m.update(extra or {})
        r._write_manifest(m)
        r.calls_path.touch()
        return r

    @classmethod
    def load(cls, path):
        p = Path(path)
        return cls(p.parent, p.name)

    def manifest(self):
        return json.loads(self.manifest_path.read_text())

    def _write_manifest(self, m):
        tmp = self.manifest_path.with_suffix(".tmp")
        tmp.write_text(json.dumps(m, indent=1, default=str))
        os.replace(tmp, self.manifest_path)

    def update(self, **kw):
        m = self.manifest()
        m.update(kw)
        self._write_manifest(m)

    # ---------- artifacts
    def save(self, rel, obj):
        p = self.dir / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        data = obj if isinstance(obj, (bytes, str)) else json.dumps(obj, indent=1, default=str)
        if isinstance(data, str):
            data = data.encode()
        p.write_bytes(data)
        m = self.manifest()
        m["artifacts"][rel] = sha(data)
        self._write_manifest(m)
        return p

    def read(self, rel):
        return json.loads((self.dir / rel).read_text())

    def exists(self, rel):
        return (self.dir / rel).exists()

    # ---------- steps
    def step_done(self, name, check, ok, detail=""):
        m = self.manifest()
        m["steps"][name] = {"done_at": now(), "check": check, "pass": bool(ok), "detail": detail}
        self._write_manifest(m)
        if not ok:
            raise StepFailed(f"step {name}: check {check} failed: {detail}")

    def require(self, *names):
        steps = self.manifest()["steps"]
        for n in names:
            if not steps.get(n, {}).get("pass"):
                raise StepFailed(f"step {n} has not passed; cannot continue")

    # ---------- the call log
    def call(self, tool, endpoint, query, fn, *, cost_usd=0.0, raw_rel=None, rows_fn=None, tokens_fn=None):
        """Run fn(), log one line to calls.jsonl, save the raw response to raw_rel. Never logs keys."""
        t0 = time.time()
        rec = {"ts": now(), "tool": tool, "endpoint": endpoint, "query": query,
               "query_sha": sha(json.dumps(query, sort_keys=True, default=str))[:16]}
        try:
            res = fn()
            rec["ok"] = True
        except Exception as e:
            rec.update(ok=False, error=f"{type(e).__name__}: {str(e)[:300]}", secs=round(time.time() - t0, 1))
            self._log(rec)
            raise
        rec["secs"] = round(time.time() - t0, 1)
        rec["rows"] = rows_fn(res) if rows_fn else None
        tok = tokens_fn(res) if tokens_fn else 0
        rec["keepa_tokens"] = tok
        rec["cost_usd"] = round(cost_usd(res) if callable(cost_usd) else cost_usd, 5)
        if raw_rel:
            p = self.save(raw_rel, res)
            rec["raw"] = raw_rel
            rec["raw_sha"] = sha(p.read_bytes())
        self._log(rec)
        m = self.manifest()
        m["cost_usd"] = round(m["cost_usd"] + rec["cost_usd"], 5)
        m["keepa_tokens"] = m["keepa_tokens"] + (tok or 0)
        self._write_manifest(m)
        cap = m.get("shelf_cap_usd", K.DEFAULT_SHELF_CAP_USD)
        if m["cost_usd"] > cap:
            raise StepFailed(f"spend cap ${cap} passed (${m['cost_usd']}); run stopped")
        return res

    def _log(self, rec):
        with open(self.calls_path, "a") as f:
            f.write(json.dumps(rec, default=str) + "\n")

    def calls(self):
        return [json.loads(l) for l in self.calls_path.read_text().splitlines() if l.strip()]
