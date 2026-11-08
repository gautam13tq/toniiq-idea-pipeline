r"""Competitor-set gate v9.9 (2026-11-01; addendum 14). Follows SHELF_RULEBOOK.md rulebook_v2.1 (v2.0 + Gautam R10-1 + NPD settles).
Imports frozen gate_v98.py (not modified) and wraps classify; collapse unchanged. General rules only (no ASIN/brand lists):
 B0 Normalizer: an elision apostrophe followed by a space ("Pau D' Arco", "Pau D' Arco") is closed up ("D'Arco") in every text field;
    holdout spec hero regexes get an apostrophe-tolerant form (' -> ['’]?\s*) when loaded.
 B1 Y5 misspelling repair only rewrites non-dictionary tokens: a real word (gate_v99_words.txt + supplement vocabulary such as
    prebiotic/postbiotic/synbiotic) is never read as the hero.
 B2 Vitamins A/C/D/E/K/B-group and minerals (and dose-unit remnants such as "DFE") are skipped when finding the label lead for
    the X6 (R6-1 coined name + hero) check: "Eye Vitamins with Bilberry" whose first non-vitamin/mineral active is the hero = IN,
    unless a skipped vitamin/mineral out-doses the hero (R7-1; e.g. vitamin C 180 mg over elderberry 65 mg stays HERO_SECONDARY).
 B3 Co-named before hero is an earlier active, not a source of hero: "<X> & / and / + / , <hero>" undoes the v9.4 W6 rescue when
    X is its own item in the label's active panel ("Lutein & Bilberry"; not a modifier such as "Activated & Stabilized").
 B4 Fiber / inulin / psyllium and Multi / Multivitamin named before the hero are other actives (HERO_SECONDARY), unless the hero is
    itself a fiber or that word.
 B5 Mineral-salt carriers of an organic active ("Magnesium (from Magnesium Caprylate)") count as that organic active (caprylic acid)
    in the label-lead walk.
 B6 R6-1/R7-1 by label order, narrow cases only (not vitamin/mineral or form shelves, not R10-1): (a) "<formula/support> with <hero>"
    in the same title segment and the label walk leads with another active; (b) an undosed proprietary blend containing the hero led
    by another active; (c) a formula-name title "<support> with <hero>, A, B…" with no label panel = HERO_SECONDARY.
 B7 R10-1: an equal-billed N-in-1 whose title lists the hero among its co-equal actives counts even if another active is first on the
    label; a hero that is a lone add-in after "with/plus" stays under R7-1.
 B8 Lead-form guard (R2-Q3) needs a title that names 2+ forms; a title naming only the shelf form over a label clause led by another
    form = EX_FORM_BLEND."""
import re,sys,os,contextlib
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
import gate_v98 as V8
from gate_v98 import *            # noqa: F401,F403
from gate_v98 import SH,norm,ncomma,fmt_of,sold,_blank,_lits,VITMIN,HELPER,MINERALS,collapse,FORMW,_form_set
V7=V8.V7; V6=V7.V6 if hasattr(V7,'V6') else None
I=re.I
_D=os.path.dirname(os.path.abspath(__file__))
DICT={w.strip() for w in open(os.path.join(_D,'gate_v99_words.txt')) if w.strip()}
DICT|={'prebiotic','postbiotic','synbiotic','paraprobiotic','multivitamin','multimineral','superfood','adaptogen','nootropic','gummy','gummies','softgel','softgels'}
ELIS=re.compile(r"\b([DdLlOo])'\s+(?=[A-Za-z])")
def _elide(t): return ELIS.sub(lambda m:m.group(1)+"'",t) if isinstance(t,str) else t
def norm9(x):                                                                      # B0
    y=norm(x)
    for k in ('title','ingredients','special_ing','item_form'):
        if k in y: y[k]=_elide(y[k])
    if isinstance(y.get('bullets'),list): y['bullets']=[_elide(b) for b in y['bullets']]
    return y
def apos(rx): return re.sub(r"(?<!\[)'(?!\])",r"['’]?\\s*",rx)
def add_holdout_specs(path):                                                       # B0 spec template hygiene
    import json
    V7.V2.add_holdout_specs(path)
    for k,v in json.load(open(path)).items():
        if k in SH and "'" in SH[k]['hero']: SH[k]['hero']=apos(SH[k]['hero'])
def _realword(w):
    w=w.lower(); return w in DICT or w.rstrip('s') in DICT or (w.endswith('es') and w[:-2] in DICT)
_orig_fuzzy=V7._fuzzy
def _fuzzy9(shelf,t):                                                              # B1
    t1=_orig_fuzzy(shelf,t)
    if t1==t: return t
    a=re.findall(r"[A-Za-z']+",t); b=[w.lower() for w in re.findall(r"[A-Za-z']+",t1)]
    changed=[w for w in a if w.lower() not in b]
    return t if any(_realword(w) for w in changed) else t1
@contextlib.contextmanager
def _guard():
    V7._fuzzy=_fuzzy9
    try: yield
    finally: V7._fuzzy=_orig_fuzzy
