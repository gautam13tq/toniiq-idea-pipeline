"""Competitor-set gate v9 (2026-10-29; addendum 5). Rule-based, reads PDP fields, follows SHELF_RULEBOOK.md rulebook_v1.2.
gate.py (v8.1) is not modified; v9 imports its lexicons and shelf specs and overrides what rulebook v1.2 changed.
Input: listing records as in gold_work/listings.json (title, brand, manufacturer, item_form, primary_type, special_ing, crumbs,
variant_asins, bullets, ingredients, reviews, mpv, page, pos).
Order: pet -> infant/kids -> topical -> not-supplement -> G9 G-NAME (title+brand) -> co-term -> G1 hero lead -> G2 form -> G3 format.
Then G5 line collapse over included listings, then rank top-12 by sold badge, page, position."""
import re,sys,os
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
import gate as V8
from gate import LEXR,PET,INFANT,TOPICAL,NONSUP,USAGE,fmt_of,MAGF,S,FLAV,STOP,jac,bkey,DOSE
I=re.I
# ---------- shelf specs: v8.1 SH, hero aliases widened to the rulebook "Hero (aliases)" column, plus holdout rows H1-H8
SH={k:dict(v) for k,v in V8.SH.items()}
ALIAS={'magnesium glycinate gummies':r'magnes\w*','creatine gummies':r'creatine','sea moss gummies':r'sea ?moss|irish ?moss|chondrus',
 'iron bisglycinate':r'\biron\b|ferrous|ferrochel','urolithin a':r'urolithin|mitopure','horse chestnut extract':r'horse ?chestnut|aescin|escin\b|aesculus',
 'glucomannan':r'glucomannan|konjac','epicatechin':r'epicatechin','lactoferrin':r'la[ck]toferrin','thymoquinone':r'thymoquinone|black ?seed|nigella|black ?cumin|kalonji',
 'saccharomyces boulardii':r'boulardii|saccharomyces','dao enzyme':r'\b(hist)?dao\b|diamine ?oxidase|daosin|umbrellux','diosmin':r'diosmin|\bmpff\b',
 'reishi mushroom capsules':r'reishi|ganoderma|lingzhi|ling zhi'}
for k,h in ALIAS.items():
    if k in SH: SH[k]['hero']=h
SH['urolithin a']=S('urolithin a',ALIAS['urolithin a'])
SH['magnesium glycinate']=S('magnesium glycinate',r'magnes\w*',form=r'glycinate|bisglycinate',ofo=MAGF)
ZNF=r'gluconate|citrate|bisglycinate|glycinate|oxide|sulfate|acetate|orotate|carnosine|monomethionine|aspartate|chelate(?! picolinate)'
SH.update({
 'ashwagandha gummies':S('ashwagandha gummies',r'ashwagandha|withania|ksm[- ]?66|sensoril',fmt='gummy'),
 'fisetin':S('fisetin',r'fisetin'),
 'magnesium l-threonate':S('magnesium l-threonate',r'magnes\w*|magtein',form=r'threonate|magtein',ofo=MAGF.replace('threonate|','')),
 'nattokinase':S('nattokinase',r'nattokinase|nsk[- ]?sd'),
 'nmn':S('nmn',r'\bnmn\b|nicotinamide mononucleotide|uthever'),
 'quercetin phytosome':S('quercetin phytosome',r'quercetin|quercefit',form=r'phytosome|quercefit',ofo=r'dihydrate|anhydrous|liposom'),
 'spermidine':S('spermidine',r'spermidine|spermidinelife'),
 'zinc picolinate':S('zinc picolinate',r'\bzinc\b',form=r'picolinate',ofo=ZNF),
})
# ---------- helpers
def dehy(t): return re.sub(r'(?<=[A-Za-z])[-‐](?=[A-Za-z])','',t or '')
def has(rx,t): return bool(re.search(rx,t or '',I) or re.search(rx,dehy(t),I))
def first(rx,t):
    m=re.search(rx,t or '',I)
    if m: return m
    return None
