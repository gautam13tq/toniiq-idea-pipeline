"""Competitor-set gate v9.1 (2026-10-29; addendum 6). Follows SHELF_RULEBOOK.md rulebook_v1.3 (v1.2 + Gautam Round 3 R3-1..R3-5).
gate_v9.py and gate.py (v8.1) are frozen and not modified; v9.1 imports their lexicons/specs and replaces classify/collapse.
Root-cause rules added over v9 (general rules, no ASIN/brand lists):
 R1 N-in-1 / "Complex" is a count word, not a lead ingredient, when only modifier words sit between it and the hero (R3-1).
    Named blends ("Mushroom Complex", "6-Herb Blend", "N-in-1 Lymphatic Drops") still lead.
 R2 MODIFIER lexicon (delivery tech, origin, claim/class words) is masked before the G1 lead test (R3-2).
 R3 G2: "<form> Complex" counts (R3-1); "<mineral> complex/blend" blocks only when printed BEFORE the named form; "N forms",
    "complex of", triple/multi-<mineral> still block. Triple / N-in-1 / delivery words are not "other forms".
 R4 Delivery-named shelves (spec field deliv): the delivery tech must be in the title or brand, else EX_FORM_MISMATCH (R3-2).
 R5 No PDP rescue: a missing named form, hero or delivery tech is not rescued by bullets/ingredients/PDP fields.
 R6 Single-word exclusion guards: negated mentions ("No Rice Fillers"); rice only as culinary rice (konjac/shirataki/... rice);
    culinary gums only without a supplement word; topical word after an oral format word = bonus item; pet category crumb ignored
    when the title has a human cue; infant words ignored in prenatal/pregnancy/postpartum context; tea/coffee/gel format only
    from the title or Item Form (not bullets); "<hero> precursor" is not the hero.
 R7 G5 collapse: thousands commas normalised; dose units + FU/HDU/SPU; a hero-dose conflict blocks every merge except same ASIN
    (R3-5, checked against every member already in the line); same-brand name-segment match and brand-stripped title match.
Order unchanged: pet -> infant/kids -> topical -> not-supplement -> G-NAME -> co-term -> G1 -> G2 (+delivery) -> G3; collapse; rank."""
import re,sys,os
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
import gate_v9 as V9
from gate import LEXR,PET,INFANT,TOPICAL,NONSUP,USAGE,fmt_of,S,FLAV,STOP,jac,bkey
from gate_v9 import ALIAS,dehy,has,KIDS,ADULT,INFANT2,BOT,COCOA,SUPP_HINT,GENERIC_BRAND,pdp_text,mask,strip_brand,fmt_pdp,PACK,tokset,ebrands,sold
I=re.I
# ---------- shelf specs
SH={k:dict(v) for k,v in V9.SH.items()}
for v in SH.values(): v.setdefault('deliv',None)
MAGF=(r'citrate|oxide|malate|threonate|taurate|taurinate|chloride|sulfate|orotate|lactate|aspartate|carbonate|hydroxide|gluconate|'
      r'picolinate|glycerophosphate|bisglycinate|glycinate|full spectrum')
def other_forms(form_rx):
    return '|'.join(a for a in MAGF.split('|') if not re.fullmatch(form_rx,a.replace('\\b','')))