CARRIER=re.compile(r"\b(?:magnesium|calcium|zinc|sodium|potassium)\s+([a-z]{4,})ate\b",I)
SALTFORM=re.compile(r"^(citr|glucon|glycin|bisglycin|mal|threon|tauri?n|orot|aspart|picolin|sulf|sulph|carbon|lact|fumar|succin|ascorb|acet|chel|ethylenediaminetetraacet|phosph|nitr|chlor|iod|selen|polynicotin|monomethion)$",I)
SKIPHDR=re.compile(r"^(ingredients?|active ingredients?|supplement facts|serving size.*|amount per serving.*|proprietary blend|blend|other|daily value.*|organic|certified organic)$",I)
def _lead9(x):
    """label walk: first active that is not vitamin/mineral/helper/excipient; mineral-salt carriers -> organic acid (B5); returns (name, rest-of-panel)."""
    ing=x.get('ingredients') or ''
    m=re.search(r'ingredients?\s*:?(?:\s*active ingredients?\s*:?)?(.*)',ing,I)
    if not m: return None,''
    s=re.split(r'(?i)other ingredients|inactive ingredients|\|\s*directions|\bdirections\b',m.group(1))[0]
    parts=re.split(r'[,;|•:]|\s-\s|\d[\d.,]*\s*(?:mg|mcg|g|iu)\b|\*+',re.sub(r'\[.*?\]',' ',s))
    for i,part in enumerate(parts):
        mc=CARRIER.search(part)
        if mc and not SALTFORM.match(mc.group(1)): return mc.group(1).lower()+'ic acid',' '.join(parts[i:])
        w=' '.join(re.sub(r'[^A-Za-z \-]',' ',re.sub(r'\(.*?\)',' ',part)).split())
        w=re.sub(r'^(?:(?:DFE|RAE|NE|IU|DV|alpha[- ]?TE|as|and)\b\s*)+','',w,flags=I)             # dose-unit / joiner remnants
        if len(w)<3 or V7.V5.V4.EXCIP.search(w) or VITMIN.search(w) or HELPER.search(w) or SKIPHDR.fullmatch(w): continue
        if re.fullmatch(r'(proprietary\s+)?(blend|complex|formula)\s*\w*',w,I): continue
        return w,' '.join(parts[i:])
    return None,''
NIN1=re.compile(r"\b([23]|two|three)\s*-?\s*in\s*-?\s*(1|one)\b|\bpre\W*(?:\s*\+?\s*)pro\W+(?:\s*\+?\s*)post\w*",I)
def _r10(t,H):                                                                     # B7
    if not NIN1.search(t): return False
    if re.search(r'\bpre\W*pro\W*post',t,I) and re.search(r'pro',H,I): return True
    for seg in re.split(r'\s[-–—|]\s|\|',t):
        mh=re.search(H,seg,I)
        if not mh: continue
        if re.search(r'\b(with|plus|added)\b[^,|]*$',seg[:mh.start()],I): continue      # lone add-in after with/plus stays under R7-1
        items=[z for z in re.split(r',|&|\+|\band\b',seg) if z.strip()]
        hi=[k for k,z in enumerate(items) if re.search(H,z,I)]
        if len(items)>=2 and hi and any(re.search(r'[A-Za-z]{3,}',z) for k,z in enumerate(items) if k!=hi[0]): return True
    return False
OTHERACT=re.compile(r"\b(fib(?:er|re)s?|inulin|psyllium|multi\s*-?\s*vitamins?|multi(?=\s*(?:\+|&|and\b|with\b|gumm|vitamin|-\s*vitamin)))\b",I)
FIBERH=re.compile(r'glucomannan|konjac|psyllium|inulin|acacia|guar|pectin|beta[- ]?glucan|methylcellulose|dextrin|fib(?:er|re)',I)
def _cls(shelf,x):
    with _guard(): return V8.classify(shelf,x)