KIDS=re.compile(r"\b(kids?|kid's|children'?s?|child|toddlers?|boys|girls|little ones)\b",I)
ADULT=re.compile(r"\b(adults?|women|men|teens?|family|everyone|all ages|grown[- ]?ups?|whole family)\b",I)
INFANT2=re.compile(r"\b(infants?|baby|babies|newborns?|enfamil|similac|infant formula|baby formula)\b",I)
CULINARY=re.compile(r"\b(gum powder|thicken(er|ing)( agent)?|xanthan|flour|noodles?|shirataki|pasta|\brice\b|keto baking|gelling agent|jelly powder)\b",I)
BOT=re.compile(r"\b([a-z]+(?:[ -][a-z]+)?) (root|roots|leaf|leaves|bark|seed|seeds|berry|berries|flower|fruit|peel|rhizome|stem)\b(?! (powder|extract)? ?(capsules?|gumm))",I)
COCOA=re.compile(r"\b(cocoa|cacao|flavanols?|polyphenols?)\b",I)
BLEND_LEAD=re.compile(r"\b(\d+|multi|six|five|four|three|seven|eight|ten)[- ]?(herb|mushroom|ingredient|in[- ]?1|in[- ]?one)\b|\b(herbal|proprietary|mushroom|superfood) (blend|complex)\b|\b(blend|complex)\b",I)
SUPP_HINT=re.compile(r"supplement|capsules?|tablets?|softgels?|gumm(y|ies)|veg ?caps|pills?",I)
GENERIC_BRAND=set('generic unbranded unknown na none'.split())
NOT_ACTIVE=set('''organic pure premium natural vegan extra high strength potency advanced complete daily support formula supplement supplements
capsules capsule tablets tablet gummies gummy powder liquid drops softgels made usa certified non gmo gluten free sugar keto clean'''.split())
def pdp_text(x):
    return ' '.join([x.get('special_ing') or '',x.get('primary_type') or '',' '.join((x.get('bullets') or [])[:5]),x.get('ingredients') or ''])
def ing_names(x,sh):
    """ingredient names from the PDP ingredient panel / Special Ingredients (used only for the G1 lead test)"""
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
        if all(t in NOT_ACTIVE for t in w.split()): continue
        if re.search(r'cellulose|gelatin|stearate|silica|water|glycerin|pectin|sugar|syrup|citric|flavou?r|color|starch|capsule|rice|hypromellose|dicalcium|maltodextrin|sorbitol|stevia|monk fruit|sweet|oil$|acid$|lecithin|wax|coating|sodium|tapioca|xylitol|erythritol|allulose|gum',w,I): continue
        out.add(w)
    return out
def mask(t,rxs):
    for rx in rxs:
        if rx: t=re.sub(rx,lambda m:' '*len(m.group(0)),t,flags=I)
    return t
def strip_brand(t,x):
    """blank out the brand field (and manufacturer) wherever it is printed in the title"""
    for b in (x.get('brand'),x.get('manufacturer')):
        if b and len(b)>=3:
            for w in [b]+[w for w in re.findall(r"[A-Za-z][A-Za-z'&.]+",b) if len(w)>=4]:
                t=re.sub(re.escape(w),lambda m:' '*len(m.group(0)),t,flags=I)
    return t
MAPF={'gummy':'gummy','gummies':'gummy','capsule':'pill','capsules':'pill','tablet':'pill','tablets':'pill','softgel':'pill','softgels':'pill','caplet':'pill',
      'powder':'powder','liquid':'liquid','drops':'liquid','chewable':'chew','chew':'chew','lozenge':'pill','tea':'tea','coffee':'coffee','gel':'gel','pill':'pill'}
def fmt_pdp(x):
    f=(x.get('item_form') or '').lower()
    for k,v in MAPF.items():
        if re.search(r'\b'+k+r'\b',f): return v
    return None
