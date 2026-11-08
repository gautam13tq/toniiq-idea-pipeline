"""Competitor-set gate v9.3 (2026-10-29; addendum 8). Follows SHELF_RULEBOOK.md rulebook_v1.5 (v1.4 + Gautam Round 5 R5-1..R5-4).
Imports frozen gate_v92.py (not modified) and wraps classify / replaces collapse. General rules only (no ASIN/brand lists):
 M1 R5-4 non-supplement: (a) beverages/aperitifs: aperitif/mocktail/cocktail/non-alcoholic or alcohol-free spirit words, or a
    Grocery > Beverages category with no supplement word in the title; (b) bulk culinary powder: powder format, no dose in the title,
    no supplement word, and either a Grocery category or culinary-use copy ("perfect for teas, coffee, smoothies").
 M2 R5-3 branded base product: a coined product name (CamelCase or TM/R-marked word, after brand stripping) printed before the hero,
    with "with" between them = HERO_SECONDARY ("UltraFlora Triplebiotic with Akkermansia").
    Descriptive bases ("Metabolic Daily - Multi-Strain Probiotic with <hero>", "GLP-1 Probiotic+, <hero>") still count.
 M3 Mineral form blends: "tri-/triple/multi-/dual-<mineral>" (chromium, calcium, selenium, copper added) = EX_FORM_BLEND on a
    form-named shelf unless the shelf form is printed before it.
 M4 A class-word named blend ("Mushroom Complex") before the hero does not lead when the title gives the hero its own dose
    and the hero is then the only named active ("EGT Mushroom Complex ... 50mg Ergothioneine"); re-tested with the blend phrase masked.
 M5 A counted oral sold unit ("60 Caps") means tea/coffee followed by a named compound (EGCG, catechins, polyphenols, theanine, chlorogenic) is an ingredient ("Green Tea Leaf EGCG ... 60 Caps").
 M6 Pet category crumb alone (no pet word in the title) no longer excludes; pet words in the title still do.
 M7 R5-2 format split in collapse: listings whose known formats differ (capsule vs powder ...) never merge, except the same ASIN.
 M8 R2 same brand + same formula: same brand (incl. brand printed in the title) and one product-name segment contains the other
    (>=5 non-numeric tokens), same format, no dose conflict = one line (reseller tails, "PURELYNUTRIENT ... Capsules with 4.64% TQ").
 R5-1 (hero + one vitamin counts) needs no new code: vitamins after the hero are co-actives (HERO_LED_COMPLEX)."""
import re,sys,os
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
import gate_v92 as V2
from gate_v92 import *            # noqa: F401,F403 (specs, lexicons, helpers)
from gate_v92 import SH,norm,ncomma,strip_brand,fmt_of,SUPP_HINT,DOSE2,SOLD,PET,NAMED_BLEND,hero_dose,dconf,name_seg,ntitle,brand_strip2,tokset,jac,bkey,ebrands,GENERIC_BRAND,sold
I=re.I
BEV=re.compile(r"\b(aperiti[fv]o?s?|mocktails?|cocktails?|cocktail mixers?|(non[- ]?alcoholic|alcohol[- ]free) (spirits?|aperiti\w+|beers?|wines?|drinks?)|sparkling (water|beverage)s?)\b",I)
CUL_USE=re.compile(r"\b(perfect|great|ideal|use|add|adding)\b.{0,25}\b(teas?|coffee|smoothies?|baking|cooking|recipes?|soups?|curr(y|ies)|lattes?)\b",I)
COINED=re.compile(r"\b[A-Z][a-z]+[A-Z][A-Za-z]*\b|[A-Za-z][\w-]*[\u2122\u00ae]")
TEAING=re.compile(r"\b(tea|coffee)\s+(leaf\s+|bean\s+)?(egcg|catechins?|polyphenols?|theanine|chlorogenic)\b",I)
MINBL=re.compile(r"\b(tri|triple|multi|dual|double)[- ]?(chromium|magnesium|zinc|iron|calcium|selenium|copper|mineral)s?\b",I)
def _crumbs(x):
    c=x.get('crumbs') or x.get('category') or ''
    return ' > '.join(c) if isinstance(c,list) else c
def nonsup_r54(x,f):                                           # M1
    t=x.get('title') or ''; c=_crumbs(x)
    m=BEV.search(t)
    if m: return 'beverage:'+m.group(0)
    if re.match(r'grocery[^>]*>\s*beverages',c,I) and not SUPP_HINT.search(t): return 'beverage category'
    if f=='powder' and not DOSE2.search(ncomma(t)) and not SUPP_HINT.search(t):
        if c.lower().startswith('grocery'): return 'bulk culinary powder (grocery category)'
        m=CUL_USE.search(t)
        if m: return 'bulk culinary powder: '+m.group(0)[:30]
    return None