SH['magnesium glycinate']=dict(S('magnesium glycinate',r'magnes\w*',form=r'glycinate|bisglycinate',ofo=other_forms(r'glycinate|bisglycinate')),deliv=None)
if 'magnesium glycinate gummies' in SH and SH['magnesium glycinate gummies'].get('ofo'): SH['magnesium glycinate gummies']['ofo']=other_forms(r'glycinate|bisglycinate')
SH['magnesium l-threonate']=dict(S('magnesium l-threonate',r'magnes\w*|magtein',form=r'threonate|magtein',ofo=other_forms('threonate')),deliv=None)
ZNF=r'gluconate|citrate|bisglycinate|glycinate|oxide|sulfate|acetate|orotate|carnosine|monomethionine|aspartate'
SH['zinc picolinate']=dict(S('zinc picolinate',r'\bzinc\b',form=r'picolinate',ofo=ZNF),deliv=None)
SH['quercetin phytosome']=dict(S('quercetin phytosome',r'quercetin|quercefit',form=r'phytosome|quercefit',ofo=r'dihydrate|anhydrous'),deliv=r'phytosom\w*|quercefit')
DELIV=r'liposom\w*|lipo[- ]?c\b|chelated?|phytosom\w*|micell\w*|nano\w*|enteric(?:[- ]coated)?|buffered|fermented|sustained[- ]release|time[- ]release|extended[- ]release|delayed[- ]release|slow[- ]release|sucrosomial|bioactive|bio-?available|absorbable'
def spec(kw,hero,deliv,form=None,ofo=None,fmt=None,req=None,cls=None,allow=()):
    d=S(kw,hero,form=form,ofo=ofo,fmt=fmt,req=req,cls=cls,allow=allow); d['deliv']=deliv; return d
# holdout shelves for addendum 6 are appended by add_holdout_specs() from holdout_v91/shelf_specs.json (written from keywords only)
def add_holdout_specs(path):
    import json
    for k,v in json.load(open(path)).items():
        SH[k]=spec(k,v['hero'],v.get('deliv'),form=v.get('form'),ofo=v.get('ofo'),fmt=v.get('fmt'),req=v.get('req'),cls=v.get('cls'),allow=v.get('allow',()))
# ---------- lexicons
ORIGIN=r'ethiopian|egyptian|indian|japanese|korean|chinese|tibetan|himalayan|irish|atlantic|pacific|alaskan|norwegian|icelandic|peruvian|brazilian|mexican|canadian|american|european|french|italian|spanish|greek|turkish|nordic|wild[- ]?crafted|wild|organic|cold[- ]?pressed'
CLAIM=r'triple|double|dual|ultra|super|mega|max(imum)?|extra|strength|potency|advanced|premium|pure|natural|plant[- ]based|vegan|clinical(ly)?|senolytic|longevity|fiber|ferritin|enzymes?|nootropic|adaptogen(ic)?|antioxidant|mineral|whole[- ]food|full[- ]spectrum|high[- ]absorption|bioactive|active|standardi[sz]ed|concentrated?|patented|branded|complex|formula|blend'
MODW=re.compile(r'\b('+DELIV+'|'+ORIGIN+'|'+CLAIM+r')\b',I)
NUMW=re.compile(r'^(\d[\d.,:%x]*(mg|mcg|iu|fu|hdu|spu|cfu|g|billion|bn)?|\d+-?in-?(1|one)|mg|mcg|iu|fu|hdu|spu|cfu|billion|bn|in|one|per|serving|servings|and|with|&|\+|plus|-|of|the|a|by|new|improved)$',I)
NAMED_BLEND=re.compile(r"\b(\d+|multi|six|five|four|three|seven|eight|ten)[- ]?(herbs?|mushrooms?|ingredients?|botanicals?)\b|\b(herbal|proprietary|mushroom|superfood|botanical|greens|fruit|vegetable|adaptogen|nootropic) (blend|complex|formula)\b",I)
COUNTW=re.compile(r"\b(\d+|multi|six|five|four|three|seven|eight|ten|twelve)[- ]?in[- ]?(1|one)\b|\b(complex|blend|formula)\b",I)
NEG=re.compile(r"\b(no|non|free of|free from|without|zero|0)\b[\w\s,&/-]{0,25}$",I)
CULINARY=re.compile(r"\b(thicken(er|ing)( agent)?|xanthan|flour|noodles?|shirataki|pasta|(konjac|shirataki|miracle|keto|cauliflower) rice|keto baking|gelling agent|jelly powder)\b",I)
CGUM=re.compile(r"\b(konjac|xanthan|guar|acacia|locust bean|gellan) gum\b|\bgum powder\b",I)
ORAL=re.compile(r"\b(capsules?|caps|tablets?|softgels?|gumm(y|ies)|veg ?caps|vcaps|pills?|caplets?|lozenges?|chewables?)\b",I)
HUMAN=re.compile(r"\b(men|women|man|woman|adults?|human|people|vegan|vegetarian|veg ?caps|kids?|children|teens?|prenatal)\b",I)
MATERNAL=re.compile(r"\b(prenatal|pregnan\w*|breast ?feeding|postpartum|post-partum|lactation|nursing|moms?|mothers?|maternal|expecting)\b",I)
PRECURSOR=r'\s*(a\s+)?(precursor|booster|activator|support complex)\b'
NOT_ACTIVE=set(V9.NOT_ACTIVE)|set('''liposomal liposome chelated phytosome micellar nano enteric buffered fermented senolytic fiber ferritin enzyme enzymes
nootropic adaptogen antioxidant mineral triple ethiopian egyptian japanese irish himalayan bioactive absorbable complex blend'''.split())
DOSE2=re.compile(r'(\d+(?:\.\d+)?)\s*(mg|mcg|µg|billion|bn|cfu|iu|fu|hdu|spu)\b',I)
def ncomma(t): return re.sub(r'(?<=\d),(?=\d{3}\b)','',t or '')
def ing_names(x,sh):
    src=(x.get('ingredients') or '')+' , '+(x.get('special_ing') or '')
    src=re.sub(r'(?i)(other ingredients|inactive ingredients).*','',src)
    src=re.sub(r'\(.*?\)|\[.*?\]',' ',src)
    out=set()
    for part in re.split(r'[,;|:•\n]| and ',src):
        w=re.sub(r'[^A-Za-z \-]',' ',part).strip().lower()
        w=re.sub(r'\b(extract|powder|standardized|organic|from|to|contain(s|ing)?|ingredients?|supplement facts|serving size|mg|mcg|of|the)\b',' ',w)
        w=' '.join(w.split())
        if len(w)<5 or len(w.split())>3: continue
        if re.search(sh['hero'],w,I) or (sh['cls'] and re.search(sh['cls'],w,I)): continue
        if all(t in NOT_ACTIVE for t in w.split()) or MODW.fullmatch(w): continue
        if re.search(r'cellulose|gelatin|stearate|silica|water|glycerin|pectin|sugar|syrup|citric|flavou?r|color|starch|capsule|rice|hypromellose|dicalcium|maltodextrin|sorbitol|stevia|monk fruit|sweet|oil$|acid$|lecithin|wax|coating|sodium|tapioca|xylitol|erythritol|allulose|gum',w,I): continue
        out.add(w)
    return out
