r"""Competitor-set gate v11.0 HYBRID (2026-11-01; addendum 16). Follows SHELF_RULEBOOK.md rulebook_v2.3 (v2.2 + Gautam R12-1 + NPD settles).
Imports frozen gate_v100.py (not modified; through it v99..v92). Two layers:
 RULES LAYER (general rules only; no ASIN or brand lists):
  D1 R7-1 by dose: plain (non-vitamin/mineral, no form) shelf, label panel doses the hero AND another (non-vitamin/mineral, non-helper)
     active higher. Formula-named title (formula/stack/blend/complex/booster) that does not name that active and ratio >= 2x ->
     HERO_SECONDARY (not when the title states activity units such as HDU/CFU/HUT, where mg ratios mislead); any other higher-dose
     case -> UNSURE (U2). Not when R10-1 (equal-billed N-in-1) applies.
  D2 Saline-laxative / oral-solution liquids (title "Oral Solution", or "laxative" + liquid) with no "supplement" in the title =
     EX_NOT_SUPPLEMENT (OTC drug, P3).
  D3 Co-named earlier active (v2.1, R7-1): "<X> and/&/+ <hero>" opening a title segment, where X is 1-3 non-dictionary (ingredient-name)
     words that are not the brand, not an origin/varietal adjective and not a hero alias = HERO_SECONDARY, unless R10-1 applies.
  D4 Category vs directions (v2.0): a grocery/beverage category exclusion is undone when the title shows a supplement material
     (extract ratio "4:1", standardisation "0.6%", or "extract") and the label is the hero alone.
  D5 Origin/varietal adjectives ("German", "Roman", "Siberian", "Korean", "Ceylon" ...) named before the hero are not other actives.
  D6 N-in-1 count + benefit words (incl. obfuscated spellings) before the hero, label lead after vitamins/minerals = hero (and no
     vitamin/mineral out-doses it) = HERO_LED_COMPLEX (R3-1, R4-2).
  D7 Bulk (R5-4) needs "no dose": a per-serving amount stated anywhere in the copy ("Serving Size = 3g", "servings per container")
     means dosed, so the bulk exclusion is undone.
  D8 R12-1 precursor pair: on a form shelf, a powder/drink whose title sells the shelf form and whose label holds the hero's base salt
     (carbonate/oxide/hydroxide/bicarbonate) plus the form's acid (citric acid -> citrate, malic acid -> malate ...) = IN_OK.
 THREE-WAY CALLS (classify3 -> IN / OUT / UNSURE). UNSURE when signals conflict, the label is missing/partial, the lead active is
  unclear, or the form/category is ambiguous:
  U1 no label panel and the title/bullets read as a multi-active formula (formula/booster/stack/blend/complex/system words in the
     title, or the bullets name another active before the hero).
  U2 label-lead conflict: the gate keeps the item but the label walk leads with another active that the title also names (hero later),
     with no dose to settle it; or a D1 higher-dose other active not settled by D1.
  U3 form conflict: B8 single-form title over a label clause led by another form (not settled by D8).
  U4 category conflict: a category-only not-supplement call on a title with an oral-form / extract word (not settled by D4), or
     an IN call in a grocery / beauty category with no oral-form word.
  (U5 single-word "named before hero" was tried in dev and retired: those were nearly all correct OUTs.)
 JUDGE: every UNSURE item goes to a headless model judge (grok -p, judge_prompt_v110.txt; shelf spec + listing + full
  GAUTAM_DECISIONS text) which returns JSON {verdict IN|OUT, rule_id, reason}; cached by sha256 of the prompt (gold_work/judge_cache).
  The judge verdict decides include; collapse/top-12 unchanged."""
