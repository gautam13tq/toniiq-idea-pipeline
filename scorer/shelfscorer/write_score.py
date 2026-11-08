"""The only code path that publishes a score. Refuses on any BLOCKER or any artifact changed since it was written."""
import json
import os
import urllib.request

from .runlog import sha, now


class Refused(Exception):
    pass


def publish(run, supabase=True):
    rep = run.read("EVAL_REPORT.json") if run.exists("EVAL_REPORT.json") else None
    if not rep:
        raise Refused("no EVAL_REPORT.json: run validate first")
    if rep["blockers_failed"]:
        raise Refused(f"{rep['blockers_failed']} BLOCKER checks failed; no score written")
    m = run.manifest()
    for a, h in m["artifacts"].items():
        if a.startswith("EVAL_REPORT") or a == "score_published.json":
            continue
        if sha((run.dir / a).read_bytes()) != h:
            raise Refused(f"artifact {a} changed after it was written")
    sc = run.read("score.json")
    spec = run.read("spec.json")
    row = {"run_id": run.run_id, "idea_id": m.get("idea_id"), "shelf_keyword": spec["shelf_keyword"],
           "scoring_version": sc["version"], "score": sc["score"], "raw": sc["raw"], "tier": sc["tier"],
           "D": sc["D"], "G": sc["G"], "C": sc["C"], "Diff": sc["Diff"], "hard": sc["hard"], "soft": sc["soft"],
           "info": sc["info"], "cost_usd": m["cost_usd"], "validated_at": rep["validated_at"], "published_at": now()}
    if not (run.dir / "score_published.json").exists():
        run.save("score_published.json", row)
    run.update(status="validated", ended_at=now())
    if supabase and os.environ.get("SUPABASE_URL") and os.environ.get("SUPABASE_SERVICE_ROLE_KEY"):
        _upsert(row)
    return row


def _upsert(row):
    url, key = os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    req = urllib.request.Request(f"{url}/rest/v1/shelf_scores?on_conflict=run_id", data=json.dumps(row).encode(), method="POST",
                                 headers={"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json",
                                          "Prefer": "resolution=merge-duplicates,return=representation"})
    with urllib.request.urlopen(req, timeout=60) as r:
        back = json.load(r)[0]
    if back.get("score") != row["score"]:
        raise Refused("read-back of the written row does not match score.json")
