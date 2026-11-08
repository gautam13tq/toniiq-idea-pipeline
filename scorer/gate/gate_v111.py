r"""Competitor-set gate v11.1 HYBRID (2026-11-03; addendum 17). Follows SHELF_RULEBOOK rulebook_v2.4 (v2.3 + Gautam Round 13).
Imports frozen gate_v110.py (not modified; through it v100..v92) and patches only its D1 / D3 hooks at call time.
General rules only (no ASIN, brand or shelf lists).
 NEW RULES (Gautam R12-1, R13-1..R13-6, Round-13 NPD settles):
  E1 R13-3 derivative compound: every title mention of the hero is glued to / hyphenated after a chemical prefix (dihydro-,
     tetrahydro-, hydroxy-, acetyl-, methyl- ...) that the shelf keyword does not carry = OUT (HERO_SECONDARY, its own shelf).
  E2 R13-4 carrier: nutrition-panel fat/calorie rows and carrier oils (MCT, medium-chain triglycerides, olive/coconut/sunflower/
     safflower oil, lecithin) are removed from the label before any lead/dose comparison; softgels already count as pills.
  E3 R13-6 + R13-1: D1 (R7-1 by dose) only bites when another active LEADS the label. Hero first on the label (after
     vitamins/minerals when the hero leads the title) and named alone in the title = keep; a later higher-dose active does not
     knock it out. U2 label-walk ignores a vitamin/mineral lead when the hero leads the title (R13-1).
  E4 R13-2 classical named formula: "<hero> <classical term>" / "<classical term> <hero>" (Guggulu, Churna, Rasayana, Vati,
     Bhasma, Arishta, Avaleha, Tang, Wan, San ...) is not R7-1 even when another ingredient leads the label.
  E5 R13-5: a clean 2-in-1 title "X & <hero>" (one co-named active, then dose/format/end) = equal billing, keep (replaces the D3
     OUT). A co-named LIST ("A, B & <hero>") goes to the judge (UNSURE U2).
  E6 Round-13 exclusions, corroborated: seeds for planting (seeds + planting/heirloom/perennial/garden/germination words),
     room/linen/air/pillow sprays or mists, essential oils sold for aromatherapy/diffuser/topical use, salves/ointments with
     skin/apply copy, juice/beverage shots (shot + juice/fl oz/FZ/beverage/drink/pack) = OUT (P3 codes) when the title has no
     oral-supplement signal. The same words with no corroboration = UNSURE (U6).
 NEW UNSURE TRIGGERS (judge decides; no keyword patches):
  U6 a form / state / not-a-supplement drop (or keep) resting on ONE word: resin, gel, cleanser, starch, seed(s), oil, salve,
     shot, spray.
  U7 fuzzy hero: the hero was read through the Y5 misspelling repair (below an exact match), or the gate dropped for "hero not
     named" while a title word is a near-spelling of the shelf keyword (OSA distance <=2 on >=7 letters, <=1 on 5-6; spaces
     ignored, so "Hornygoatweed" and "Shialjit" are caught).
  U8 bulk no-dose drop (R5-4 Z5/C3) while the copy mentions a scoop, teaspoon/tablespoon, gram-per-serving or capsule serving.
  U9 merge: two kept lines of the same real brand whose titles match once size/count/pack/weight words are removed (and same
     format) go to a merge judge (MERGE / SEPARATE, owner rules R3-5, R6-2 ... apply).
 JUDGE: judge_prompt_v111.txt (listing) and judge_merge_prompt_v111.txt (pair); full GAUTAM_DECISIONS text; cache by prompt sha."""
