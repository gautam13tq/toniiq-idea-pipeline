"""Competitor-set gate v9.8 (2026-11-01; addendum 13). Follows SHELF_RULEBOOK.md rulebook_v2.0 (v1.9 + Gautam R9-1 + NPD settles).
Imports frozen gate_v97.py (and through it v92-v96; none modified). classify = v9.7 classify plus the rules below; collapse/run_shelf
unchanged apart from calling this classify. General rules only (no ASIN/brand lists):
 A1 Whole foods / groceries: a grocery-food category (pantry staples, canned/dried beans, produce, snacks...) or a food Nutrition-Facts
    panel, with no supplement signal anywhere (no "supplement", capsule/tablet/gummy/drops/extract word, no mg/mcg dose, no supplement
    directions) = EX_NOT_SUPPLEMENT.
 A2 Category does not override supplement directions: when v9.7 excludes only because of the Amazon category (grocery powder,
    beverage/tea), but the title names a supplement form (extract, drops, tincture, capsules...) and the title or label shows supplement use ("dietary supplement", "take 1 serving", drops/dropper, capsules, an mg
    dose, extract drops) the listing is re-tested with a neutral supplement category.
 A3 Form blends inside one clause: on a form shelf whose title does not lead with the shelf form (Gautam R2-Q3: a title that leads
    with the shelf form counts), "<Mineral> (as A, B[, C])" naming two or more compounds where the shelf form is present but not the
    first = EX_FORM_BLEND (rulebook: named form must be the only/lead form; gold: a clause led by the shelf form counts).
    glycinate = bisglycinate; one item such as "glycinate amino acid chelate" is one compound.
 A4 Another mineral leads: on a mineral-hero shelf, when the title names a different mineral before the hero and the label lead is not
    the hero = HERO_SECONDARY (overrides the v9.4 "source of hero" rescue).
 A5 Formula / benefit names before "with <hero>" (formula/support/tonic, or a benefit word + Complex/Blend such as "Brain IQ Complex";
    not N-herb/mushroom blends, powders, coined names, doses, vitamin/mineral/helper words - R3-1/R4-2 still apply) ("Adrenal Support Formula with", "Brain IQ Complex with") are not ingredients:
    R6-1 - the listing counts when the hero leads the label (vitamins, minerals and helpers skipped); re-tested with the name masked.
 A6 Hero synonym words are not another herb: a word "named before hero" that is part of a multi-word hero synonym ("Ginseng" in
    "Siberian Ginseng") or of the brand field is masked and re-tested, when the label lead or the rest of the title is the hero.
 A7 R9-1 homeopathic refinement: a homeopathic-labelled product whose active is a real nutrient at a low X dilution (1X-3X) or with a
    material mg/mcg dose counts (re-tested with the homeopathic words masked). C potencies (6C, 30C, 200CH), K potencies, X above 3X
    and pellets/globules stay out."""
import re,sys,os
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
import gate_v97 as V7
from gate_v97 import *            # noqa: F401,F403
from gate_v97 import SH,norm,ncomma,fmt_of,DOSE2,sold,_blank,_sub,_lits,VITMIN,HELPER,MINERALS,_crumbs,_withpet,collapse
I=re.I
FOODCAT=re.compile(r"^\s*(grocery|amazon fresh|whole foods)[^>]*>\s*(pantry staples|canned|beans|dried beans|produce|fresh|snacks?|breakfast|pasta|soups?|meat|seafood|dairy|frozen|bakery)",I)
NUTFACTS=re.compile(r"nutrition facts|calories\s*\d|total carbohydrate|dietary fiber\s*\d",I)
SUPPANY=re.compile(r"supplement|\b\d+\s*(count|ct)\b|capsules?|\bcaps\b|vcaps|tablets?|softgels?|gumm(y|ies)|lozenges?|tinctures?|\bdrops\b|dropper|extract|\bservings? size\b.*\b(mg|mcg)\b|\b\d[\d.,]*\s*(mg|mcg)\b",I)
SUPPDIR=re.compile(r"dietary supplement|as a supplement|take\s+(\d|one|two|three|1/2)\b[^.|]{0,30}\b(serving|capsule|tablet|drops?|dropper|ml|times)|\bdroppers?(ful)?\b|\b\d+\s*drops\b|\bdrops\b|\bextract\b[^|]{0,40}\b(drops|tincture|capsules?)",I)
TSUPP=re.compile(r"\b(extracts?|drops|tinctures?|capsules?|tablets?|softgels?|liquid extract)\b",I)
FORMS=r"citrate|picolinate|gluconate|bisglycinate|glycinate|oxide|sulfate|sulphate|acetate|orotate|carnosine|aspartate|monomethionine|methionine|ascorbate|malate|threonate|taurate|taurinate|chloride|lactate|carbonate|hydroxide|glycerophosphate|fumarate|succinate|amino acid chelate|chelate|histidinate|nicotinate|selenomethionine|selenite|selenate|polynicotinate|arginate"
FORMW=re.compile(r"\b(formula|support|tonic|system|protocol)\b|\b(iq|brain|focus|memory|cognitive|stress|adrenal|immune|sleep|energy|mood|liver|detox|joint|heart|vein|prostate|thyroid|hormone|women'?s|men'?s)\s+(complex|blend)\b",I)
NHERB=re.compile(r"\b\d+\s*-?\s*(herbs?|mushrooms?|ingredients?|plants?|in\s*-?\s*\d+)\b|\bmushroom|\bpowder\b",I)
def _canon(w):
    w=w.lower()
    if w=='bisglycinate': return 'glycinate'
    if w=='sulphate': return 'sulfate'
    return w
