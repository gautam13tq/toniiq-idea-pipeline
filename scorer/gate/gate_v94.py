"""Competitor-set gate v9.4 (2026-10-30; addendum 9). Follows SHELF_RULEBOOK.md rulebook_v1.6 (v1.5 + Gautam Round 6 R6-1..R6-3 + R5-4 whole-food settle).
Imports frozen gate_v93.py (not modified) and wraps classify / replaces collapse. General rules only (no ASIN/brand lists):
 W1 Whole-food / bulk non-supplement (R5-4 settle): hero sold as food by weight - dried fruit, whole/cooking seeds, pitted/unsulfured fruit,
    cut & sifted / loose bulk herb - with a weight (oz/lb/g/kg), no per-serving dose, no oral unit, no extract/oil/liquid word = EX_NOT_SUPPLEMENT.
 W2 The bulk-herb words ("dried root", "whole root") never exclude a liquid extract/tincture/drops listing: they describe the source herb.
 W3 Counted unit from Item Form: a title "N ct/count" with no format word takes its format from Item Form / dosage form (capsule, tablet,
    softgel, gummy) before bullet copy, so "mushroom powder" in a bullet no longer makes a 120 ct capsule bottle a powder.
 W4 R6-1 refines M2: "[Coined name] with [hero]" is out only when the PDP ingredient panel names another active (a broader base formula);
    when the hero is the sole active on the panel it counts.
 W5 R6-3 dosed hero after a named complex: "<Benefit> Complex with 5000mcg <hero>" - the hero carries its own dose straight after "with" -
    is re-tested with the complex phrase masked; counts (HERO_LED_COMPLEX) only if the masked title then passes as IN_OK.
 W6 Source-of-hero: a word named before the hero that the ingredient panel describes as the hero's source ("orange extract (peel)
    providing 450 mg diosmin") is not a competing active; re-tested with it masked, counts only if then IN.
 W7 Dose-dominant hero: paired title doses "A B ... 50mg/450mg" in name order where the hero has the largest dose = hero leads (HERO_LED_COMPLEX).
 W8 R5-3 prominence: a title that names the hero only after the sold count/servings, undosed, as one item of a comma list with >=2 other actives after
    it ("Sleep Mushroom Capsules ..., 90 Count, 30 Days, Reishi, GABA, L-Theanine, Melatonin") = HERO_SECONDARY.
 W9 Carrier / massage oil (made to dilute essential oils on skin) = EX_TOPICAL.
 C1 Pack multiples: same brand, same format, same hero dose (both stated), one title a multipack ("(2 Pack)", "Pack of 3", "x2", "2PCS",
    "(2 Bottles)") = one line with the single pack.
 C3 Thousands separators are normalised before the hero dose is read for merging ("10,000mcg" = "10000mcg"), so a comma no longer
    reads as a conflicting dose and blocks a same-listing merge.
 C2 R6-2 organic vs non-organic: same brand field (equal or prefix) with one title claiming organic and the other not = never merged,
    even within one Amazon variant family or review pool ("better than organic", "non-organic capsules" are not organic claims).
    Resellers (other brand field) still follow R2 same brand + formula."""
import re,sys,os
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
import gate_v93 as V3
import gate_v92 as V2
from gate_v93 import *            # noqa: F401,F403
from gate_v93 import SH,norm,ncomma,strip_brand,fmt_of,SUPP_HINT,DOSE2,SOLD,NAMED_BLEND,COUNTW,hero_dose,dconf,name_seg,ntitle,brand_strip2,tokset,jac,bkey,ebrands,GENERIC_BRAND,sold,_segtok,coined_base,ing_names,ORAL
I=re.I
WEIGHT=re.compile(r"\b\d+(\.\d+)?\s*-?\s*(oz|ounces?|lbs?|pounds?|kg|kilograms?|g|grams?)\b",I)
WHOLE=re.compile(r"\b(dried|dehydrated|pitted|unsulfured|whole (seeds?|herbs?|roots?|berr\w+)|seeds|cut\s*(&|and)\s*sifted|c/s|loose|bulk herb|cherries|berries|raisins|fruit)\b",I)
CARRIER=re.compile(r"\bcarrier oil\b|\bmassage oil\b",I)
EXCIP=re.compile(r"\b(mcc|microcrystalline|cellulose|directions?|take|daily|serving|capsules?|tablets?|purified water|stearate|silica|rice|vegetable)\b",I)
NOTFOOD=re.compile(r"\b(extract|oil|liquid|tincture|drops|juice|concentrate|powder|capsules?|caps|tablets?|softgels?|gumm(y|ies)|supplements?|tea ?bags?|sprouting kit|for planting|planting)\b",I)
LIQ=re.compile(r"\b(liquid|tincture|drops|glycerite|alcohol[- ]free|extract)\b",I)
FORMW={'capsule':'Capsules','tablet':'Tablets','softgel':'Softgels','gumm':'Gummies','chewable':'Tablets','caplet':'Tablets','vegetarian capsule':'Capsules'}
def wholefood(x,f):                                              # W1
    t=ncomma(x.get('title') or '')
    if f in ('pill','gummy','chew') or DOSE2.search(t) or NOTFOOD.search(t) or SOLD.search(t): return None
    mw=WHOLE.search(t)
    if mw and WEIGHT.search(t): return 'whole-food/bulk: '+mw.group(0)
    return None
