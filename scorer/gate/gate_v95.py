"""Competitor-set gate v9.5 (2026-10-30; addendum 10). Follows SHELF_RULEBOOK.md rulebook_v1.7 (v1.6 + NPD settles of the v9.4 failure classes).
Imports frozen gate_v94.py (not modified) and wraps classify; collapse unchanged. General rules only (no ASIN/brand lists):
 X1 (a) Source-qualified hero: a word (optionally + root/seed/sprout/leaf/berry/bark/fruit/extract) sitting directly before the hero with no
    separator ("Broccoli Sulforaphane", "X Root Y") is the hero's source, not an earlier ingredient, when "X <part>" is itself a shelf hero
    term (broccoli seed/sprouts for sulforaphane) or the PDP says "hero from/derived from X". Re-tested with it masked; counts only if then IN.
 X2 (b) Kids: EX_KIDS only when kids-only. A title kids word ("Kids 4+") with adult dosing in directions/bullets ("Adults take 2 gummies",
    "adults: 2 capsules") = all-ages; re-tested with the kids word masked. "for kids and adults" copy alone is not adult dosing.
 X3 (c) Pill beats powder: a title naming both powder and a capsule/tablet/softgel unit ("Root Powder Capsules") is a pill; a title with no
    format word whose Item Form is Capsule/Tablet/Softgel/Gummy takes that form when the bullets also name that unit (a bullet "maca powder"
    describes the contents).
 X4 (d) Tea: a tea word inside a pill/gummy title (helper ingredient: "Capsules ... with Maca, Green Tea") is not a tea format; a "tea powder"
    sold with supplement servings / the word supplement and no tea-bag/brew/loose-leaf word is a supplement powder. Re-tested with tea masked.
 X5 (e) Whole-food singular: "seed/root/herb/leaf/berry whole", "whole seed", "bulk ... lb/oz bag" with a weight, no dose and no
    supplement-form word = EX_NOT_SUPPLEMENT (extends W1). Same for a "bulk" herb powder by weight with no dose, servings, extract or
    supplement/unit word (R5-4 bulk culinary single-herb powder).
 X6 (f) R6-1 broader base: "<coined product name> with|+ <hero>" - the name before the link is a product name (no generic descriptor word
    such as supplement/support/relief/formula/hair/liver/immune), the hero follows alone (not "& <other active>") and undosed - where the PDP
    ingredient panel's first active is a different ingredient = HERO_SECONDARY (hero is an add-on to a broader base formula). Also when the
    panel carries >=8 dosed actives (a broad formula, e.g. a ten-ingredient diet pill "... with <hero>, Green Tea, Berberine") whatever the name.
 X7 (g) Form shelves: when the title's only shelf-form word is the generic "chelate(d)" and the ingredient panel names the hero's compound
    (parenthetical/"as") as a named chemical that is not a shelf form and not a chelate ("Cuprous Nicotinic Acid"), the label wins = EX_FORM_MISMATCH.
    A generic "amino acid chelate" panel is consistent with a "chelate" title (unchanged)."""
