"""Competitor-set gate v9.6 (2026-10-31; addendum 11). Follows SHELF_RULEBOOK.md rulebook_v1.8 (v1.7 + Gautam R7-1 + NPD settles).
Imports frozen gate_v95.py (not modified) and wraps classify; collapse unchanged. General rules only (no ASIN/brand lists):
 Y1 Branded ingredient: a trademark-style name that the PDP ties to the hero ("5-Loxin (standardized extract of Boswellia serrata)",
    "5-Loxin Boswellia", "N is extracted from <hero>") is the hero itself, not an earlier ingredient. Re-tested with the name masked.
 Y2 Descriptor before hero: "5in1 / 3-in-1 / Extract / Standardized / Organic / Premium ..." made only of descriptor words is not an ingredient.
 Y3 "X Free" / "X-Free" / "No X" means the product does NOT contain X; masked before the hero-lead test.
 Y4 "Whole Root/Herb/Seed" with a per-unit mg/mcg dose in the title is a dosed supplement, not bulk; re-tested with the phrase masked.
 Y5 Misspelled hero: when the title has no hero match, a title word span within edit distance 1 (len>=5) of a
    literal hero term ("Ginko", "Donq Quai") is read as that term.
 Y6 R7-1 label lead: an IN listing whose ingredient panel's first dosed active is a different ingredient with a higher dose (mg-normalised)
    than the hero's panel dose = HERO_SECONDARY, regardless of name words or number of actives. When the panel carries no doses at all, the
    coined-name rule "<name> with|+ <hero>" whose panel lists a different first active = HERO_SECONDARY (no descriptor/count conditions)."""
import re,sys,os
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
import gate_v95 as V5
from gate_v95 import *            # noqa: F401,F403
from gate_v95 import SH,norm,ncomma,fmt_of,DOSE2,collapse,sold,_pdp,_panel_lead,_sub,_blank
I=re.I
DESCW=re.compile(r"^(\d+\s*-?\s*in\s*-?\s*\d+|\d+in\d+|extracts?|standardi[sz]ed|concentrated?|herbal|natural|organic|premium|pure|potent|strength|max|maximum|ultra|super|advanced|triple|double|high|potency|full|spectrum|whole|raw|vegan|plus|best|new|improved|clinical|patented)$",I)
NUTR=re.compile(r"^(calories|total|sugars?|added|sodium|protein|fat|carbohydrates?|fiber|cholesterol|serving|servings|amount|per|daily|value|dv)\b",I)
def _lits(rx):
    out=[]
    for a in rx.split('|'):
        a=re.sub(r'\\b|\\w\*|\?|\(|\)','',a); a=re.sub(r'\[- \]','-',a); a=re.sub(r'\[[^\]]*\]','',a)
        a=a.replace('\\','').strip()
        if re.fullmatch(r"[A-Za-z' -]{5,}",a): out.append(a.replace('-',' ').lower())
    return out
def _ed(a,b):
    p=list(range(len(b)+1))
    for i,ca in enumerate(a,1):
        c=[i]
        for j,cb in enumerate(b,1): c.append(min(p[j]+1,c[j-1]+1,p[j-1]+(ca!=cb)))
        p=c
    return p[-1]
def _fuzzy(shelf,t):
    H=SH[shelf]['hero']
    if re.search(H,t,I): return t
    toks=list(re.finditer(r"[A-Za-z']+",t))
    for lit in _lits(H):
        n=len(lit.split()); k=1
        for i in range(len(toks)-n+1):
            s,e=toks[i].start(),toks[i+n-1].end(); span=re.sub(r'[\s-]+',' ',t[s:e]).lower()
            if span!=lit and abs(len(span)-len(lit))<=k and span[0]==lit[0] and _ed(span,lit)<=k:
                return t[:s]+lit+t[e:]
    return t
def _mg(v,u):
    v=float(v.replace(',','')); u=u.lower()
    return v/1000 if u in ('mcg','µg') else v*1000 if u=='g' else v if u=='mg' else None