def coined_base(shelf,x):                                      # M2
    sh=SH[shelf]; t=ncomma(x.get('title') or ''); ttb=strip_brand(t,x)
    m=re.search(sh['hero'],ttb,I)
    if not m: return None
    pre=ttb[:m.start()]
    link=re.search(r'\bwith\b',pre,I)
    if not link: return None
    mc=COINED.search(pre[:link.start()])
    return mc.group(0) if mc else None
def classify(shelf,x):
    x=norm(x); sh=SH[shelf]; t=ncomma(x.get('title') or '')
    sh2=None
    if SOLD.search(t) and TEAING.search(t) and not sh['fmt'] in ('tea','coffee'):    # M5
        sh2=dict(sh); sh2['allow']=set(sh['allow'])|{'tea','coffee'}
    x2=x
    if not PET.search(t): x2=dict(x,crumbs=None)                 # M6 (crumbs used only by the pet test in v9.2)
    def run(xx,spec):
        if spec is None: return V2.classify(shelf,xx)
        SH[shelf]=spec
        try: return V2.classify(shelf,xx)
        finally: SH[shelf]=sh
    ok,code,det,f=run(x2,sh2)
    if code in ('EX_PET','EX_INFANT','EX_KIDS','EX_TOPICAL'): return ok,code,det,f
    r=nonsup_r54(x,f)
    if r: return False,'EX_NOT_SUPPLEMENT',r,f
    if code=='EX_NOT_SUPPLEMENT': return ok,code,det,f
    if code=='HERO_SECONDARY':                                   # M4
        hs=re.search(sh['hero'],t,I); mb=NAMED_BLEND.search(t)
        if hs and mb and mb.start()<hs.start() and re.search(r'\d\s*(mg|mcg|g)\s+(l-)?$',t[:hs.start()],I):
            ok2,code2,det2,f2=run(dict(x2,title=t[:mb.start()]+t[mb.end():]),sh2)
            if ok2 and code2=='IN_OK': return True,'HERO_LED_COMPLEX',(mb.group(0)+'; '+det2).strip('; '),f2
        return ok,code,det,f
    if not ok: return ok,code,det,f
    cb=coined_base(shelf,x)
    if cb: return False,'HERO_SECONDARY',f'branded base product "{cb}" before hero',f
    if sh['form']:                                               # M3
        mm=MINBL.search(t); mf=re.search(sh['form'],t,I)
        if mm and not (mf and mf.start()<mm.start()): return False,'EX_FORM_BLEND',mm.group(0),f
    return ok,code,det,f
def _segtok(x,keys):
    t=brand_strip2(x.get('title'),x,keys)
    s=name_seg(dict(x,title=t),keys)
    return frozenset(w for w in s if not w.isdigit()) if s else None
def collapse(items,hero=r'$^'):
    shelf_brands={bkey(x.get('brand').lower()) for x in items if x.get('brand') and len(bkey(x.get('brand').lower()))>=4}|{bkey(x.get('brand')) for x in items if x.get('brand') and len(bkey(x.get('brand')))>=4}
    order=sorted(items,key=lambda p:(-(p.get('reviews') or 0),p.get('page') or 9,p.get('pos') or 99))
    kept=[]; members={}; dropped=[]
    for p in order:
        bp=ebrands(p,shelf_brands)|{bkey((p.get('brand') or '').lower())}-{''}
        vp=set(p.get('variant_asins') or [])|{p['asin']}; np_=ntitle(p['title']); dp=hero_dose(p,hero); sp=name_seg(p,bp)
        ip,lp=tokset(p.get('ingredients')),tokset(' '.join(p.get('bullets') or []))
        tp=tokset(brand_strip2(p['title'],p,bp)); fp=fmt_of(p['title']); gp=p.get('fmt')
        hit=None
        for k in kept:
            if p['asin']==k['asin']: hit=(k,'same ASIN'); break
            if gp and k.get('fmt') and gp!=k.get('fmt'): continue                       # M7 R5-2
            if dp and any(dconf(d,dp) for d in members[k['asin']]): continue
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
            a,b=_segtok(p,bp|bk),_segtok(k,bp|bk)                                       # M8
            if a and b and min(len(a),len(b))>=5 and (a<=b or b<=a) and fp==fmt_of(k['title']): hit=(k,'same brand + name segment contained in the other'); break
        if hit: dropped.append((p,hit[0]['asin'],hit[1])); members[hit[0]['asin']].append(dp)
        else: kept.append(p); members[p['asin']]=[dp]
    return kept,dropped
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