import re,sys,os,json,hashlib,subprocess
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from gate_v100 import *            # noqa: F401,F403
from gate_v100 import SH,ncomma,VITMIN,collapse,sold,norm9,FORMW,ORALW
import gate_v100 as V100
V99=V100.V99; V7=V99.V7
I=re.I
_D=os.path.dirname(os.path.abspath(__file__))
INC={'IN_OK','HERO_LED_COMPLEX'}
add_holdout_specs=V100.add_holdout_specs
def _t(x):
    t=ncomma(x.get('title') or ''); return t,(V7.V5.V4.strip_brand(t,x) or t)
def _ing(x):
    s=str(x.get('ingredients') or ''); return '' if s.strip().lower() in ('','none') else s
def _bul(x):
    b=x.get('bullets'); return ' | '.join(b) if isinstance(b,list) else str(b or '')
def _act(x):
    return re.split(r'(?i)other ingredients|inactive ingredients|\|\s*directions|\bdirections\b',_ing(x))[0]
def _panel(x):
    return bool(re.search(r'ingredients?\s*:?\s*\S',_ing(x),I))
def _hv(H): return bool(VITMIN.search(re.sub(r'\\b|\\w\*','',H)))
FORMULA=re.compile(r'\b(formula|formulations?|stack|blend|complex|matrix|system|booster)\b',I)
MINH=re.compile(r'magnes|zinc|iron|calcium|chromium|selen|potassium|copper|iodine|boron|manganese|vitamin|ferr',I)
# ---------------- D1 R7-1 by dose
def _dose_lead(shelf,x):
    sh=SH[shelf]; H=sh['hero']
    if sh.get('form') or _hv(H) or MINH.search(H): return None
    ds=V7._panel_doses(x)
    hd=[d for n,_,d,_ in ds if d and re.search(H,n,I)]
    if not hd: return None
    oth=[(d,n) for n,_,d,_ in ds if d and not re.search(H,n,I) and not VITMIN.search(n) and not V99.HELPER.search(n)
         and not V7.V5.V4.EXCIP.search(n) and not re.search(r'\b(blend|complex|formula|total|proprietary|matrix)\b',n,I)
         and not (sh.get('cls') and re.search(sh['cls'],n,I))]
    if not oth: return None
    d,n=max(oth); r=d/max(hd[0],1e-9)
    return (r,n) if r>1 else None
# ---------------- D2 laxative solutions
def _laxative(x):
    t=x.get('title') or ''
    if re.search(r'dietary\s+supplement|\bsupplements?\b',t,I): return None
    liquid=re.search(r'\bliquid\b|\bsolution\b|\bfl\.?\s*oz\b|\b\d+\s*ml\b',t,I) or re.search(r'liquid',str(x.get('item_form') or ''),I)
    m=re.search(r'\boral\s+solution\b',t,I) or (liquid and re.search(r'\blaxatives?\b',t,I))
    return m.group(0) if m else None
# ---------------- D3 / D5
ORIGIN=re.compile(r"^(german|roman|egyptian|siberian|korean|american|asian|chinese|indian|peruvian|brazilian|ceylon|saigon|mexican|mediterranean|himalayan|tibetan|japanese|turkish|persian|hungarian|bulgarian|greek|spanish|italian|french|english|european|african|australian|canadian|hawaiian|alaskan|andean|amazonian|amazon|arctic|nordic|swedish|russian|mongolian|moroccan|vietnamese|thai|indonesian|tahitian|madagascar|wild|wildcrafted|true|common)$",I)
def _brandw(x):
    return {w.lower() for b in (x.get('brand'),x.get('manufacturer')) if b for w in re.findall(r"[A-Za-z][A-Za-z'&.]+",str(b))}