def _unitform(x):
    s=' '.join(str(x.get(k) or '') for k in ('item_form','dosage_form')).lower()
    for k,v in FORMW.items():
        if k in s: return v
    return None
def _prep(x):
    t=x.get('title') or ''
    if fmt_of(t) is None:                                         # W3
        m=re.search(r"\b\d+\s*(ct|count)\b",t,I); u=_unitform(x)
        if m and u: x=dict(x,title=t[:m.end()]+' '+u+t[m.end():])
    return x
def _rerun(shelf,x,title):
    return V3.classify(shelf,dict(x,title=title))
def classify(shelf,x):
    x=norm(x); sh=SH[shelf]; x=_prep(x); t=ncomma(x.get('title') or '')
    ok,code,det,f=V3.classify(shelf,x)
    if code=='EX_NOT_SUPPLEMENT' and str(det).startswith('bulk_herb:') and LIQ.search(t):   # W2
        w=det.split(':',1)[1]; t2=re.sub(re.escape(w),' '*len(w),t,flags=I)
        ok,code,det,f=_rerun(shelf,x,t2)
    if code in ('EX_PET','EX_INFANT','EX_KIDS','EX_TOPICAL','EX_NOT_SUPPLEMENT'): return ok,code,det,f
    r=wholefood(x,f)
    if r: return False,'EX_NOT_SUPPLEMENT',r,f
    if ok and CARRIER.search(t): return False,'EX_TOPICAL','carrier/massage oil: '+CARRIER.search(t).group(0),f   # W9
    if code=='HERO_SECONDARY':
        hs=re.search(sh['hero'],t,I)
        if hs and str(det).startswith('branded base product'):  # W4 (R6-1)
            if not [n for n in ing_names(x,sh) if not EXCIP.search(n)]:
                ok2,code2,det2,f2=V2.classify(shelf,x if V3.PET.search(t) else dict(x,crumbs=None))
                if ok2: return ok2,code2,'R6-1 coined name, hero sole active on panel; '+str(det2),f2
            return ok,code,det,f
        pre=t[:hs.start()] if hs else ''
        if hs and re.search(r"\bwith\s+\d[\d.]*\s*(mg|mcg|g|iu)\s+(l-)?$",pre,I):   # W5 (R6-3)
            mc=None
            for m in COUNTW.finditer(pre): mc=m
            mb=NAMED_BLEND.search(pre)
            for mm in [m for m in (mb,mc) if m]:
                s0=pre.rfind(' ',0,max(0,mm.start()-1))+1 if not mm.group(0)[0].isdigit() else mm.start()
                t2=t[:s0]+' '*(mm.end()-s0)+t[mm.end():]
                ok2,code2,det2,f2=_rerun(shelf,x,t2)
                if ok2 and code2=='IN_OK': return True,'HERO_LED_COMPLEX',mm.group(0)+' (dosed hero after "with")',f2
        m=re.match(r'"(.+?)" named before hero',str(det))
        if m and hs:                                             # W6 source-of-hero
            w=m.group(1); ing=(x.get('ingredients') or '')+' ; '+(x.get('special_ing') or '')
            toks=set(re.findall(r'[a-z]{3,}',w.lower()))
            for seg in re.findall(r"[^;,|\]]{0,80}?\b(?:providing|from|as|standardi[sz]ed to|yielding)\b[^;,|\]]{0,40}",ing,I):
                if re.search(sh['hero'],seg,I) and toks and toks<=set(re.findall(r'[a-z]{3,}',seg.lower())):
                    t2=re.sub(re.escape(w),' '*len(w),t,flags=I)
                    ok2,code2,det2,f2=_rerun(shelf,x,t2)
                    if ok2: return True,'HERO_LED_COMPLEX',f'{w} = source of hero ({code2})',f2
            ds=re.search(r"(\d[\d.]*)\s*(mg|mcg)?\s*/\s*(\d[\d.]*)\s*(mg|mcg)",t,I)   # W7 dose-dominant
            if ds:
                pre2=t[:ds.start()]; mo=re.search(re.escape(w),pre2,I); mh=[mm for mm in re.finditer(sh['hero'],pre2,I)]
                if mo and mh and mo.start()<mh[0].start() and float(ds.group(3))>float(ds.group(1)):
                    t2=re.sub(re.escape(w),' '*len(w),t,flags=I); ok2,code2,det2,f2=_rerun(shelf,x,t2)
                    if ok2: return True,'HERO_LED_COMPLEX',f'{w} named first but hero dose dominant ({ds.group(0)})',f2
        return ok,code,det,f
    if ok and code=='HERO_LED_COMPLEX':                          # W8 prominence
        ms=re.search(r"\b\d+\s*(count|ct|servings?|days?|capsules?|caps|tablets?|softgels?|gumm(y|ies))\b",t,I)
        if ms and not re.search(sh['hero'],t[:ms.start()],I):
            items=[i.strip() for i in t[ms.end():].split(',')]
            hi=[j for j,i in enumerate(items) if re.search(sh['hero'],i,I)]
            if hi:
                j=hi[0]; rest=[i for i in items[j+1:] if i and len(i.split())<=4 and not re.search(sh['hero'],i,I)]
                if not DOSE2.search(items[j]) and len(items[j].split())<=3 and len(rest)>=2:
                    return False,'HERO_SECONDARY','hero only in an undosed list of actives after the sold count (R5-3 prominence)',f
    return ok,code,det,f