def classify(shelf,x):
    """returns (include, code, detail, fmt)"""
    sh=SH[shelf]; t=x.get('title') or ''; br=x.get('brand') or ''
    f=fmt_of(t) or fmt_of(' '.join((x.get('bullets') or [])[:2])) or fmt_pdp(x)   # v1.2 G8/Q8: title > bullets > Item Form
    crumbs=' > '.join(x.get('crumbs') or []) if isinstance(x.get('crumbs'),list) else (x.get('crumbs') or '')
    tb=strip_brand(t,x)   # brand words are not ingredient/food words
    if PET.search(t) or crumbs.lower().startswith('pet supplies'): return False,'EX_PET',(PET.search(t) or re.match('.*',crumbs)).group(0)[:40],f
    if INFANT2.search(t): return False,'EX_INFANT',INFANT2.search(t).group(0),f
    if KIDS.search(t) and not ADULT.search(t): return False,'EX_KIDS',KIDS.search(t).group(0),f
    hs=[m.span() for m in re.finditer(sh['hero'],t,I)]
    for m in TOPICAL.finditer(tb):
        if any(a<=m.start()<b for a,b in hs): continue
        w=m.group(0).lower()
        if w=='balm' and re.search(r'lemon\s+$',t[:m.start()],I): continue
        if w.replace(' ','')=='skincare' and SUPP_HINT.search(t): continue
        return False,'EX_TOPICAL',m.group(0),f
    for k,rx in NONSUP.items():
        if k in sh['allow']: continue
        for m in rx.finditer(tb):
            if k in ('tea','coffee','food') and USAGE.search(tb[max(0,m.start()-40):m.start()]): continue
            if k=='tea' and re.match(r'\s*(leaf\s+)?extract',tb[m.end():],I): continue
            return False,'EX_NOT_SUPPLEMENT',f'{k}:{m.group(0)}',f
    mc=CULINARY.search(tb)
    if mc and not (mc.group(0).lower()=='rice' and re.search(r'rice (bran|flour)? ?(capsule|hull|powder)|brown rice|rice concentrate',t,I)): return False,'EX_NOT_SUPPLEMENT','culinary:'+mc.group(0),f
    # G9 G-NAME: hero named on the title or the brand name (raw or de-hyphenated)
    if not (has(sh['hero'],t) or has(sh['hero'],br)):
        if has(sh['hero'],pdp_text(x)): return False,'EX_HERO_UNNAMED','hero only in bullets/PDP, not title or brand',f
        return False,'EX_HERO_MISSING','hero term absent',f
    tt=t if has(sh['hero'],t) else dehy(t)
    if sh['req'] and not re.search(sh['req'],tt,I) and not re.search(sh['req'],br,I): return False,'EX_HERO_MISSING','shelf co-term absent',f
    # G1 hero lead
    hs=[m.span() for m in re.finditer(sh['hero'],tt,I)]
    h0=hs[0][0] if hs else 0
    ttb=strip_brand(tt,x)
    masked=mask(ttb,[sh['hero'],sh['cls'],sh['req'] if sh['req'] and '(?=' not in sh['req'] else None,sh['form'],sh['kw'] and re.escape(sh['kw'])])
    others=[]
    for rx in LEXR:
        m=rx.search(masked)
        if m: others.append((m.start(),m.group(0)))
    pre=masked[:h0]
    for w in ing_names(x,sh):
        m=re.search(r'\b'+re.escape(w)+r'\b',masked,I)
        if m: others.append((m.start(),m.group(0)))
    for rx in (BOT,COCOA):
        for m in rx.finditer(pre):
            if m.start()<h0 and not re.search(r'^\s*$',m.group(0)): others.append((m.start(),m.group(0).strip()))
    mb=BLEND_LEAD.search(pre)
    if mb and not (sh['form'] and re.search(r'\b(blend|complex)\b',mb.group(0),I)): others.append((mb.start(),mb.group(0)))
    lead=[o for o in others if o[0]<h0 and o[1].strip()]
    if lead:
        o=min(lead); return False,'HERO_SECONDARY',f'"{o[1].strip()}" named before hero',f
    # G2 form (lead-form test)
    if sh['form']:
        mf=re.search(sh['form'],tt,I); mo=re.search(sh['ofo'],tt,I) if sh['ofo'] else None
        if not mf:
            if mo: return False,'EX_FORM_MISMATCH','other form in title: '+mo.group(0),f
            if not re.search(sh['form'],pdp_text(x),I): return False,'EX_FORM_MISMATCH','shelf form absent',f
        else:
            if mo and mo.start()<mf.start(): return False,'EX_FORM_BLEND',mo.group(0)+' named before form',f
            cb=re.search(r'\b(magnesium|zinc|iron|quercetin|mineral)s? (complex|blend)\b|\b(complex|blend) of\b|\b\d forms?\b|triple (magnesium|zinc)|multi[- ]?(magnesium|zinc)',tt,I)
            if cb: return False,'EX_FORM_BLEND',cb.group(0),f
            cw=re.search(r'\b'+'(?:'+sh['form']+r')\s+complex\b',tt,I)
            if cw: return False,'EX_FORM_BLEND',cw.group(0),f
    elif sh['ofo'] and re.search(sh['ofo'],tt,I): return False,'EX_FORM_MISMATCH',re.search(sh['ofo'],tt,I).group(0),f
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
PACK=re.compile(r"\(?\b(\d+|one|two|three|four|five|six)\s*[- ]?(bottles?|packs?|pk|count|ct|jars?|pouches?)\b\)?|\bpack of \d+\b|\b\d+\s*(capsules?|caps|tablets?|softgels?|gummies|servings?|veg ?caps|vcaps?|oz|g|grams?|lbs?|ml|fl\.? ?oz)\b|\(\s*\)",I)
def ntitle(t): return ' '.join(re.findall(r'[a-z0-9]+',PACK.sub(' ',re.sub(FLAV,' ',(t or '').lower()))))
def tokset(s): return set(re.findall(r'[a-z]{3,}',(s or '').lower()))-STOP
def ebrands(x,shelf_brands):
    b={bkey(x.get('brand'))}-{''}
    tw=re.findall(r"[A-Za-z][A-Za-z'&.]*",x.get('title') or '')
    for k in (1,2,3):
        c=bkey(' '.join(tw[:k]).lower())
        if c in shelf_brands: b.add(c)
    return b