import re,sys,os
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
import gate_v94 as V4
from gate_v94 import *            # noqa: F401,F403
from gate_v94 import SH,norm,ncomma,fmt_of,ORAL,DOSE2,SOLD,WEIGHT,NOTFOOD,collapse,sold,ing_names
I=re.I
SRCW=r"(?:\s+(?:root|seed|sprouts?|leaf|leaves|berry|bark|fruit|flower|extract))?"
ADULTDOSE=re.compile(r"\badults?\s*(\([^)]*\)\s*)?:?\s*(take|chew|use|\d)|\badults?\b[^.;|]{0,25}?\b\d+\s*(gumm\w*|caps\w*|tab\w*|softgels?|ml|drops?|scoops?|servings?)\b",I)
TEAW=re.compile(r"\b(green|black|white|herbal|matcha|oolong|chai)?\s*teas?\b",I)
TEAFMT=re.compile(r"\btea ?bags?\b|\bk-?cups?\b|\bbrew\w*\b|\bsteep\w*\b|\bloose[- ]leaf\b|\bcups? of tea\b|\binfusion\b",I)
PILLW=re.compile(r"\b(capsules?|caps|vcaps|veg ?caps|tablets?|softgels?|caplets?|gumm(y|ies))\b",I)
WHOLE2=re.compile(r"\b(seed|root|herb|leaf|berry)\s+(whole|bulk)\b|\bwhole\s+(seed|root|herb|leaf|berry)\b|\bbulk\b(?=.{0,25}\b(bag|lbs?|pounds?|oz|ounces?)\b)",I)
CHEM=re.compile(r"\b\w*(ate|ite|ide|ous|ic)\b|\bacid\b|\bchelate\b",I)
DESCR=re.compile(r"\b(supplements?|support|relief|formula|complex|blend|vitamins?|multivitamin|for|women|men|kids|adults|hair|skin|nails|detox\w*|cleanse|liver|hormones?|balance|health|healthy|cortisol|vein|veins|mushrooms?|probiotics?|digestive|immune|weight|loss|sleep|energy|stress|mood|focus|brain|heart|joint|gut|repair|natural|premium|pure|extra|strength|max|advanced)\b",I)
def _blank(t,a,b): return t[:a]+' '*(b-a)+t[b:]
def _sub(rx,t): return re.sub(rx,lambda m:' '*len(m.group(0)),t,flags=I)
def _pdp(x): return ' '.join(x.get('bullets') or [])+' | '+(x.get('ingredients') or '')+' | '+(x.get('special_ing') or '')
def _panel_lead(x):
    ing=x.get('ingredients') or ''
    m=re.search(r'ingredients?\s*:?(?:\s*active ingredients?\s*:?)?(.*)',ing,I)
    if not m: return None
    s=re.split(r'(?i)other ingredients|inactive ingredients|\|\s*directions|\bdirections\b',m.group(1))[0]
    s=re.sub(r'\(.*?\)|\[.*?\]',' ',s)
    for part in re.split(r'[,;|•]|\s-\s|\d[\d.,]*\s*(?:mg|mcg|g|iu)\b',s):
        w=' '.join(re.sub(r'[^A-Za-z \-]',' ',part).split())
        if len(w)<3 or V4.EXCIP.search(w): continue
        return w
    return None
def _prep5(x):
    t=x.get('title') or ''
    if fmt_of(t)=='powder' and PILLW.search(t):                             # X3 pill unit beats powder in the title
        x=dict(x,title=_sub(r'\bpowder(ed)?\b',t))
    elif fmt_of(t) is None and V4._unitform(x) and x.get('bullets'):
        u=V4._unitform(x)
        if fmt_of(' '.join(x['bullets'][:2]))=='powder' and PILLW.search(' '.join(x['bullets'])):   # X3 Item Form unit beats bullet "powder"
            x=dict(x,bullets=[_sub(r'\bpowder(ed)?\b',b) for b in x['bullets']])
    return x