def only_modifiers(s):
    s=MODW.sub(' ',s); s=re.sub(r'[^\w%+&.,:-]+',' ',s)
    return all(NUMW.match(w) for w in s.split())
def classify(shelf,x):
    """returns (include, code, detail, fmt)"""
    sh=SH[shelf]; t=ncomma(x.get('title') or ''); br=x.get('brand') or ''
    fb=fmt_of(' '.join((x.get('bullets') or [])[:2]))
    if fb in ('tea','coffee','gel'): fb=None          # R6: drink/gel format only from title or Item Form
    f=fmt_of(t) or fb or fmt_pdp(x)
    crumbs=' > '.join(x.get('crumbs') or []) if isinstance(x.get('crumbs'),list) else (x.get('crumbs') or '')
    tb=strip_brand(t,x)
    if PET.search(t): return False,'EX_PET',PET.search(t).group(0)[:40],f
    if crumbs.lower().startswith('pet supplies') and not HUMAN.search(t): return False,'EX_PET',crumbs[:40],f
    mi=INFANT2.search(t)
    if mi and not MATERNAL.search(t): return False,'EX_INFANT',mi.group(0),f
    if KIDS.search(t) and not ADULT.search(t) and not MATERNAL.search(t): return False,'EX_KIDS',KIDS.search(t).group(0),f
    hs=[m.span() for m in re.finditer(sh['hero'],t,I)]
    for m in TOPICAL.finditer(tb):
        if any(a<=m.start()<b for a,b in hs): continue
        w=m.group(0).lower()
        if w=='balm' and re.search(r'lemon\s+$',t[:m.start()],I): continue
        if w.replace(' ','')=='skincare' and SUPP_HINT.search(t): continue
        if ORAL.search(tb[:m.start()]): continue      # R6: "60 Capsules with Bonus Leg Cream" = add-on
        if NEG.search(tb[:m.start()]): continue
        return False,'EX_TOPICAL',m.group(0),f
    for k,rx in NONSUP.items():
        if k in sh['allow']: continue
        for m in rx.finditer(tb):
            if k in ('tea','coffee','food') and USAGE.search(tb[max(0,m.start()-40):m.start()]): continue
            if k=='tea' and re.match(r'\s*(leaf\s+)?extract',tb[m.end():],I): continue
            if NEG.search(tb[:m.start()]): continue
            return False,'EX_NOT_SUPPLEMENT',f'{k}:{m.group(0)}',f
    for rx in (CULINARY,CGUM):
        for m in rx.finditer(tb):
            if NEG.search(tb[:m.start()]): continue
            if rx is CGUM and SUPP_HINT.search(t): continue
            return False,'EX_NOT_SUPPLEMENT','culinary:'+m.group(0),f
    # G9 G-NAME: title or brand only (R5: no PDP rescue)
    if not (has(sh['hero'],t) or has(sh['hero'],br)):
        if has(sh['hero'],pdp_text(x)): return False,'EX_HERO_UNNAMED','hero only in bullets/PDP, not title or brand',f
        return False,'EX_HERO_MISSING','hero term absent',f
    tt=t if has(sh['hero'],t) else dehy(t)
    hm=[m for m in re.finditer(sh['hero'],tt,I)]
    if hm and all(re.match(PRECURSOR,tt[m.end():],I) or re.match(r'\s*(a\s+)?precursor',tt[m.end():],I) for m in hm) and not has(sh['hero'],br):
        return False,'EX_HERO_MISSING','hero named only as a precursor/booster',f
    if sh['req'] and not re.search(sh['req'],tt,I) and not re.search(sh['req'],br,I): return False,'EX_HERO_MISSING','shelf co-term absent',f
    # G1 hero lead
    hs=[m.span() for m in re.finditer(sh['hero'],tt,I)]
    h0=hs[0][0] if hs else 0
    ttb=strip_brand(tt,x)
    masked=mask(ttb,[sh['hero'],sh['cls'],sh['req'] if sh['req'] and '(?=' not in sh['req'] else None,sh['form'],sh.get('deliv'),sh['kw'] and re.escape(sh['kw'])])
    masked=MODW.sub(lambda m:' '*len(m.group(0)),masked)            # R2 modifiers never lead
    others=[]
    for rx in LEXR:
        m=rx.search(masked)
        if m: others.append((m.start(),m.group(0)))
    pre=masked[:h0]; rawpre=ttb[:h0]
    for w in ing_names(x,sh):
        m=re.search(r'\b'+re.escape(w)+r'\b',masked,I)
        if m: others.append((m.start(),m.group(0)))
    for rx in (BOT,COCOA):
        for m in rx.finditer(pre):
            if m.start()<h0 and m.group(0).strip(): others.append((m.start(),m.group(0).strip()))
    mb=NAMED_BLEND.search(rawpre)
    if mb: others.append((mb.start(),mb.group(0)))
    for mc in COUNTW.finditer(rawpre):                                # R1: count word leads only if something real sits between it and the hero
        prev=[w.strip('.,;:|()[]') for w in rawpre[:mc.start()].split() if w.strip('.,;:|()[]-–—')]
        named=bool(mc.group(3)) and bool(prev) and not only_modifiers(prev[-1])   # "Maral Root Complex", "Vein Complex" = a named product
        if named or not only_modifiers(rawpre[mc.end():]): others.append((mc.start(),(prev[-1]+' ' if named else '')+mc.group(0)+' '+rawpre[mc.end():].strip()[:25]))
    lead=[o for o in others if o[0]<h0 and o[1].strip()]
    if lead:
        o=min(lead); return False,'HERO_SECONDARY',f'"{o[1].strip()}" named before hero',f
    # G2 form (lead-form test) - no PDP rescue
    ttf=re.sub(r'\b('+DELIV+r')\b',lambda m:' '*len(m.group(0)),tt,flags=I) if not sh.get('deliv') else tt   # R3-2 delivery words are not forms
    if sh['form']:
        mf=re.search(sh['form'],tt,I); mo=re.search(sh['ofo'],ttf,I) if sh['ofo'] else None
        if not mf:
            return False,'EX_FORM_MISMATCH',('other form in title: '+mo.group(0)) if mo else 'shelf form absent from title',f
        if mo and mo.start()<mf.start(): return False,'EX_FORM_BLEND',mo.group(0)+' named before form',f
        cb=re.search(r'\b(complex|blend) of\b|\b\d+ (forms?|types?|sources?)\b|\b(triple|tri|multi|dual|double)[- ]?(magnesium|zinc|iron|mineral)',tt,I)
        if cb: return False,'EX_FORM_BLEND',cb.group(0),f
        cbb=re.search(r'\b(magnesium|zinc|iron|quercetin|mineral)s? (complex|blend)\b',tt[:mf.start()],I)
        if cbb: return False,'EX_FORM_BLEND',cbb.group(0)+' before form',f
    elif sh['ofo'] and re.search(sh['ofo'],ttf,I): return False,'EX_FORM_MISMATCH',re.search(sh['ofo'],ttf,I).group(0),f
    if sh.get('deliv') and not (re.search(sh['deliv'],tt,I) or re.search(sh['deliv'],br,I)):
        return False,'EX_FORM_MISMATCH','delivery tech absent from title',f
    # G3 format
    if sh['fmt']:
        if f is None:
            if sh['fmt']=='pill' and re.search(r'\d\s*(mg|mcg|iu)\b',t,I): return True,'FORMAT_INFERRED_PILL','no format word; dose-stated',f
            return False,'EX_FORMAT_UNSTATED','no format in title, bullets or Item Form',f
        if f!=sh['fmt']: return False,'EX_FORMAT_MISMATCH',f'{f} on {sh["fmt"]} shelf',f
    elif f in ('tea','coffee','gel') and f not in sh['allow']: return False,'EX_NOT_SUPPLEMENT','format '+f,f
    after=[o for o in others if o[0]>h0]
    return True,('HERO_LED_COMPLEX' if after else 'IN_OK'),', '.join(o[1].strip() for o in after),f
