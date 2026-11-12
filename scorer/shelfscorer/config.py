"""Every fixed number the scorer uses, in one place. Changing any of these is a new scorer version."""
from . import VERSION

WEIGHTS = {"D": 0.25, "G": 0.05, "C": 0.45, "Diff": 0.25}   # Gautam 4 Nov 2026
T_STRONG = 60.0                                            # Gautam 8 Nov 2026 (replaces 61.5)
CAP_SCORE = round(T_STRONG - 0.1, 1)                       # soft caps hold a score at 59.9
TIERS = [(T_STRONG, "strong"), (50.0, "watchlist"), (35.0, "needs work"), (float("-inf"), "pass")]

SHELF_SIZE = 12          # Gautam 8 Nov: the shelf is the top 12, all shown
MIN_BADGED = 8           # n_sig < 8 -> sales_rank_pending cap
MIN_KEPT_CAP = 8         # kept families < 8 -> thin_shelf cap
MIN_KEPT_HARD = 3        # kept families < 3 -> no score
MOAT_CAP = 8.0
C_CAP = 6.0
MIN_CANDIDATES = 30
MAX_DATA_AGE_DAYS = 7
DIFF_UNSTABLE_DELTA = 1.0

# Demand gate (scoring_core.ts L626-663)
DEMAND_MIN_PRIMARY = 100
DEMAND_PULL_MAX = 44     # Datarova keywords pulled for demand/growth (parent + hero variants + lane), 11 Nov 2026
# Sleeve rule (Gautam, 11 Nov 2026): sleeves.py
SLEEVE_MIN_CLICKS = 1000      # sleeve cluster latest-month clicks
SLEEVE_MIN_ROWS = 2           # ... over at least 2 keyword rows with data
SLEEVE_MIN_BADGES = 2000      # and the sleeve's top 12 sells >= 2,000 a month (summed monthly-sold badges)
DEFAULT_FORMAT_SHARE = 0.75   # 75%+ of the parent's top 12 in the sleeve's format -> score the parent

# C_v8 anchors (c74.py ANCH)
C8_ANCHORS = {"M1": (100, 4000), "M2": (550, 15000), "M3": (150, 6000)}
C_OLD_WEIGHTS = {"moat": 0.25, "rr": 0.20, "bsr": 0.15, "br": 0.10, "den": 0.10, "pr": 0.10, "sp": 0.10}
SPEC_WEDGE_FIXED = 5.0
MOAT_BLEND = 0.25        # C = C_old + 0.25 * (C_v8 - moat)

# Data pulls
APIFY_ACTOR = "axesso_data/amazon-search-scraper"
APIFY_MAX_PAGES = 2
APIFY_MAX_QUERIES = 4
# Opt-in fallback (12 Nov 2026, run opened with --allow-no-apify): when Apify answers 401, page-1 discovery for each
# query uses Keepa product search instead, 3 Keepa pages of 20 = 60 results, about Apify's 2 Amazon pages.
NO_APIFY_KEEPA_PAGES = 3
NO_APIFY_PAGE_SIZE = 48      # Amazon results per page, to turn a Keepa search index into (page, position)
KEEPA_DOMAIN = 1
KEEPA_ROOT_CATEGORY = 3760901   # Health & Household
KEEPA_FINDER_PAGES = 2
DATAROVA_BASE = "https://api.datarova.com/v0"
DATAROVA_BATCH = 10

# Models (the app's pinned SONNET constant, clients.ts)
MODEL = "claude-sonnet-4-5"
DIFF_MAX_TOKENS = 2500

# Spend
DEFAULT_SHELF_CAP_USD = 2.0

DIFF_VECTORS = ["concentration_potency", "branded_patented_ingredient", "purity_standardization",
                "multi_pathway_stack", "cfu_strain_specificity", "bioavailability_delivery"]


def tier(score):
    for bar, name in TIERS:
        if score >= bar:
            return name
    return "pass"


def frozen():
    return dict(version=VERSION, weights=WEIGHTS, T=T_STRONG, cap_score=CAP_SCORE, shelf_size=SHELF_SIZE,
                model=MODEL, c8_anchors=C8_ANCHORS, c_old_weights=C_OLD_WEIGHTS)
