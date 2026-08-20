# UI smoke suite (Playwright)

Live post-deploy smoke tests against the Toniiq idea pipeline SPA. Catches blank shells from hung auth, silent 401s, and broken data paths.

## One-time setup

```bash
npm install
npx playwright install chromium
```

## Credentials

Store credentials outside the repo at `~/.config/toniiq-npd/smoke.env`:

```bash
SMOKE_EMAIL=you@example.com
SMOKE_PASSWORD=your-password
```

The suite reads `SMOKE_EMAIL` and `SMOKE_PASSWORD` from the process environment only — never from a path inside this repo.

Optional: override the target deployment (defaults to production):

```bash
SMOKE_BASE_URL=https://toniiq-idea-pipeline.vercel.app
```

## Run

```bash
set -a; source ~/.config/toniiq-npd/smoke.env; set +a; npm run eval:ui-smoke
```

## What it checks

1. **Login** — form renders, sign-in completes within 15s (catches infinite auth loading).
2. **Pipeline / decide** — Evaluation page loads; fails on load-error banners or an empty main region.
3. **Discover** — hub tabs render; switching Shortlist → AI Picks changes visible content.
4. **Development** — queue tabs and at least one product row (registry data path).
5. **Console hygiene** — no `error`-level console messages across the run.

## Console allowlist

These benign messages are ignored:

- Favicon 404 / failed favicon resource loads (common on SPAs without a favicon asset).

Any other console `error` fails the suite.