def _coname(shelf,x,tb):
    H=SH[shelf]['hero']
    for seg in re.split(r'\s[-–—|:]\s|\||,|\(',tb):
        m=re.match(r"\s*((?:[A-Za-z][\w'\-]*\s+){0,2}[A-Za-z][\w'\-]*)\s*(?:&|\band\b|\+)\s*(?:(?:organic|pure|wild)\s+)?(?:"+H+r")",seg,I)
        if not m: continue
        X=m.group(1); ws=re.findall(r"[A-Za-z][\w'\-]*",X)
        if re.search(H,X,I) or any(ORIGIN.match(w) for w in ws) or any(w.lower() in _brandw(x) for w in ws): continue
        if all(V99._realword(w) for w in ws): continue
        if any(len(w)<3 for w in ws): continue
        mh=re.search(H,tb,I)
        if mh and mh.start()<tb.find(X): continue          # hero already named earlier in the title: X is not the earlier active
        return X
    return None
def _varietal_only(s):
    ws=[w for w in re.findall(r"[A-Za-z][\w'\-]*",s) if not re.fullmatch(r'and|or|organic',w,I)]
    return bool(ws) and all(ORIGIN.match(w) for w in ws)
NIN=re.compile(r'\b\d+\s*-?\s*in\s*-?\s*(?:1|one)\b',I)
# ---------------- D4 / D7 / D8
STD=re.compile(r'\b\d+(?:\.\d+)?\s*:\s*1\b|\b(?!100\s*%)\d+(?:\.\d+)?\s*%|\bextracts?\b',I)
SERV=re.compile(r'serving\s*size\s*[=:\-]?\s*(?:\d[\d./]*\s*(?:g|grams?|tsp|teaspoons?|tbsp|scoops?|mg)\b|\(?\s*\d)|\b\d[\d.]*\s*(?:g|grams?)\s*(?:per|/|a)\s*(?:serving|day)|servings?\s*per\s*container\s*[=:\-]?\s*\d+|\b\d+\s*servings\b',I)
ACID={'citrate':r'citric\s+acid','malate':r'malic\s+acid','gluconate':r'gluconic\s+acid|glucono','lactate':r'lactic\s+acid','ascorbate':r'ascorbic\s+acid',
      'fumarate':r'fumaric\s+acid','succinate':r'succinic\s+acid','aspartate':r'aspartic\s+acid','orotate':r'orotic\s+acid','acetate':r'acetic\s+acid'}
BASE=re.compile(r'\b(carbonated?|bicarbonate|oxide|hydroxide)\b',I)
def _precursor(shelf,x,tb):
    sh=SH[shelf]; F=sh.get('form')
    if not F: return None
    acid=next((a for k,a in ACID.items() if re.fullmatch(F,k,I) or re.search(F,k,I)),None)
    if not acid or not re.search(F,tb,I): return None
    if not (re.search(r'\bpowder|effervescent|drink|fizz',tb,I) or re.search(r'powder',str(x.get('item_form') or ''),I)): return None
    ing=_ing(x)
    if re.search(sh['hero'],ing,I) and BASE.search(ing) and re.search(acid,ing,I): return BASE.search(ing).group(0)
    return None
SUPPCAT=re.compile(r'^\s*(grocery|beauty)',I)
SUPFORM=re.compile(r"\b(capsules?|caps|vcaps|tablets?|softgels?|gumm(?:y|ies)|chewables?|pills?|caplets?|lozenges?|extracts?|tinctures?|drops|dietary\s+supplement|supplements?)\b",I)
JUNKLEAD=re.compile(r'ingredient|supplement\s*facts|serving|dietary|\bmain\b|amount|contains|each',I)
TRACE=re.compile(r'\b(vanadium|vanadyl|molybdenum|boron|silicon|silica|nickel|lithium|strontium|rubidium|inositol|choline)\b[^,;|]*',I)
def _lead10(y):
    lead,rest=V99._lead9(dict(y,ingredients=TRACE.sub(' ',_ing(y))))
    if lead and JUNKLEAD.search(lead): return None,rest
    return lead,rest
def _r10(tb,H): return V99._r10(tb,H)
def _bullet_lead_other(x,H):
    b=_bul(x)
    for m in re.finditer(r'(?:packed with|contains?|featuring|combines?|combination of|blend of|made with|includes?|with)\s+([A-Z][^,.;|]{2,40}?),',b):
        if not re.search(H,m.group(1),I) and re.search(H,b[m.end():m.end()+120],I) and not VITMIN.search(m.group(1)): return m.group(1).strip()
    return None