def collapse(items):
    """items: included listing records (+sold). Keeper = most reviews, ties best position (rulebook G5). Returns kept, dropped[(item,kept_asin,why)]"""
    shelf_brands={bkey(x.get('brand')) for x in items if x.get('brand') and len(bkey(x.get('brand')))>=4}
    order=sorted(items,key=lambda p:(-(p.get('reviews') or 0),p.get('page') or 9,p.get('pos') or 99))
    kept=[]; dropped=[]
    for p in order:
        bp=ebrands(p,shelf_brands); vp=set(p.get('variant_asins') or [])|{p['asin']}; np_=ntitle(p['title'])
        ip,lp=tokset(p.get('ingredients')),tokset(' '.join(p.get('bullets') or []))
        hit=None
        for k in kept:
            bk=ebrands(k,shelf_brands); vk=set(k.get('variant_asins') or [])|{k['asin']}
            same_b=bool(bp&bk); real_p=bkey(p.get('brand')) not in GENERIC_BRAND|{''}; real_k=bkey(k.get('brand')) not in GENERIC_BRAND|{''}
            if p['asin']==k['asin']: hit=(k,'same ASIN'); break
            if same_b and len(vp&vk)>0 and (len(vp)>1 or len(vk)>1): hit=(k,'same Amazon variant family'); break
            if np_ and np_==ntitle(k['title']) and (same_b or not (real_p and real_k)): hit=(k,'identical title (count/pack/flavour ignored)'); break
            if not same_b: continue   # Q2: different brands never merge beyond this point
            if (p.get('reviews') or 0)>=50 and p.get('reviews')==k.get('reviews'): hit=(k,f'shared review pool {p["reviews"]}'); break
            ik,lk=tokset(k.get('ingredients')),tokset(' '.join(k.get('bullets') or []))
            if len(ip)>=12 and len(ik)>=12 and jac(ip,ik)>=0.85: hit=(k,f'same brand + same ingredient panel (J={jac(ip,ik):.2f})'); break
            if len(lp)>=25 and len(lk)>=25 and jac(lp,lk)>=0.8: hit=(k,f'same brand + same bullet copy (J={jac(lp,lk):.2f})'); break
            tp,tk=tokset(p['title']),tokset(k['title'])
            dp={a.replace(',','') for a,u in DOSE.findall(p['title'])}; dk={a.replace(',','') for a,u in DOSE.findall(k['title'])}
            if (not dp or not dk or dp==dk) and jac(tp,tk)>=0.7 and fmt_of(p['title'])==fmt_of(k['title']): hit=(k,f'same brand + same product name (J={jac(tp,tk):.2f})'); break
        if hit: dropped.append((p,hit[0]['asin'],hit[1]))
        else: kept.append(p)
    return kept,dropped
SOLD=re.compile(r'([\d.]+)\s*([kK])?\+?\s*bought',I)
def sold(x):
    m=SOLD.search(x.get('mpv') or '')
    if not m: return 0
    return int(float(m.group(1))*(1000 if m.group(2) else 1))
def run_shelf(shelf,recs,k=12):
    """returns dict: per-listing decision, kept lines, top-k ids"""
    dec={}
    inc=[]
    for x in recs:
        ok,code,det,f=classify(shelf,x)
        dec[x['id']]=dict(include=ok,code=code,detail=det,fmt=f)
        if ok: inc.append(dict(x,sold=sold(x)))
    kept,dropped=collapse(inc)
    for p,ka,why in dropped: dec[p['id']].update(include=False,code='EX_VARIANT_DUP',detail=f'{why} -> {ka}',dup_of=ka)
    top=sorted(kept,key=lambda p:(-p['sold'],p.get('page') or 9,p.get('pos') or 99))[:k]
    return dict(dec=dec,kept=[p['id'] for p in kept],top=[p['id'] for p in top])