def _form_set(H,x):
    """ordered distinct compounds per "<Mineral> (as A, B)" clause; one compound per item ("glycinate amino acid chelate" = glycinate)."""
    ing=re.split(r'(?i)other ingredients|inactive ingredients|\|\s*directions',x.get('ingredients') or '')[0]
    out=[]
    for m in re.finditer(r"(?:"+H+r")\b[^()|;]{0,12}\(\s*(?:as|from)\s+([^()]*(?:[\(\[][^()\[\]]*[\)\]][^()]*)*)\)",ing,I):
        seq=[]
        for it in re.split(r"[,/;+&]|\band\b",re.sub(r"[\(\[][^()\[\]]*[\)\]]",' ',m.group(1)),flags=I):
            fs=[_canon(f.group(0)) for f in re.finditer(FORMS,it,I)]
            named=[f for f in fs if f not in ('chelate','amino acid chelate')]
            c=(named or fs or [None])[0]
            if c and c not in seq: seq.append(c)
        out.append((m.group(0)[:80],seq))
    return out
def _lead_active(x):
    """first label active that is not a vitamin/mineral/helper/excipient (Y6-style panel walk)."""
    ing=x.get('ingredients') or ''
    m=re.search(r'ingredients?\s*:?(?:\s*active ingredients?\s*:?)?(.*)',ing,I)
    if not m: return None
    s=re.split(r'(?i)other ingredients|inactive ingredients|\|\s*directions|\bdirections\b',m.group(1))[0]
    s=re.sub(r'\(.*?\)|\[.*?\]',' ',s)
    for part in re.split(r'[,;|•]|\s-\s|\d[\d.,]*\s*(?:mg|mcg|g|iu)\b|\*+',s):
        w=' '.join(re.sub(r'[^A-Za-z \-]',' ',part).split())
        if len(w)<3 or V7.V5.V4.EXCIP.search(w) or VITMIN.search(w) or HELPER.search(w): continue
        if re.fullmatch(r'(ingredients?|supplement facts|serving size.*|amount per serving.*|proprietary blend|blend|other|daily value.*)',w,I): continue
        return w
    return None
def _homeo_ok(x):                                                                       # A7 (R9-1)
    t=x.get('title') or ''; ing=x.get('ingredients') or ''; bl=' | '.join(x.get('bullets') or [])
    s=t+' | '+ing+' | '+bl
    if re.search(r"\b\d{1,4}\s?(C|CH|K|LM|M)\b",t+' | '+ing) or re.search(r"\b(pellets?|globules?|granules?|dilution)\b",t+' '+str(x.get('item_form') or ''),I): return False
    xs=[int(m.group(1)) for m in re.finditer(r"\b(\d{1,4})\s?X\b",t+' | '+ing)]
    if xs and max(xs)<=3: return True
    act=re.split(r'(?i)inactive ingredients|other ingredients',ing)[0]
    return bool(re.search(r"\b\d[\d.,]*\s*(mg|mcg)\b",act,I)) and not (xs and max(xs)>3)
def _demask_homeo(x):
    f=lambda s:re.sub(r"\b\d{1,4}\s?X\s+HPUS\b|\bHPUS\b|\bhomeopath\w*",lambda m:' '*len(m.group(0)),s or '',flags=I)
    return dict(x,title=f(x.get('title')),ingredients=f(x.get('ingredients')),bullets=[f(b) for b in (x.get('bullets') or [])])
def _hero_words(H):
    return {w for l in _lits(H) if ' ' in l for w in l.split()}