def classify3(shelf,x):
    """-> (verdict IN/OUT/UNSURE, code, detail, fmt, unsure_reason or None)"""
    sh=SH[shelf]; H=sh['hero']
    ok,code,det,f=V100.classify(shelf,x)
    y,_=V100._tm_inject(shelf,x); y=norm9(y)
    t,tb=_t(y); det=str(det)
    # ----- rules-layer fixes
    if code=='EX_NOT_SUPPLEMENT' and ('Z5' in det or det.startswith('C3')):                        # D7
        sv=SERV.search(_bul(y)+' | '+_ing(y))
        if sv:
            ok2,code2,det2,f2=V100.classify(shelf,dict(x,title=(x.get('title') or '')+' | '+sv.group(0)))
            if ok2: ok,code,det,f=ok2,code2,'D7 dose in copy ('+sv.group(0)+'), not bulk; '+str(det2),f2
    if code=='EX_NOT_SUPPLEMENT' and 'category' in det and STD.search(t):                             # D4
        a=_act(y); items=[z for z in re.split(r'[,;]',re.sub(r'^.*?ingredients?\s*:?','',a,flags=I)) if re.search(r'[A-Za-z]{3,}',z)]
        if items and all(re.search(H,z,I) for z in items):
            ok2,code2,det2,f2=V100.classify(shelf,dict(x,crumbs='Health & Household > Vitamins, Minerals & Supplements > Herbal Supplements'))
            if ok2: ok,code,det,f=ok2,code2,'D4 supplement material (extract/standardised) beats grocery category; '+str(det2),f2
    if code=='HERO_SECONDARY':                                                                        # D5 / D6
        m=re.match(r'.*?"(.+?)" named before hero',det); mh=re.search(H,t,I)
        if m and mh:
            pre=m.group(1)
            rest_pre=NIN.sub(' ',pre)
            if _varietal_only(pre) or (NIN.search(pre) and not re.search(r'\bwith\b|&|\+|,|\d',rest_pre,I)):
                lead,_=_lead10(y)
                ds=V7._panel_doses(y); hd=[d for n,_,d,_ in ds if d and re.search(H,n,I)]
                big=[n for n,_,d,_ in ds if d and VITMIN.search(n) and hd and d>hd[0]]
                if _varietal_only(pre) or (lead and re.search(H,lead,I) and not big):
                    i0=t.lower().find(mh.group(0).lower()); i0=max(i0,0)
                    ok2,code2,det2,f2=V100.classify(shelf,dict(x,title=V99._blank(x.get('title') or '',0,i0) if i0 else x.get('title')))
                    if ok2:
                        tag='D5 origin/varietal adjective is not another active' if _varietal_only(pre) else 'D6 N-in-1 + benefit words; label lead after vitamins = hero'
                        ok,code,det,f=ok2,('HERO_LED_COMPLEX' if NIN.search(pre) else code2),tag+'; '+str(det2),f2
    if not ok and sh.get('form') and code.startswith('EX_FORM'):                                     # D8
        b=_precursor(shelf,y,tb)
        if b: return 'IN','IN_OK',f'D8 R12-1 precursor pair ({b} + acid) sold as {sh["form"]}',f,None
    if ok:
        lx=_laxative(y)
        if lx: return 'OUT','EX_NOT_SUPPLEMENT',f'D2 saline laxative / oral solution ("{lx}")',f,None
        r10=_r10(tb,H)
        X=_coname(shelf,y,tb)
        if X and not r10: return 'OUT','HERO_SECONDARY',f'D3 "{X}" co-named before hero = earlier active (R7-1, v2.1)',f,None
        dl=_dose_lead(shelf,y)
        if dl and not r10:
            r,n=dl
            nw=[w for w in re.findall(r'[A-Za-z]{4,}',n) if not re.fullmatch(r'extract|powder|root|leaf|organic|acid|seed|bark|fruit',w,I)]
            if r>=2 and FORMULA.search(t) and not re.search(r'\b(HDU|CFU|HUT|DU|SKB|FIP|ALU|FCC|units?)\b',t,I) and not any(re.search(r'\b'+re.escape(w),tb,I) for w in nw):
                return 'OUT','HERO_SECONDARY',f'D1 R7-1 "{n[:30]}" out-doses hero {r:.1f}x in a formula-named product',f,None
            return 'UNSURE',code,det,f,f'U2 label doses "{n[:30]}" at {r:.2f}x the hero'
    # ----- UNSURE triggers
    if ok:
        if not _panel(y):
            if FORMULA.search(tb) or re.search(r'\bboost(?:er)?\b',tb,I):
                return 'UNSURE',code,det,f,'U1 no label panel; formula/booster title'
            bo=_bullet_lead_other(y,H)
            if bo: return 'UNSURE',code,det,f,f'U1 no label panel; bullets name "{bo[:30]}" before the hero'
        else:
            lead,rest=_lead10(y)
            if lead and not re.search(H,lead,I) and not (sh.get('cls') and re.search(sh['cls'],lead,I)) and re.search(H,rest,I) \
               and not _hv(H) and not sh.get('form') and not _r10(tb,H) and not V7._panel_doses(y) \
               and any(re.search(r'\b'+re.escape(w[:5]),tb,I) for w in re.findall(r'[A-Za-z]{4,}',lead) if not re.fullmatch(r'extract|powder|root|leaf|organic|acid|seed|bark|fruit|juice|whole',w,I)):
                return 'UNSURE',code,det,f,f'U2 label walk leads with "{lead[:30]}", hero later; no doses'
        cr=y.get('crumbs'); cr=' > '.join(cr) if isinstance(cr,list) else str(cr or '')
        if SUPPCAT.search(cr) and not ORALW.search(t) and not re.search(r'\bextracts?\b|tinctures?|drops\b|powder',t,I):
            return 'UNSURE',code,det,f,'U4 grocery/beauty category, no supplement-form word in title'
        return 'IN',code,det,f,None
    if code=='EX_FORM_BLEND' and det.startswith('B8'):
        return 'UNSURE',code,det,f,'U3 title names the shelf form; label clause led by another form'
    if code=='EX_NOT_SUPPLEMENT' and 'category' in det and SUPFORM.search(t):
        return 'UNSURE',code,det,f,'U4 category-only not-supplement call; title has a supplement-form/extract word'
    if False:                                                       # U5 retired in dev (mostly correct OUTs)
        m=re.match(r'"(.+?)" named before hero',det)
        if m:
            ws=re.findall(r"[A-Za-z][\w'\-]*",m.group(1))
            if len(ws)==1 and not V99._realword(ws[0]) and ws[0].lower() not in _brandw(y):
                return 'UNSURE',code,det,f,f'U5 single non-dictionary word "{ws[0]}" before hero'
    return 'OUT',code,det,f,None