VITMIN=re.compile(r"\b(vitamins?|biotin|fol(ate|ic)|niacin\w*|riboflavin|thiamin\w*|pyridox\w*|cobalamin|b-?\d{1,2}|calcium|magnesium|zinc|iron|copper|selenium|chromium|manganese|iodine|potassium|sodium|phosphorus|molybdenum|boron)\b",I)
BLENDW=re.compile(r"\b(blend|proprietary|matrix|complex|includes?|scoops?|teaspoons?|tablespoons?|capsules?|softgels?|tablets?|gumm\w+|caplets?|drops?|ml)\b",I)
HDR=re.compile(r"^.*\b(amount per serving|per serving|servings? per container\s*\d*|serving size[^A-Z]*|% ?daily value|% ?dv|daily value|description|amount)\b\W*",I)
def _panel_doses(x):
    ing=x.get('ingredients') or ''
    m=re.search(r'ingredients?\s*:?(.*)',ing,I)
    if not m: return []
    s=re.split(r'(?i)other ingredients|inactive ingredients|\|\s*directions|\bdirections\b',m.group(1))[0]
    raw=s; t=s
    for _ in range(3): t=re.sub(r'\([^()]*\)|\[[^\[\]]*\]',lambda m:'\x00'*len(m.group(0)),t)
    out=[]; prev=0
    for mm in re.finditer(r"(\d[\d,]*(?:\.\d+)?)\s*(mg|mcg|µg|g)\b",t):
        seg=raw[prev:mm.end()]; name=t[prev:mm.start()].replace('\x00',' '); prev=mm.end()
        name=HDR.sub('',name); name=' '.join(re.sub(r"[^A-Za-z0-9' \-]",' ',name).split()).strip(' -')
        name=re.sub(r'^(?:\d+\s*%?\s*)+','',name).strip()
        if not name or len(name)<3 or NUTR.search(name): continue
        out.append((name,' '.join(re.sub(r'[\[\]]',' ',seg).split()),_mg(mm.group(1),mm.group(2)),raw[mm.end():mm.end()+60]))
    return out
def _retry(shelf,x,t2,tag):
    ok,code,det,f=V5.classify(shelf,dict(x,title=t2))
    return ok,code,(f'{tag}; {det}' if det else tag),f