# ---------- G5 line collapse
def hero_dose(x,hero):
    t=ncomma(x.get('title') or '')
    m=re.search(hero,t,I); ds=list(DOSE2.finditer(t))
    if not ds: return None
    after=[d for d in ds if m and d.start()>=m.start()]
    d=(after or ds)[0]
    return (float(d.group(1)),d.group(2).lower().replace('µg','mcg').replace('bn','billion'))
AUD=re.compile(r"\bfor (adults?|women|men|kids|children|teens?)( (and|&) (adults?|women|men|kids|children|teens?))*( \d+\+)?\b",I)
def brand_strip2(t,x,keys=()):
    t=ncomma(t or '')
    w=re.findall(r"\S+",t)
    for n in (1,2,3):
        if len(w)>=n and bkey(' '.join(w[:n]).lower()) in keys: t=' '.join(w[n:]); break
    for b in (x.get('brand'),x.get('manufacturer')):
        if not b or len(bkey(b.lower()))<3: continue
        t=re.sub(r'\b'+re.escape(b)+r'\b','',t,flags=I)
        w=re.findall(r"\S+",t); k=bkey(b.lower())
        for n in (1,2,3):
            if len(w)>=n and bkey(' '.join(w[:n]).lower())==k: t=' '.join(w[n:]); break
    return t