import re,sys,os,json,hashlib,subprocess
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
import gate_v110 as G0
from gate_v110 import SH,INC,VITMIN,ORALW,norm9,sold,collapse,add_holdout_specs,spec_text,listing_text   # noqa
V100=G0.V100; V99=G0.V99; V7=G0.V7
I=re.I; _D=os.path.dirname(os.path.abspath(__file__))
P3X={'EX_PET','EX_INFANT','EX_KIDS','EX_NOT_SUPPLEMENT','EX_TOPICAL'}
ORAL=re.compile(ORALW.pattern+r'|\b\d+(?:\.\d+)?\s*(?:mg|mcg)\b|\bservings?\b',I)
# ---------------- E2 carrier rows
NUTRI=re.compile(r'(?:calories|total\s+fat|saturated\s+fat|trans\s+fat|cholesterol|total\s+carbohydrates?|total\s+sugars?|added\s+sugars?|dietary\s+fiber|protein)\s*(?:from\s+fat\s*)?\d+(?:\.\d+)?\s*(?:g|mg|kcal)?\s*(?:<?\s*\d+\s*%\s*\**)?',I)
CARRIER=re.compile(r'\b(?:mct(?:\s+oil)?|medium[\s-]chain\s+triglycerides?|capr(?:ic|ylic)\s+acid|(?:extra\s+virgin\s+)?(?:olive|coconut|sunflower|safflower|soybean|rice\s+bran)\s+oil|(?:sunflower\s+|soy\s+)?lecithin)\b(?:\s*\([^)]{0,40}\))*\s*\d+(?:\.\d+)?\s*(?:mg|g)\b',I)
def _strip_carrier(x):
    s=x.get('ingredients')
    if not isinstance(s,str) or not s.strip(): return x
    a=re.split(r'(?i)(other ingredients|inactive ingredients)',s,maxsplit=1)
    a[0]=CARRIER.sub(' ',NUTRI.sub(' ',a[0])); return dict(x,ingredients=''.join(a))
# ---------------- E3 / E4 helpers
CLASSICAL=r'(?:guggul[ua]?|churna|choornam|rasayana|vati|bhasma|arishta|asava|avaleha|ghrita|kashayam|kwath|tang|wan|san|pian)'
def _classical(tb,H): return bool(re.search(r'(?:'+H+r')\s+'+CLASSICAL+r'\b|\b'+CLASSICAL+r'\s+(?:'+H+r')',tb,I))
def _hero_leads_title(tb,H):
    mh=re.search(H,tb,I)
    if not mh: return False
    mv=VITMIN.search(tb); return not mv or mh.start()<mv.start()
def _label_lead_is_hero(y,H,tb):
    lead,_=G0._lead10(y)
    if not lead: return None
    if re.search(H,lead,I): return True
    if VITMIN.search(lead) and not re.search(r'[A-Za-z]{4,}',VITMIN.sub(' ',lead).replace('extract','')) and _hero_leads_title(tb,H): return True   # R13-1
    return False
_orig_dose_lead=G0._dose_lead
def _dose_lead_v111(shelf,x):
    dl=_orig_dose_lead(shelf,x)
    if not dl: return None
    H=SH[shelf]['hero']; t,tb=G0._t(x)
    if _classical(tb,H): return None                                           # E4 R13-2
    r,n=dl
    lh=_label_lead_is_hero(x,H,tb)
    if lh and not re.search(r'\b'+re.escape((re.findall(r'[A-Za-z]{4,}',n) or ['@@'])[0][:5]),tb,I): return None   # E3 R13-6
    return dl
_orig_coname=G0._coname
_LAST_CONAME={}
def _coname_v111(shelf,x,tb):
    X=_orig_coname(shelf,x,tb)
    _LAST_CONAME['X']=X; _LAST_CONAME['clean']=None
    if not X: return None
    H=SH[shelf]['hero']
    i=tb.find(X); before=tb[:i]
    m=re.search(re.escape(X)+r"\s*(?:&|\band\b|\+)\s*(?:(?:organic|pure|wild)\s+)?(?:"+H+r")\w*(.*)$",tb,I)
    after=m.group(1) if m else ''
    listy=bool(re.search(r',\s*$',before)) or bool(re.match(r'\s*(?:,|&|\band\b|\+)\s*[A-Z][a-z]{3,}',after))
    _LAST_CONAME['clean']=not listy
    return None                                                                 # E5: never a sure OUT any more