def classify(shelf,x):
    x=norm9(x); sh=SH[shelf]; H=sh['hero']
    ok,code,det,f=_cls(shelf,x)
    t=ncomma(x.get('title') or ''); tb=V7.V5.V4.strip_brand(t,x) or t
    mh=re.search(H,tb,I); hv=bool(VITMIN.search(re.sub(r'\\b|\\w\*','',H)))
    r10=_r10(tb,H)
    if code=='HERO_SECONDARY' and r10 and mh:                                       # B7 R10-1
        ok2,code2,det2,f2=_cls(shelf,dict(x,title=_blank(t,0,t.lower().find(mh.group(0).lower()) if mh.group(0).lower() in t.lower() else 0)))
        if ok2 or code2=='HERO_SECONDARY' and re.match(r'Y6',str(det2)): return True,'HERO_LED_COMPLEX','B7 R10-1 equal-billed N-in-1 names hero as co-equal; '+str(det2),f2
    if code=='HERO_SECONDARY' and re.search(r'X6 R6-1 coined name',str(det)) and not hv and mh:   # B2
        lead,_=_lead9(x)
        ds=V7._panel_doses(x); hd=[d for n,_,d,_ in ds if d and re.search(H,n,I)]
        big=[n for n,_,d,_ in ds if d and VITMIN.search(n) and hd and d>hd[0]]          # R7-1: a higher-dose vitamin/mineral still leads
        if lead and re.search(H,lead,I) and not big and (hd or not ds):
            ok2,code2,det2,f2=_cls(shelf,dict(x,title=_blank(t,0,max(0,t.lower().find(mh.group(0).lower())))))
            if ok2: return ok2,code2,'B2 label lead after vitamins/minerals = hero; '+str(det2),f2
    if ok and re.search(r'= source of hero',str(det)) and mh:                        # B3
        w=re.search(r'(?:^|; )([^;]+?) = source of hero',str(det)).group(1).strip()
        act=re.split(r'(?i)other ingredients|inactive ingredients|\|\s*directions',x.get('ingredients') or '')[0]
        own=any(re.match(r'\W*(?:organic\s+)?'+re.escape(w)+r'\b',it,I) and not re.search(H,it,I) for it in re.split(r'[,;|]|\d[\d.,]*\s*(?:mg|mcg|g|iu)\b',re.sub(r'^.*?ingredients?\s*:?','',act,flags=I)))
        if own and re.search(re.escape(w)+r"\s*(?:&|and|\+|,|/)\s*(?:\w+\s+){0,2}?(?:"+H+")",tb,I):
            return False,'HERO_SECONDARY',f'B3 "{w}" co-named before hero = earlier active, not source of hero',f
    if ok and mh:                                                                  # B4
        mo=OTHERACT.search(tb[:mh.start()])
        fibh=bool(FIBERH.search(' '.join(_lits(H))+' '+re.sub(r'\\b|\\w\*','',H))) or bool(re.search(r'(?:'+H+r')\W+(?:\w+\s+)?fib(?:er|re)',tb,I))
        if mo and not re.search(H,mo.group(0),I) and not r10 and not (fibh and re.match(r'fib',mo.group(0),I)):
            return False,'HERO_SECONDARY',f'B4 "{mo.group(0)}" (other active) named before hero',f
    if ok and sh.get('form'):                                                       # B8
        F=sh['form']; forms={V8._canon(m.group(0)) for m in re.finditer(r'\b(?:'+FORMS+r')\b',tb,I)}
        if len(forms)<=1:
            for cl,seq in _form_set(H,x):
                pos=[k for k,c in enumerate(seq) if re.fullmatch(F,c,I)]
                if len(seq)>=2 and pos and pos[0]>0:
                    return False,'EX_FORM_BLEND',f'B8 title names one form; label clause led by another form: {cl[:60]}',f
    if ok and not hv and not sh.get('form') and not r10 and mh:                       # B6
        pre=re.split(r'\s[-–—|]\s|\|',tb[:mh.start()])[-1]; ing=x.get('ingredients') or ''
        lead,rest=_lead9(x)
        other=lead and not re.search(H,lead,I) and not (sh.get('cls') and re.search(sh['cls'],lead,I)) and re.search(H,rest,I)
        if other and re.search(r'\bwith\b',pre,I) and FORMW.search(pre):
            return False,'HERO_SECONDARY',f'B6 R6-1 formula name + hero; label lead active "{lead[:30]}" is not the hero',f
        act=re.split(r'(?i)other ingredients|inactive ingredients|\|\s*directions',ing)[0]
        pb=re.search(r'proprietary blend\s*:?([^|]*)',act,I)
        if other and pb and re.match(r'\W*ingredients?\s*:?\s*proprietary blend',act,I) and re.search(H,pb.group(1),I) and not re.search(r'\d\s*(mg|mcg)\b',pb.group(1)[:pb.group(1).lower().find(lead.lower()[:6])+60] if lead.lower()[:6] in pb.group(1).lower() else '',I):
            return False,'HERO_SECONDARY',f'B6 R7-1 proprietary blend led by "{lead[:30]}", hero later in blend',f
        if not ing.strip() and re.search(r'\bwith\s*$',pre,I) and FORMW.search(pre) and len([z for z in re.split(r',|&|\band\b|\s(?=[A-Z])',tb[mh.end():]) if re.search(r'[A-Za-z]{3,}',z)])>=3:
            return False,'HERO_SECONDARY','B6 R6-1 formula name + hero, no label panel to show hero leads',f
    return ok,code,det,f
def run_shelf(shelf,recs,k=12):
    dec={}; inc=[]
    recs=[norm9(x) for x in recs]
    for x in recs:
        ok,code,det,f=classify(shelf,x)
        dec[x['id']]=dict(include=ok,code=code,detail=det,fmt=f)
        if ok: inc.append(dict(x,sold=sold(x),fmt=f))
    kept,dropped=collapse(inc,SH[shelf]['hero'])
    for p,ka,why in dropped: dec[p['id']].update(include=False,code='EX_VARIANT_DUP',detail=f'{why} -> {ka}',dup_of=ka)
    top=sorted(kept,key=lambda p:(-p['sold'],p.get('page') or 9,p.get('pos') or 99))[:k]
    return dict(dec=dec,kept=[p['id'] for p in kept],top=[p['id'] for p in top])