# ---------------- judge
JUDGE_PROMPT=os.path.join(_D,'judge_prompt_v110.txt')
DECISIONS=os.path.join(_D,'GAUTAM_DECISIONS_2026-10-28.md')
JCACHE=os.path.join(_D,'gold_work','judge_cache')
GROK='/home/box/.grok/bin/grok'; EMPTY='/tmp/judge_empty'
JSCHEMA=json.dumps({"type":"object","properties":{"verdict":{"type":"string","enum":["IN","OUT"]},"rule_id":{"type":"string"},"reason":{"type":"string"}},"required":["verdict","rule_id","reason"]})
def spec_text(shelf):
    sh=SH[shelf]
    s=f"Shelf keyword: {shelf}\nHero ingredient (name pattern, regex): {sh['hero']}\n"
    s+=f"Required chemical form: {sh['form']} (other forms: {sh.get('ofo') or 'n/a'})\n" if sh.get('form') else "Required chemical form: none (plain shelf; any form of the hero)\n"
    s+=f"Required product format: {sh['fmt']}\n" if sh.get('fmt') else "Required product format: none (any oral format)\n"
    return s
def listing_text(x):
    b=x.get('bullets'); b=b if isinstance(b,list) else ([b] if b else [])
    s=f"ASIN: {x.get('asin')}\nTITLE: {x.get('title')}\nBrand: {x.get('brand')} | Item Form: {x.get('item_form')} | Primary Supplement Type: {x.get('primary_type')} | Special Ingredients: {x.get('special_ing')}\nCategory: {x.get('crumbs')}\nPrice: {x.get('price')}\n"
    s+='Bullets:\n'+''.join(f'  - {z[:500]}\n' for z in b[:6])
    s+=f"Label / ingredients / info: {(x.get('ingredients') or '(none on the listing)')[:1500]}\n"
    return s