# ---------------- E1 derivative
DERIV=r'(?:dihydro|tetrahydro|hexahydro|dehydro|hydroxy|deoxy|desmethyl|acetyl|methyl|ethyl|nor|homo|iso)'
def _derivative(shelf,tb):
    H=SH[shelf]['hero']
    if SH[shelf].get('form') or re.search(DERIV,shelf,I): return None
    ms=list(re.finditer(H,tb,I))
    if not ms: return None
    hits=[]
    for m in ms:
        pre=tb[max(0,m.start()-14):m.start()]
        mm=re.search(DERIV+r'-?$',pre,I)
        if not mm: return None
        hits.append(mm.group(0)+m.group(0))
    return hits[0]
# ---------------- E6 / U6 words
def _crumbs(y):
    c=y.get('crumbs'); return ' > '.join(c) if isinstance(c,list) else str(c or '')
def _copy(y): return G0._bul(y)+' | '+str(y.get('description') or '')
SEEDP=re.compile(r'\bseeds?\b',I); SEEDC=re.compile(r'planting|\bplant\b|heirloom|perennial|\bannual\b|garden|germinat|\bsow\b|wildflower|flower\s+seeds?|lawn',I)
SPRAYP=re.compile(r'\b(?:room|linen|air|pillow|fabric|home)\s+(?:(?:and|&)\s+\w+\s+)?(?:spray|mist)s?\b',I)
EOILP=re.compile(r'\bessential\s+oils?\b',I); EOILC=re.compile(r'aromatherap|diffuser|topical|massage|\bskin\b|\bdilut|carrier\s+oil|for\s+hair',I)
SALVEP=re.compile(r'\b(?:salves?|ointments?)\b',I); SALVEC=re.compile(r'\bskin\b|topical|apply|\brub\b|massage|\blips?\b|wounds?|cuts|scrapes|external',I)
SHOTP=re.compile(r'\bshots?\b',I); SHOTC=re.compile(r'juice|\bfl\.?\s*oz\b|\bfz\b|beverage|\bdrinks?\b|\d+\s*-?\s*(?:pk|pack)\b|bottles?|grocery|beverages',I)
WORD1=re.compile(r'\b(resins?|gels?|cleansers?|starch|seeds?|oils?|salves?|shots?|sprays?)\b',I)
def _excl(y,t):
    if ORAL.search(t): return None
    cr=_crumbs(y); cp=_copy(y)
    if SPRAYP.search(t): return 'EX_NOT_SUPPLEMENT',f'E6 room/linen spray ("{SPRAYP.search(t).group(0)}")'
    if SEEDP.search(t) and (SEEDC.search(t) or SEEDC.search(cr)): return 'EX_NOT_SUPPLEMENT','E6 seeds for planting'
    if EOILP.search(t) and (EOILC.search(t+' '+cp) or re.search(r'aromatherap|essential\s+oils|beauty',cr,I)): return 'EX_TOPICAL','E6 essential oil (aromatherapy/topical)'
    if SALVEP.search(t) and (SALVEC.search(t+' '+cp) or re.search(r'beauty|skin|first\s+aid',cr,I)): return 'EX_TOPICAL','E6 salve/ointment (topical)'
    if SHOTP.search(t) and (SHOTC.search(t) or re.search(r'grocery|beverage',cr,I)): return 'EX_NOT_SUPPLEMENT','E6 juice/beverage shot'
    return None
def _word_only(y,t):
    """U6 on a keep: a non-supplement word in the title, uncorroborated, no oral-supplement signal."""
    if ORAL.search(t): return None
    for P in (EOILP,SALVEP,SHOTP,SPRAYP):            # seeds alone (black seed, chia) and plain oral sprays are not flagged on a keep
        m=P.search(t)
        if m: return m.group(0)
    return None
