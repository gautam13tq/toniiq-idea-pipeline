"""Independent judge: Grok Build CLI headless. Sees ONLY the shelf definition + listing titles (no gate code, no codes)."""
import json,subprocess,re,random,sys
GROK='/home/box/.grok/bin/grok'
RULES="""You are auditing which Amazon listings belong on a product "shelf" (a competitor set for a supplement idea).
A listing is ON-SHELF only if ALL of these hold:
1. HERO: the hero ingredient is the primary active. Hero-led complete formulas count (hero named first after the brand, or the product is named for it, and no other active ingredient is named before the hero in the title) - e.g. "Brand Urolithin A + NMN + Pomegranate" is on an urolithin A shelf. If another active ingredient leads the title and the hero is secondary/tertiary, it is OFF (e.g. "Ferritin Iron + Lactoferrin" is off a lactoferrin shelf; "Magnesium Complex with ... Glycinate" is off a magnesium glycinate shelf; "Cranberry + D-Mannose" is off a D-mannose shelf). Generic class words (e.g. "Probiotic", "Fiber", "Turmeric" before curcumin) are not other actives.
2. FORM: if the shelf names a chemical form, the listing must be that form and not a blend of several forms of the same compound.
3. FORMAT: if the shelf names a format (gummies, powder, liquid, capsules/pills), the listing must be that format. If the title states no format at all: on a gummy/powder/liquid shelf treat it as OFF; on a capsule/pill shelf a dose-stated supplement may be treated as ON (pills are the default).
4. Not a pet, infant/baby, cosmetic/topical (cream, serum, essential oil, etc.), tea, coffee (unless the shelf is a coffee shelf), food/culinary (unless the shelf allows food), bulk dried herb, or other non-supplement product, and not an unrelated bundle.
5. If the shelf requires a second component, the listing must name it.
Judge from the title only. Be literal and consistent."""
SCHEMA_V='{"type":"object","properties":{"verdicts":{"type":"array","items":{"type":"object","properties":{"id":{"type":"string"},"on_shelf":{"type":"boolean"},"reason":{"type":"string"}},"required":["id","on_shelf","reason"]}}},"required":["verdicts"]}'
SCHEMA_D='{"type":"object","properties":{"duplicate_pairs":{"type":"array","items":{"type":"array","items":{"type":"string"}}}},"required":["duplicate_pairs"]}'
import os,hashlib
EMPTY='/tmp/judge_empty'; os.makedirs(EMPTY,exist_ok=True)
CACHE='/workspace/challenge-65/fork/gate/judge_cache'; os.makedirs(CACHE,exist_ok=True)
def ask(prompt,tries=3):
    # harness fix 2026-10-28: run from an EMPTY cwd (judge cannot see gate code/data), no web, schema-constrained JSON
    schema=SCHEMA_V if '"verdicts"' in prompt else SCHEMA_D
    h=hashlib.sha256(prompt.encode()).hexdigest()[:16]; cf=f'{CACHE}/{h}.json'
    if os.path.exists(cf): return json.load(open(cf))
    s=''
    for t in range(tries):
        r=subprocess.run([GROK,'--cwd',EMPTY,'--disable-web-search','--json-schema',schema,'-p',prompt+'\nDo not use any tools; answer from the titles above only.'],capture_output=True,text=True,timeout=900,cwd=EMPTY)
        s=r.stdout
        try:
            o=json.loads(s).get('structuredOutput')
            if o: json.dump(o,open(cf,'w')); return o
        except Exception: pass
    raise RuntimeError('judge failed: '+s[-500:])
def judge_listings(shelfdesc,items):
    L='\n'.join(f'{i["id"]}: {i["title"]}' for i in items)
    p=f"""{RULES}

SHELF: {shelfdesc}

LISTINGS (id: title):
{L}

Return ONLY JSON: {{"verdicts":[{{"id":"<id>","on_shelf":true|false,"reason":"<=12 words"}}, ...]}} with one entry per id."""
    return ask(p)
def judge_dups(shelfdesc,items):
    L='\n'.join(f'{i["id"]}: {i["title"]}' for i in items)
    p=f"""These are the top sellers kept for one Amazon shelf ({shelfdesc}). Each should be a distinct product line.
Flag any pair that is the SAME brand product line differing only by flavour, size, count, or pack quantity. Different brands, or different formulas/strengths/formats of a brand, are distinct.
If the title has no brand, only flag when titles are essentially identical apart from size/count/flavour.

{L}

Return ONLY JSON: {{"duplicate_pairs":[["<id>","<id>","<why>"], ...]}} (empty list if none)."""
    return ask(p)