def _cls(shelf,x): return V7.classify(shelf,x)
def classify(shelf,x):
    x=norm(x); sh=SH[shelf]; H=sh['hero']
    t0=ncomma(x.get('title') or ''); cr=_crumbs(x); bl=' | '.join(x.get('bullets') or []); ing=x.get('ingredients') or ''
    if (FOODCAT.search(cr) or NUTFACTS.search(ing+' '+bl)) and not SUPPANY.search(t0+' | '+bl+' | '+ing) and not re.search(r'dietary supplement|supplement facts',ing+bl,I):   # A1
        return False,'EX_NOT_SUPPLEMENT','A1 whole food / grocery, no supplement signal; category '+cr[:40],fmt_of(t0)
    ok,code,det,f=_cls(shelf,x); notes=[]
    if code=='EX_NOT_SUPPLEMENT' and str(det).startswith('Z3') and _homeo_ok(x):            # A7
        x=_demask_homeo(x); ok,code,det,f=_cls(shelf,x); notes.append('A7 R9-1 low-X / dosed nutrient homeopathic counts')
    if code=='EX_NOT_SUPPLEMENT' and re.search(r'category',str(det)) and not str(det).startswith(('Z4','A1')) and TSUPP.search(t0) and SUPPDIR.search(t0+' | '+ing+' | '+bl):   # A2
        ok2,code2,det2,f2=_cls(shelf,dict(x,crumbs='Health & Household > Vitamins, Minerals & Supplements > Herbal Supplements'))
        if code2!='EX_NOT_SUPPLEMENT': ok,code,det,f=ok2,code2,det2,f2; notes.append('A2 category overridden by supplement directions')
    t=t0
    for _ in range(3):                                                                  # A5 / A6
        m=re.match(r'.*?"(.+?)" named before hero',str(det))
        if code!='HERO_SECONDARY' or not m: break
        wc=m.group(1).strip(' -–—'); mh=re.search(H,t,I)
        if not mh: break
        lead=_lead_active(x); leads=bool(lead and re.search(H,lead,I))
        hw=_hero_words(H); bw=set(re.findall(r'[a-z]+',(x.get('brand') or '').lower()))
        toks=[z for z in re.findall(r'[A-Za-z]+',wc)]
        mw=None
        if toks and all(z.lower() in hw|bw for z in toks) and (leads or len(re.findall(H,t,I))>=1):
            mw=re.search(r'(?<![\w-])'+re.escape(wc)+r'(?![\w-])',t[:mh.start()],I)
            if mw:
                t2=_blank(t,mw.start(),mw.end()); tag=f'A6 "{wc}" = hero synonym / brand word'
        if not mw:
            pre=t[:mh.start()]
            seg=pre[len(x.get('brand') or '') if pre.lower().startswith((x.get('brand') or '#').lower()) else 0:]
            if re.search(r'\bwith\s*$',pre,I) and leads and FORMW.search(seg) and not NHERB.search(seg) and not V7.COINED.search(seg) and not re.search(r'\d\s*(mg|mcg|g|iu)\b',seg,I) and not VITMIN.search(seg) and not HELPER.search(seg):
                t2=_blank(t,0,mh.start()); tag=f'A5 R6-1 formula name "{pre.strip()[-30:]}" + hero; label lead = hero'
            else: break
        ok2,code2,det2,f2=_cls(shelf,dict(x,title=t2))
        if code2==code and det2==det: break
        ok,code,det,f=ok2,code2,det2,f2; t=t2; notes.append(tag)
    if ok and sh.get('form'):                                                           # A3
        F=sh['form']; tt=V7.V5.V4.strip_brand(t0,x); mf=re.search(r'\b(?:'+F+r')\b',tt,I)
        mo=re.search(r'\b(?:'+FORMS+r')\b',tt,I)
        title_leads=bool(mf and mo and mo.start()>=mf.start())                    # Gautam R2-Q3: title leads with the shelf form = IN
        for cl,seq in ([] if title_leads else _form_set(H,x)):
            pos=[k for k,c in enumerate(seq) if re.fullmatch(F,c,I)]
            if len(seq)>=2 and pos and pos[0]>0:
                return False,'EX_FORM_BLEND',f'A3 shelf form is not the lead compound in one clause: {cl[:60]}',f
    if ok and re.sub(r'\\b|\\w\*','',H).lower() in MINERALS.split('|'):                     # A4
        mm=re.search(r'\b('+MINERALS+r')\b',t0,I); mh=re.search(H,t0,I)
        if mm and mh and mm.start()<mh.start() and not re.search(H,mm.group(0),I):
            lead=V7._panel_lead(x)
            if not (lead and re.match(r'\W*(?:'+H+')',lead,I)):
                return False,'HERO_SECONDARY',f'A4 another mineral leads ("{mm.group(0)}" before hero; label lead "{(lead or "?")[:25]}")',f
    if notes and det is not None: det='; '.join(notes)+'; '+str(det)
    elif notes: det='; '.join(notes)
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