def classify(shelf,x):
    x=norm(x); sh=SH[shelf]; x=_prep5(x); t=ncomma(x.get('title') or '')
    ok,code,det,f=V4.classify(shelf,x)
    if code=='EX_KIDS' and ADULTDOSE.search(_pdp(x)):                           # X2
        t2=_sub(r"\b(kids?|kid's|children'?s?|child|toddlers?|little ones)\b(\s*\d+\s*\+)?",t)
        ok2,code2,det2,f2=V4.classify(shelf,dict(x,title=t2))
        if code2!='EX_KIDS': ok,code,det,f=ok2,code2,det2,f2; t=t2
    if code=='EX_NOT_SUPPLEMENT' and str(det).startswith('tea:'):               # X4
        mt=re.search(r'\bteas?\b',t,I)
        helper=mt and (PILLW.search(t[:mt.start()]) or (f in ('pill','gummy') and PILLW.search(t))) and not TEAFMT.search(t)
        tpow=re.search(r'\btea powder\b',t,I) and (re.search(r'\bservings?\b|\bsupplements?\b',t,I)) and not TEAFMT.search(t)
        if helper or tpow:
            t2=_sub(r'\bteas?\b',t); ok2,code2,det2,f2=V4.classify(shelf,dict(x,title=t2))
            if not str(det2).startswith('tea:'): ok,code,det,f=ok2,code2,det2+' (X4 tea = helper ingredient/supplement powder)' if det2 else 'X4 tea = helper ingredient/supplement powder',f2; t=t2
    if code=='HERO_SECONDARY':                                                  # X1
        m=re.match(r'"(.+?)" named before hero',str(det)); hs=re.search(sh['hero'],t,I)
        if m and hs:
            w=m.group(1).strip(); mw=None
            for mm in re.finditer(re.escape(w)+SRCW+r'\s+',t[:hs.start()+1],I): mw=mm
            if mw and mw.end()==hs.start() and len(w.split())<=2:
                pdp=_pdp(x); H=sh['hero']; W=re.escape(w)
                tied=any(re.fullmatch(H,(w+' '+q).strip(),I) for q in ('','seed','seeds','sprout','sprouts','root','leaf','berry','bark','fruit','extract')) or \
                     re.search(rf'(?:{H})[^.,;|]{{0,25}}\b(?:from|derived from|sourced from|extracted from)\s+(?:\w+\s+)?{W}|{W}[- ](?:derived|sourced)\s+(?:{H})',pdp,I)
                if tied:
                    ok2,code2,det2,f2=V4.classify(shelf,dict(x,title=_blank(t,mw.start(),mw.end()-1)))
                    if ok2: return True,code2,f'X1 "{w}" = source qualifier of hero'+(f'; {det2}' if det2 else ''),f2
    if not ok: return ok,code,det,f
    if f not in ('pill','gummy','chew') and not DOSE2.search(t) and not NOTFOOD.search(t) and not SOLD.search(t):   # X5
        mw=WHOLE2.search(t)
        if mw and WEIGHT.search(t): return False,'EX_NOT_SUPPLEMENT','whole-food/bulk: '+mw.group(0),f
    if f in (None,'powder') and not DOSE2.search(t) and not SOLD.search(t) and WEIGHT.search(t) and re.search(r'\bbulk\b',t,I) \
       and not re.search(r'\b(supplements?|capsules?|caps|tablets?|softgels?|gumm\w+|extract|servings?|scoops?|mg|mcg)\b',t,I):
        return False,'EX_NOT_SUPPLEMENT','bulk single-herb powder by weight, no dose (R5-4)',f
    if sh.get('form'):                                                          # X7
        mf=[mm.group(0) for mm in re.finditer(sh['form'],t,I)]
        if mf and all(re.fullmatch(r'chelated?',z,I) for z in mf):
            hstem=sh['hero'].replace(r'\b','')
            ing=re.split(r'(?i)other ingredients|inactive ingredients',x.get('ingredients') or '')[0]
            for seg in re.findall(rf'[^,;|]*{hstem}[^,;|(]*\(([^)]*)\)',ing,I):
                spec=re.sub(r'\|?chelate\[?d?\]?\??','',sh['form'])
                if CHEM.search(seg) and not re.search(r'chelat',seg,I) and not re.search(sh['form'] if not spec else spec,seg,I) and not re.fullmatch(r'\s*(as\s+)?\w*\s*chelated?\s*',seg,I):
                    return False,'EX_FORM_MISMATCH','label compound not a shelf form: '+seg.strip()[:40],f
    mh=re.search(sh['hero'],t,I)                                                # X6
    if mh and not DOSE2.search(t[mh.end():mh.end()+25]):
        lk=list(re.finditer(r'\bwith\b|\+',t[:mh.start()],I))
        if lk and not re.search(r'[,|]',t[lk[-1].end():mh.start()]) and len(t[lk[-1].end():mh.start()].split())<=2:
            pre=(V4.strip_brand(t[:lk[-1].start()],x) or '').strip(' -|,')
            after=re.match(r'\s*(?:\w+\s+)?(?:&|and|,|\+)\s*([A-Za-z][\w\'-]+)',t[mh.end():])
            alone=not (after and not re.match(r'(capsules?|caps|tablets?|softgels?|gumm\w+|drops|liquid|powder|vegan|organic|\d)',after.group(1),I))
            nd=len(DOSE2.findall(re.split(r'(?i)other ingredients|inactive ingredients|directions',x.get('ingredients') or '')[0]))
            if pre and re.search(r'[A-Za-z]{2,}',pre) and (not DESCR.search(pre) and alone or nd>=8):
                lead=_panel_lead(x)
                if lead and not re.search(sh['hero'],lead,I) and not (sh.get('cls') and re.search(sh['cls'],lead,I)):
                    return False,'HERO_SECONDARY',f'X6 R6-1 coined name "{pre[-25:]}" + hero, label lead active "{lead[:30]}" (broader base)',f
    return ok,code,det,f
def run_shelf(shelf,recs,k=12):
    dec={}; inc=[]
    recs=[norm(x) for x in recs]
    for x in recs:
        ok,code,det,f=classify(shelf,x)
        dec[x['id']]=dict(include=ok,code=code,detail=det,fmt=f)
        if ok: inc.append(dict(x,sold=sold(x),fmt=f))
    kept,dropped=collapse(inc,SH[shelf]['hero'])
    for p,ka,why in dropped: dec[p['id']].update(include=False,code='EX_VARIANT_DUP',detail=f'{why} -> {ka}',dup_of=ka)
    top=sorted(kept,key=lambda p:(-p['sold'],p.get('page') or 9,p.get('pos') or 99))[:k]
    return dict(dec=dec,kept=[p['id'] for p in kept],top=[p['id'] for p in top])