def classify(shelf,x):
    sh=SH[shelf]; x=dict(x)
    t0=x.get('title') or ''; t1=_fuzzy(shelf,t0); fz=t1!=t0
    if fz: x['title']=t1                                                      # Y5
    ok,code,det,f=V5.classify(shelf,x)
    if fz and det is not None: det=f'Y5 misspelled hero read as hero; {det}'
    t=x.get('title') or ''
    for _ in range(3):
        m=re.match(r'"(.+?)" named before hero',str(det))
        if code!='HERO_SECONDARY' or not m: break
        w=m.group(1).strip(); wc=w.strip('-–— ')
        mw=re.search(r"[\w-]*"+re.escape(wc)+r"[\w-]*",t,I); tok=mw.group(0) if mw else wc
        free=re.search(r'\b(no\s+)'+re.escape(wc)+r'\b|'+re.escape(wc)+r'\s*-?\s*free\b',t,I)
        if free:                                                              # Y3
            t2=_sub(r'\bno\s+'+re.escape(wc)+r'\b|'+re.escape(wc)+r'\s*-?\s*free\b',t); ok,code,det,f=_retry(shelf,x,t2,f'Y3 "{wc} free" = does not contain'); t=t2; x=dict(x,title=t2); continue
        if all(DESCW.match(z) for z in re.split(r'\s+',wc) if z):              # Y2
            t2=_sub(r'(?<![\w-])'+re.escape(wc)+r'(?![\w-])',t); ok,code,det,f=_retry(shelf,x,t2,f'Y2 "{wc}" = descriptor'); t=t2; x=dict(x,title=t2); continue
        H=sh['hero']; W=re.escape(tok); pdp=_pdp(x)
        tied=len(tok.split())<=2 and (re.search(W+r'\s*[®™]?\s*\(\s*(?:a\s+)?(?:patented\s+|proprietary\s+)?(?:standardi[sz]ed\s+)?(?:extract|from|derived|sourced)\b[^)]{0,40}(?:'+H+')',pdp,I) or \
             re.search(W+r'\s*[®™][^.|;]{0,40}(?:'+H+')',pdp,I) or re.search(W+r'[^.|;]{0,30}\b(?:is|are)\b[^.|;]{0,30}\b(?:extracted|derived|sourced|made)\s+from\s+(?:\w+\s+){0,2}(?:'+H+')',pdp,I))
        if tied and len(tok)>=3:                                              # Y1
            t2=_sub(r'(?<![\w-])'+W+r'(?![\w-])\s*[®™]?',t); ok,code,det,f=_retry(shelf,x,t2,f'Y1 "{tok}" = branded form of hero'); t=t2; x=dict(x,title=t2); continue
        break
    if code=='EX_NOT_SUPPLEMENT' and re.search(r'bulk_herb|whole-food',str(det)) and re.search(r'\d[\d.,]*\s*(mg|mcg)\b',t,I):   # Y4
        mw=re.search(r'\bwhole\s+(root|herb|seeds?|leaf|leaves|berry|berries|plant)\b|\b(root|herb|seed|leaf|berry)\s+whole\b',t,I)
        if mw:
            ok2,code2,det2,f2=_retry(shelf,x,_blank(t,mw.start(),mw.end()),'Y4 whole-root with per-unit dose = supplement')
            if not (code2=='EX_NOT_SUPPLEMENT' and re.search(r'bulk_herb|whole-food',str(det2))): ok,code,det,f=ok2,code2,det2,f2
    if not ok: return ok,code,det,f
    H=sh['hero']; cls=sh.get('cls'); D=_panel_doses(x)                          # Y6
    micro=bool(VITMIN.search(shelf)) or bool(sh.get('form'))
    hi=[i for i,d in enumerate(D) if re.search(H,d[1],I)]
    if D and hi and not micro:
        hd=D[hi[0]]
        if re.search(r'\b(hdu|cfu|fu|iu|spu|dpp-?iv|alu|units?|billion)\b',hd[1]+' '+hd[3],I): hd=(hd[0],hd[1],None,'')
        heads={l.split()[0] for l in _lits(H) if len(l.split()[0])>=5}
        for d in D[:hi[0]]:
            if any(re.search(r'\b'+re.escape(h)+r'\b',d[1],I) for h in heads): break
            if VITMIN.search(d[0]) or BLENDW.search(d[0]) or (cls and re.search(cls,d[0],I)) or d[2] is None or hd[2] is None: continue
            if d[2]>hd[2]: return False,'HERO_SECONDARY',f'Y6 R7-1 label lead "{d[0][:30]}" {d[2]:g} mg > hero {hd[2]:g} mg',f
            break
    if not DOSE2.search(re.split(r'(?i)other ingredients|inactive ingredients|directions',x.get('ingredients') or '')[0]):
        mh=re.search(H,t,I)
        if mh:
            lk=list(re.finditer(r'\bwith\b|\+',t[:mh.start()],I))
            if lk and not re.search(r'[,|]',t[lk[-1].end():mh.start()]) and len(t[lk[-1].end():mh.start()].split())<=2:
                pre=(V5.V4.strip_brand(t[:lk[-1].start()],x) or '').strip(' -|,')
                lead=_panel_lead(x)
                if pre and re.search(r'[A-Za-z]{2,}',pre) and not V5.DESCR.search(pre) and lead and not re.search(H,lead,I) and not (cls and re.search(cls,lead,I)):
                    return False,'HERO_SECONDARY',f'Y6 R6-1/R7-1 coined "{pre[-25:]}" + hero, undosed label lead "{lead[:30]}"',f
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