def judge_prompt(shelf,x):
    return open(JUDGE_PROMPT).read().replace('{{SPEC}}',spec_text(shelf)).replace('{{LISTING}}',listing_text(x)).replace('{{DECISIONS}}',open(DECISIONS).read())
def judge(shelf,x,cache_only=False):
    p=judge_prompt(shelf,x); h=hashlib.sha256(p.encode()).hexdigest(); fp=os.path.join(JCACHE,h[:24]+'.json')
    if os.path.exists(fp): return json.load(open(fp))
    if cache_only: return None
    os.makedirs(EMPTY,exist_ok=True); last=''
    for _ in range(3):
        try:
            r=subprocess.run([GROK,'--cwd',EMPTY,'--disable-web-search','--json-schema',JSCHEMA,'-p',p],capture_output=True,text=True,timeout=900,cwd=EMPTY)
            o=json.loads(r.stdout).get('structuredOutput')
            if o and o.get('verdict') in ('IN','OUT'):
                o['prompt_sha']=h; json.dump(o,open(fp,'w')); return o
            last='bad output'
        except Exception as e: last=type(e).__name__
    return dict(verdict=None,rule_id='JUDGE_FAIL',reason=last,prompt_sha=h)
def run_shelf(shelf,recs,k=12,judge_fn=None,unsure_default='rules'):
    """judge_fn(shelf,x)->dict or None. If None/fails: UNSURE falls back to the rules' provisional call (disclosed)."""
    dec={}; inc=[]
    recs=[norm9(x) for x in recs]
    for x in recs:
        v,code,det,f,u=classify3(shelf,x)
        d=dict(verdict3=v,code=code,detail=det,fmt=f,unsure=u)
        if v=='UNSURE':
            j=judge_fn(shelf,x) if judge_fn else None
            d['judge']=j
            if j and j.get('verdict') in ('IN','OUT'): ok=j['verdict']=='IN'
            else: ok=code in INC; d['judge_fallback']=True
            if ok and code not in INC: d['code']='IN_OK'
            if not ok and code in INC: d['code']='JUDGE_OUT'
        else: ok=v=='IN'
        d['include']=ok; dec[x['id']]=d
        if ok: inc.append(dict(x,sold=sold(x),fmt=f))
    kept,dropped=collapse(inc,SH[shelf]['hero'])
    for p,ka,why in dropped: dec[p['id']].update(include=False,code='EX_VARIANT_DUP',detail=f'{why} -> {ka}',dup_of=ka)
    top=sorted(kept,key=lambda p:(-p['sold'],p.get('page') or 9,p.get('pos') or 99))[:k]
    return dict(dec=dec,kept=[p['id'] for p in kept],top=[p['id'] for p in top])
def classify(shelf,x):
    v,code,det,f,u=classify3(shelf,x); return (v=='IN' or (v=='UNSURE' and code in INC)),code,det,f