PACKM=re.compile(r"\(\s*\d+\s*-?\s*(pack|pk|bottles?|pcs)\s*\)|\bpack of \d+\b|\b\d+\s*-?\s*(pack|pk|pcs)\b|\b[x×]\s*[2-9]\b|\b[2-9]\s*[x×]\b(?!\s*\d)|\(\s*\d+\s*bottles?\s*\)",I)
def _thou(t): return re.sub(r'(\d),(\d{3})(?!\d)',r'\1\2',t or '')
def _org(t): return bool(re.search(r'(?<!non-)(?<!non )\borganic\b',t or '',I)) and not re.search(r'than organic',t or '',I)
def _bk(b): return re.sub('[^a-z]','',(b or '').lower())
def _samebf(p,k):
    a,b=_bk(p.get('brand')),_bk(k.get('brand')); return bool(a and b and (a.startswith(b) or b.startswith(a)))
def collapse(items,hero=r'$^'):
    shelf_brands={bkey(x.get('brand').lower()) for x in items if x.get('brand') and len(bkey(x.get('brand').lower()))>=4}|{bkey(x.get('brand')) for x in items if x.get('brand') and len(bkey(x.get('brand')))>=4}
    order=sorted(items,key=lambda p:(-(p.get('reviews') or 0),p.get('page') or 9,p.get('pos') or 99))
    kept=[]; members={}; dropped=[]
    for p in order:
        bp=ebrands(p,shelf_brands)|{bkey((p.get('brand') or '').lower())}-{''}
        vp=set(p.get('variant_asins') or [])|{p['asin']}; np_=ntitle(p['title']); dp=hero_dose(dict(p,title=_thou(p['title'])),hero); sp=name_seg(p,bp)
        ip,lp=tokset(p.get('ingredients')),tokset(' '.join(p.get('bullets') or []))
        tp=tokset(brand_strip2(p['title'],p,bp)); fp=fmt_of(p['title']); gp=p.get('fmt')
        hit=None
        for k in kept:
            if p['asin']==k['asin']: hit=(k,'same ASIN'); break
            if gp and k.get('fmt') and gp!=k.get('fmt'): continue                       # M7 R5-2
            if _samebf(p,k) and _org(p['title'])!=_org(k['title']): continue           # C2 R6-2
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
            dk=hero_dose(dict(k,title=_thou(k['title'])),hero)                                                          # C1 pack multiples
            if dp and dk and dp[:2]==dk[:2] and fp==fmt_of(k['title']) and bool(PACKM.search(p['title']))!=bool(PACKM.search(k['title'])):
                hit=(k,'same brand + same dose/format, multipack of the single'); break
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