# ---------------- U7 fuzzy
def _osa(a,b):
    d=[[0]*(len(b)+1) for _ in range(len(a)+1)]
    for i in range(len(a)+1): d[i][0]=i
    for j in range(len(b)+1): d[0][j]=j
    for i in range(1,len(a)+1):
        for j in range(1,len(b)+1):
            c=a[i-1]!=b[j-1]; d[i][j]=min(d[i-1][j]+1,d[i][j-1]+1,d[i-1][j-1]+c)
            if i>1 and j>1 and a[i-1]==b[j-2] and a[i-2]==b[j-1]: d[i][j]=min(d[i][j],d[i-2][j-2]+1)
    return d[-1][-1]
FMTW=r'capsules?|gumm(?:y|ies)|tablets?|softgels?|powder|liquid|drops|tea|chewables?|pills?'
def _fuzzy_hero(shelf,t):
    sh=SH[shelf]; k=re.sub(r'\b(?:'+FMTW+r')\b','',shelf,flags=I).strip().lower()
    if sh.get('form'): k=re.sub(sh['form'],'',k,flags=I).strip()
    if not k: return None
    kc=re.sub(r'[^a-z]','',k)
    if len(kc)<5: return None
    toks=[w.lower() for w in re.findall(r'[A-Za-z]+',t)]
    nw=len(re.findall(r'[a-z]+',k))
    cands={''.join(toks[i:i+n]) for n in range(1,nw+1) for i in range(len(toks)-n+1)}
    lim=2 if len(kc)>=7 else 1
    for c in cands:
        if abs(len(c)-len(kc))>lim: continue
        if c==kc and nw>1: return c                                   # closed compound ("Hornygoatweed")
        if c!=kc and ' ' not in c and V99._realword(c): continue      # a real word ("banana", "prebiotic") is not a misspelling
        if c!=kc and _osa(c,kc)<=lim: return c
    return None
# ---------------- U8 serving mention
SERVM=re.compile(r'\bscoops?\b|\bteaspoons?\b|\btsp\b|\btablespoons?\b|\btbsp\b|\b\d+(?:\.\d+)?\s*(?:g|grams?)\s*(?:per|a|each|/|daily|of\s+powder)\b|\bserving\s+(?:size\s*)?(?:of\s*)?[:=]?\s*\d+(?:\.\d+)?\s*(?:g|grams?)\b|\b\d+\s*(?:capsules?|caps)\s*(?:per|a|daily|twice|once|with)\b',I)
# ---------------- classify3
def classify3(shelf,x):
    sh=SH[shelf]; H=sh['hero']
    x=_strip_carrier(x)                                                         # E2
    _LAST_CONAME.clear()
    G0._dose_lead=_dose_lead_v111; G0._coname=_coname_v111
    try:
        v,code,det,f,u=G0.classify3(shelf,x)
    finally:
        G0._dose_lead=_orig_dose_lead; G0._coname=_orig_coname
    y,_=V100._tm_inject(shelf,x); y=norm9(y); t,tb=G0._t(y)
    # E5 (R13-5) bookkeeping: v110 would have returned D3 OUT; now clean 2-in-1 keeps, a co-named list goes to the judge
    X=_LAST_CONAME.get('X')
    if v!='OUT' and X and _LAST_CONAME.get('clean') is False and not G0._r10(tb,H):
        return 'UNSURE',code,det,f,f'U2 co-named list before hero ("{X[:30]}"); R13-5 covers only a clean 2-in-1'
    if v!='OUT' and X and _LAST_CONAME.get('clean'):
        if v=='UNSURE' and not (u or '').startswith('U2 label walk'): pass
        else: v,u,det=('IN',None,f'E5 R13-5 2-in-1 "{X} & hero" = equal billing; '+str(det))
    # E1 derivative
    if v!='OUT' or code in INC:
        dv=_derivative(shelf,tb)
        if dv: return 'OUT','HERO_SECONDARY',f'E1 R13-3 derivative compound "{dv}" is its own shelf',f,None
    # E6 corroborated exclusions / U6 word-only on keeps
    if v!='OUT':
        ex=_excl(y,t)
        if ex: return 'OUT',ex[0],ex[1],f,None
        w=_word_only(y,t)
        if w and v=='IN': return 'UNSURE',code,det,f,f'U6 keep with a non-supplement word "{w}" and no oral-supplement signal'
    # E3/E4 on the U2 label walk (R13-1 vitamin lead, R13-2 classical formula)
    if v=='UNSURE' and u and u.startswith('U2 label walk'):
        lead,_=G0._lead10(y)
        if _classical(tb,H) or (lead and VITMIN.search(lead) and _hero_leads_title(tb,H)):
            v,u='IN',None; det='E3/E4 R13-1/R13-2 lead is vitamins/minerals or a classical formula; '+str(det)
    # U7 fuzzy keep
    if v=='IN' and 'Y5' in str(det): return 'UNSURE',code,det,f,'U7 hero read through misspelling repair (not an exact match)'
    if v=='OUT':
        d=str(det)
        if code in ('EX_HERO_UNNAMED','EX_HERO_MISSING','HERO_SECONDARY') and not re.search(H,t,I):
            fz=_fuzzy_hero(shelf,t)
            if fz: return 'UNSURE',code,det,f,f'U7 near-spelling "{fz}" of the shelf hero'
        if code=='EX_NOT_SUPPLEMENT' and ('Z5' in d or d.startswith('C3') or 'R5-4' in d):
            sm=SERVM.search(_copy(y)+' | '+G0._ing(y))
            if sm: return 'UNSURE',code,det,f,f'U8 bulk no-dose drop but copy mentions a serving ("{sm.group(0)[:25]}")'
        if code in P3X|{'EX_FORMAT_MISMATCH','EX_FORMAT_UNSTATED','EX_FORM_MISMATCH','EX_FORM_UNSTATED'}:
            m=WORD1.search(d)
            corr=_excl(y,t) is not None or re.search(r'seeds\s+for\s+planting|essential\s+oil',d,I)
            if m and len(re.findall(r'[A-Za-z]+',d.replace('other:','')))<=3 and not corr and re.search(H,t,I):
                return 'UNSURE',code,det,f,f'U6 drop rests on one word ("{m.group(0)}")'
    return v,code,det,f,u