def name_seg(x,keys=()):
    t=brand_strip2(x.get('title'),x,keys)
    seg=re.split(r'\s[-–—|]\s|,|\||\(|\[|:',t)[0]
    seg=AUD.sub(' ',DOSE2.sub(' ',PACK.sub(' ',re.sub(FLAV,' ',seg.lower()))))
    toks=frozenset(re.findall(r'[a-z0-9]+',seg))-{'and','with','the','of'}
    return toks if len(toks)>=3 else None
def ntitle(t): return ' '.join(re.findall(r'[a-z0-9]+',PACK.sub(' ',re.sub(FLAV,' ',ncomma(t or '').lower()))))
def collapse(items,hero=r'$^'):
    shelf_brands={bkey(x.get('brand').lower()) for x in items if x.get('brand') and len(bkey(x.get('brand').lower()))>=4}|{bkey(x.get('brand')) for x in items if x.get('brand') and len(bkey(x.get('brand')))>=4}
    order=sorted(items,key=lambda p:(-(p.get('reviews') or 0),p.get('page') or 9,p.get('pos') or 99))
    kept=[]; members={}; dropped=[]
    for p in order:
        bp=ebrands(p,shelf_brands)|{bkey((p.get('brand') or '').lower())}-{''}
        vp=set(p.get('variant_asins') or [])|{p['asin']}; np_=ntitle(p['title']); dp=hero_dose(p,hero); sp=name_seg(p,bp)
        ip,lp=tokset(p.get('ingredients')),tokset(' '.join(p.get('bullets') or []))
        tp=tokset(brand_strip2(p['title'],p,bp)); fp=fmt_of(p['title'])
        hit=None
        for k in kept:
            if p['asin']==k['asin']: hit=(k,'same ASIN'); break
            if dp and any(d and d!=dp for d in members[k['asin']]): continue   # R3-5 dose conflict blocks every other merge
            bk=ebrands(k,shelf_brands)|{bkey((k.get('brand') or '').lower())}-{''}; vk=set(k.get('variant_asins') or [])|{k['asin']}
            same_b=bool(bp&bk); real_p=bkey(p.get('brand')) not in GENERIC_BRAND|{''}; real_k=bkey(k.get('brand')) not in GENERIC_BRAND|{''}
            if same_b and len(vp&vk)>0 and (len(vp)>1 or len(vk)>1): hit=(k,'same Amazon variant family'); break
            if np_ and np_==ntitle(k['title']) and (same_b or not (real_p and real_k)): hit=(k,'identical title (count/pack/flavour ignored)'); break
            if not same_b: continue
            if (p.get('reviews') or 0)>=50 and p.get('reviews')==k.get('reviews'): hit=(k,f'shared review pool {p["reviews"]}'); break
            ik,lk=tokset(k.get('ingredients')),tokset(' '.join(k.get('bullets') or []))
            if len(ip)>=12 and len(ik)>=12 and jac(ip,ik)>=0.85: hit=(k,f'same brand + same ingredient panel (J={jac(ip,ik):.2f})'); break
            if len(lp)>=25 and len(lk)>=25 and jac(lp,lk)>=0.8: hit=(k,f'same brand + same bullet copy (J={jac(lp,lk):.2f})'); break
            sk=name_seg(k,bk)
            if sp and sk and sp==sk and fp==fmt_of(k['title']): hit=(k,'same brand + same product name segment'); break
            tk=tokset(brand_strip2(k['title'],k,bk))
            if fp==fmt_of(k['title']) and tp and tk and jac(tp,tk)>=0.6: hit=(k,f'same brand + same brand-stripped title (J={jac(tp,tk):.2f})'); break
        if hit: dropped.append((p,hit[0]['asin'],hit[1])); members[hit[0]['asin']].append(dp)
        else: kept.append(p); members[p['asin']]=[dp]
    return kept,dropped
def run_shelf(shelf,recs,k=12):
    dec={}; inc=[]
    for x in recs:
        ok,code,det,f=classify(shelf,x)
        dec[x['id']]=dict(include=ok,code=code,detail=det,fmt=f)
        if ok: inc.append(dict(x,sold=sold(x)))
    kept,dropped=collapse(inc,SH[shelf]['hero'])
    for p,ka,why in dropped: dec[p['id']].update(include=False,code='EX_VARIANT_DUP',detail=f'{why} -> {ka}',dup_of=ka)
    top=sorted(kept,key=lambda p:(-p['sold'],p.get('page') or 9,p.get('pos') or 99))[:k]
    return dict(dec=dec,kept=[p['id'] for p in kept],top=[p['id'] for p in top])