def classify(shelf,x):
    v,code,det,f,u=classify3(shelf,x); return (v=='IN' or (v=='UNSURE' and code in INC)),code,det,f
# ---------------- judge
JUDGE_PROMPT=os.path.join(_D,'judge_prompt_v111.txt'); MERGE_PROMPT=os.path.join(_D,'judge_merge_prompt_v111.txt')
DECISIONS=os.path.join(_D,'GAUTAM_DECISIONS_2026-10-28.md')
JCACHE=G0.JCACHE; GROK=G0.GROK; EMPTY=G0.EMPTY; JSCHEMA=G0.JSCHEMA
MSCHEMA=json.dumps({"type":"object","properties":{"verdict":{"type":"string","enum":["MERGE","SEPARATE"]},"rule_id":{"type":"string"},"reason":{"type":"string"}},"required":["verdict","rule_id","reason"]})
def judge_prompt(shelf,x):
    return open(JUDGE_PROMPT).read().replace('{{SPEC}}',spec_text(shelf)).replace('{{LISTING}}',listing_text(x)).replace('{{DECISIONS}}',open(DECISIONS).read())
def merge_prompt(shelf,a,b):
    return open(MERGE_PROMPT).read().replace('{{SPEC}}',spec_text(shelf)).replace('{{LISTING_A}}',listing_text(a)).replace('{{LISTING_B}}',listing_text(b)).replace('{{DECISIONS}}',open(DECISIONS).read())
def _ask(p,schema,ok,cache_only=False):
    h=hashlib.sha256(p.encode()).hexdigest(); fp=os.path.join(JCACHE,h[:24]+'.json')
    if os.path.exists(fp): return json.load(open(fp))
    if cache_only: return dict(verdict=None,rule_id='NOT_CACHED',reason='cache miss',prompt_sha=h)
    os.makedirs(EMPTY,exist_ok=True); last=''
    for _ in range(3):
        try:
            r=subprocess.run([GROK,'--cwd',EMPTY,'--disable-web-search','--json-schema',schema,'-p',p],capture_output=True,text=True,timeout=900,cwd=EMPTY)
            o=json.loads(r.stdout).get('structuredOutput')
            if o and o.get('verdict') in ok:
                o['prompt_sha']=h; json.dump(o,open(fp,'w')); return o
            last='bad output'
        except Exception as e: last=type(e).__name__
    return dict(verdict=None,rule_id='JUDGE_FAIL',reason=last,prompt_sha=h)
def judge(shelf,x,cache_only=False): return _ask(judge_prompt(shelf,x),JSCHEMA,('IN','OUT'),cache_only)
def judge_merge(shelf,a,b,cache_only=False): return _ask(merge_prompt(shelf,a,b),MSCHEMA,('MERGE','SEPARATE'),cache_only)
# ---------------- U9 merge candidates
SIZEW=re.compile(r'\b\d[\d,.]*\s*(?:-|\s)?(?:count|ct|capsules?|caps|vcaps|veg\s*caps|tablets?|tabs|softgels?|gumm(?:y|ies)|servings?|days?|lbs?|pounds?|oz|ounces?|fl\.?\s*oz|g|grams?|kg|ml|pack|pk|bags?|bottles?|jars?)\b|\b(?:pack|bag|bottle|jar|pouch)\s+of\s+\d+\b|\b(?:\d+\s*-?\s*)?(?:pack|pk|bag|bottle|jar|pouch|count)\b|\bx\s*\d+\b|\b\d+\s*x\b|\(\s*\)',I)
def _name(p):
    t=G0.ncomma(p.get('title') or ''); t=SIZEW.sub(' ',t); return set(re.findall(r'[a-z]{3,}',t.lower()))
DOSE=re.compile(r'(\d[\d,.]*)\s*(mg|mcg|µg|iu|billion|b\s*cfu|g)\b',I)
def _doses(t): return {(n.replace(',',''),u.lower()[:1]) for n,u in DOSE.findall(t)}
def merge_candidates(kept):
    out=[]
    for i,a in enumerate(kept):
        for b in kept[i+1:]:
            ba,bb=G0.bkey((a.get('brand') or '').lower()),G0.bkey((b.get('brand') or '').lower())
            if not ba or ba!=bb or ba in G0.GENERIC_BRAND: continue
            if G0.fmt_of(a['title'])!=G0.fmt_of(b['title']): continue
            na,nb=_name(a),_name(b)
            if not na or not nb: continue
            da,db=_doses(a['title']),_doses(b['title'])
            if da and db and da!=db: continue          # a different dose per serving is a different line (R3-5), not only a size change
            if na==nb or (len(na&nb)/len(na|nb)>=0.8): out.append((a,b))
    return out
def run_shelf(shelf,recs,k=12,judge_fn=None,merge_fn=None):
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
    merges=[]
    for a,b in merge_candidates(kept):
        if not any(z['id']==a['id'] for z in kept) or not any(z['id']==b['id'] for z in kept): continue
        j=merge_fn(shelf,a,b) if merge_fn else None
        merges.append(dict(a=a['id'],b=b['id'],judge=j))
        if j and j.get('verdict')=='MERGE':
            keep,drop=sorted([a,b],key=lambda p:(-(p.get('reviews') or 0),p.get('page') or 9,p.get('pos') or 99))
            kept=[z for z in kept if z['id']!=drop['id']]
            dec[drop['id']].update(include=False,code='EX_VARIANT_DUP',detail=f'U9 merge judge: same line -> {keep["asin"]}',dup_of=keep['asin'],merge_judge=j)
    top=sorted(kept,key=lambda p:(-p['sold'],p.get('page') or 9,p.get('pos') or 99))[:k]
    return dict(dec=dec,kept=[p['id'] for p in kept],top=[p['id'] for p in top],merges=merges)
