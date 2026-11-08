"""Competitor-set gate v9.7 (2026-11-01; addendum 12). Follows SHELF_RULEBOOK.md rulebook_v1.9 (v1.8 + Gautam R8-1 + NPD settles).
Imports frozen gate_v96.py / gate_v92 / gate_v93 / gate_v94 / gate_v95 (not modified). classify = v9.6 classify with the changes below;
collapse = v9.4 collapse with Z8. General rules only (no ASIN/brand lists):
 Z1 Herb names are not pets: pet words inside a herb name ("Cat's Claw", "Cats Claw", horsetail, horse chestnut, horseradish, dogwood,
    dog rose, catnip, cat's ear) or inside the shelf hero phrase are masked before the pet test.
 Z2 Animal products: title words horse(s)/equine/pony/ponies/foal(s)/mare(s) = EX_PET (herb names masked first); a Pet Supplies category
    plus an animal-target phrase in the bullets ("for horses", "equine supplement", "your horse/dog/cat", "mix with daily feed") = EX_PET,
    unless the title names humans/people.
 Z3 Homeopathic products are not supplements: "homeopathic"/HPUS in the title, HPUS on the ingredient panel or bullets (the label's own
    drug declaration), or a potency token (6C, 30C, 12X, 200CH) in a pellet/tablet title = EX_NOT_SUPPLEMENT. The Amazon category
    "Single Homeopathic Remedies" alone is not a signal (Amazon files ordinary herbal capsules there).
 Z4 No supplement signal: no ingredient panel, a category outside health/grocery/beauty/sports/baby, no supplement or oral-unit word in
    title or bullets and no dose = EX_NOT_SUPPLEMENT (hardware sharing a herb name).
 Z5 Bulk herb-part powder (R5-4): "<root|leaf|herb|bark|seed|flower|berry> powder" sold by weight (oz/lb/g, pouch/bag) with no dose, no
    servings, no extract and no supplement/oral-unit word in the title = EX_NOT_SUPPLEMENT.
 Z6 Generalises Y4: any root/herb descriptor (dried, whole, raw, cut & sifted ... root/herb/seed/leaf/bark) is not bulk when the title states
    a per-unit mg/mcg dose or a counted oral unit ("120 Capsules"); re-tested with the descriptor masked.
 Z7 Form shelves, multi-mineral titles: a shelf-form word attached to another mineral ("Copper Gluconate") is that mineral's form. When every
    title form word is foreign, the hero's own compound is read from title, bullets, then ingredient panel ("Zinc L-methionine");
    a different compound = EX_FORM_MISMATCH; none found = test the rest of the title as usual.
 Z8 Collapse: same brand where one brand field is a prefix of the other ("NOW" / "NOW Foods") is the same brand; same brand + same
    brand-stripped title once counts/pack sizes (incl. "Tabs") are removed + same hero dose = one line.
 Z9 R8-1 coined name containing the hero word: a title word that contains a literal hero term inside a longer coined word ("TheraZinc")
    names the hero when the ingredient panel's lead active is the hero; re-tested with the word read as the hero. Coined names without
    the full hero word stay out (R3-3).
 Z10 R7-1 refinement: helpers, carriers and cofactors are skipped when picking the label lead (mustard seed powder / myrosinase,
    enzymes, black pepper / piperine / BioPerine, carrier oils, MCT, lecithin)."""
import re,sys,os
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
import gate_v92 as V2, gate_v93 as V3, gate_v94 as V4, gate_v95 as V5, gate_v96 as V6
from gate_v96 import *            # noqa: F401,F403
from gate_v96 import SH,norm,ncomma,fmt_of,DOSE2,sold,_pdp,_panel_lead,_sub,_blank,_fuzzy,_lits,_panel_doses,_retry,DESCW,VITMIN,BLENDW
from gate_v94 import WEIGHT,PACKM,_thou,_org,_bk,_samebf,GENERIC_BRAND,bkey,ebrands,tokset,jac,name_seg,ntitle,brand_strip2,hero_dose,dconf,_segtok
I=re.I
HERBPET=re.compile(r"\bcat'?s?[- ]?(claw|ear|nip|mint)\b|\bcatnip\b|\bhorse[- ]?(tail|chestnut|radish|balm|mint|weed)\b|\bhorsetail\b|\bhorseradish\b|\bdog[- ]?(wood|rose|fennel|grass)\b|\bdogwood\b",I)
PETX=re.compile(V2.PET.pattern+r"|\b(horses?|equine|ponies|pony|foals?|mares?)\b",I)
ANIMALPDP=re.compile(r"\b(for (your )?(horses?|dogs?|cats?|pets?)|equine|canine|feline|your (horse|dog|cat|pet)s?|(mix|top[- ]dress)\w*\s+(it\s+)?(with|into|on)\s+(daily\s+|the\s+)?(feed|ration|kibble|food bowl)|per horse|horse (supplements?|owners?|joints?))\b",I)
class _Pet:
    pattern=PETX.pattern
    def __init__(self,hero): self.hero=hero
    def search(self,t):
        t=t or ''
        t=HERBPET.sub(lambda m:' '*len(m.group(0)),t)
        if self.hero: t=re.sub(self.hero,lambda m:' '*len(m.group(0)),t,flags=I)
        return PETX.search(t)
def _withpet(shelf,fn,*a):
    p2,p3=V2.PET,V3.PET; P=_Pet(SH[shelf]['hero'])
    V2.PET=P; V3.PET=P
    try: return fn(*a)
    finally: V2.PET,V3.PET=p2,p3
HOMEO=re.compile(r"\bhomeopath\w*|\bhpus\b",I)
HPUS=re.compile(r"\bhpus\b|\b\d{1,4}\s?(?:C|X|CH)\s+HPUS\b")
POTENCY=re.compile(r"\b\d{1,4}\s?(C|X|CH|K)\b")
PELLET=re.compile(r"\b(pellets?|globules?|tablets?|dilution)\b",I)
HEALTHCAT=re.compile(r"^\s*(health|grocery|beauty|sports|baby|vitamins|home & kitchen > kitchen|amazon fresh|whole foods)",I)
SUPPSIG=re.compile(r"supplement|capsules?|caps\b|tablets?|softgels?|gumm(y|ies)|lozenges?|tinctures?|drops|extract|powder|servings?|vegan|organic|herbal|vitamin",I)
PARTPOW=re.compile(r"\b(roots?|leaf|leaves|herb|bark|seeds?|flowers?|berry|berries)\s+(powder(ed)?|pwd)\b|\b(powder(ed)?|pwd)\s+(roots?|leaf|herb|bark)\b",I)
NOTBULK=re.compile(r"\b(supplements?|capsules?|caps|tablets?|softgels?|gumm\w+|extract|servings?|scoops?|mg|mcg|lozenges?|drink mix)\b",I)
ROOTDESC=re.compile(r"\b(whole|dried|dry|raw|cut\s*(?:&|and)\s*sifted|c/s|sliced)\s+(roots?|herb|seeds?|leaf|leaves|bark|berry|berries|plant)\b|\b(root|herb|seed|leaf|berry)\s+(whole|slices)\b|\broot slices\b",I)
UNITCOUNT=re.compile(r"\b\d+\s*(?:count\s+|ct\s+)?(?:veg(?:gie|etarian|an)?\s+|vegetable\s+)?(capsules?|caps|vcaps|tablets?|tabs|softgels?|caplets?|gumm(?:y|ies))\b",I)
HELPER=re.compile(r"\b(mustard|myrosinase|enzymes?|lipase|protease|amylase|lactase|cellulase|black pepper|piper\w*|bioperine|mct|lecithin|carrier|oil)\b",I)
MINERALS=r"calcium|magnesium|zinc|iron|copper|selenium|chromium|manganese|potassium|sodium|molybdenum|boron|iodine"
COMPOUND=re.compile(r"[a-z]+(ate|ite|ide|ine)\b",I)
def _crumbs(x):
    c=x.get('crumbs') or ''
    return ' > '.join(c) if isinstance(c,list) else c
def _herostems(H):
    return sorted({l for l in _lits(H)}|{w for w in re.findall(r"[a-z]{4,}",re.sub(r'\\[bw]|\[[^\]]*\]','',H.lower()))},key=len,reverse=True)
def _coined(shelf,x):                                                          # Z9 R8-1
    H=SH[shelf]['hero']; t=x.get('title') or ''
    if re.search(H,t,I): return None
    for lit in _herostems(H):
        if ' ' in lit: continue
        for m in re.finditer(r"[A-Za-z]*"+re.escape(lit)+r"[A-Za-z]*",t,I):
            w=m.group(0)
            if w.lower()==lit or len(w)<=len(lit): continue
            i=w.lower().find(lit)
            camel=(i>0 and w[i].isupper()) or (i==0 and len(w)>len(lit) and w[len(lit)].isupper())
            if not camel: continue
            lead=_panel_lead(x); D=_panel_doses(x)
            leads=(lead and re.search(H,lead,I)) or (D and re.search(H,D[0][1],I))
            if not leads: continue
            return t[:m.start()]+(' '*i)+lit.capitalize()+(' '*(len(w)-i-len(lit)))+t[m.end():], w
    return None
def _hero_compound(shelf,x,t):                                                  # Z7
    sh=SH[shelf]; H=sh['hero']; forms='(?:'+sh['form']+('|'+sh['ofo'] if sh.get('ofo') else '')+r'|monomethionine|methionine|glycinate|bisglycinate)'
    srcs=[t,' | '.join(x.get('bullets') or []),re.split(r'(?i)other ingredients|inactive ingredients',x.get('ingredients') or '')[0]]
    for s in srcs:
        for m in re.finditer(r"(?:"+H+r")\s*(?:\(\s*(?:as|from)\s+(?:(?:"+H+r")\s+)?|(?:as|from)\s+(?:(?:"+H+r")\s+)?)?((?:l|d)[\s-]?)?([A-Za-z-]+)",s,I):
            w=m.group(2)
            if re.fullmatch(forms,w,I) or (COMPOUND.fullmatch(w) and not re.fullmatch(r'(supplements?|vitamine?|routine|online|medicine|wine|line|fine|daily|combine|blend)',w,I)):
                return w
    return None
def _base(shelf,x):
    """v9.6 classify body (Y1-Y5) with Z6; returns before Y6."""
    sh=SH[shelf]; x=dict(x)
    t0=x.get('title') or ''; t1=_fuzzy(shelf,t0); fz=t1!=t0
    if fz: x['title']=t1
    ok,code,det,f=V5.classify(shelf,x)
    if fz and det is not None: det=f'Y5 misspelled hero read as hero; {det}'
    t=x.get('title') or ''
    for _ in range(3):
        m=re.match(r'"(.+?)" named before hero',str(det))
        if code!='HERO_SECONDARY' or not m: break
        w=m.group(1).strip(); wc=w.strip('-–— ')
        mw=re.search(r"[\w-]*"+re.escape(wc)+r"[\w-]*",t,I); tok=mw.group(0) if mw else wc
        free=re.search(r'\b(no\s+)'+re.escape(wc)+r'\b|'+re.escape(wc)+r'\s*-?\s*free\b',t,I)
        if free:
            t2=_sub(r'\bno\s+'+re.escape(wc)+r'\b|'+re.escape(wc)+r'\s*-?\s*free\b',t); ok,code,det,f=_retry(shelf,x,t2,f'Y3 "{wc} free" = does not contain'); t=t2; x=dict(x,title=t2); continue
        if all(DESCW.match(z) for z in re.split(r'\s+',wc) if z):
            t2=_sub(r'(?<![\w-])'+re.escape(wc)+r'(?![\w-])',t); ok,code,det,f=_retry(shelf,x,t2,f'Y2 "{wc}" = descriptor'); t=t2; x=dict(x,title=t2); continue
        H=sh['hero']; W=re.escape(tok); pdp=_pdp(x)
        tied=len(tok.split())<=2 and (re.search(W+r'\s*[®™]?\s*\(\s*(?:a\s+)?(?:patented\s+|proprietary\s+)?(?:standardi[sz]ed\s+)?(?:extract|from|derived|sourced)\b[^)]{0,40}(?:'+H+')',pdp,I) or \
             re.search(W+r'\s*[®™][^.|;]{0,40}(?:'+H+')',pdp,I) or re.search(W+r'[^.|;]{0,30}\b(?:is|are)\b[^.|;]{0,30}\b(?:extracted|derived|sourced|made)\s+from\s+(?:\w+\s+){0,2}(?:'+H+')',pdp,I))
        if tied and len(tok)>=3:
            t2=_sub(r'(?<![\w-])'+W+r'(?![\w-])\s*[®™]?',t); ok,code,det,f=_retry(shelf,x,t2,f'Y1 "{tok}" = branded form of hero'); t=t2; x=dict(x,title=t2); continue
        break
    if code=='EX_NOT_SUPPLEMENT' and re.search(r'bulk_herb|whole-food',str(det)) and (re.search(r'\d[\d.,]*\s*(mg|mcg)\b',t,I) or UNITCOUNT.search(t)):   # Y4 + Z6
        t2=t; n=0
        for mw in ROOTDESC.finditer(t): t2=_blank(t2,mw.start(),mw.end()); n+=1
        if n:
            ok2,code2,det2,f2=_retry(shelf,x,t2,'Z6 root/herb descriptor with per-unit dose or counted oral unit = supplement')
            if not (code2=='EX_NOT_SUPPLEMENT' and re.search(r'bulk_herb|whole-food',str(det2))): ok,code,det,f=ok2,code2,det2,f2
    return ok,code,det,f,t,x
def _classify(shelf,x):
    x=norm(x); sh=SH[shelf]; H=sh['hero']; cls=sh.get('cls')
    t0=ncomma(x.get('title') or ''); cr=_crumbs(x); bl=' | '.join(x.get('bullets') or [])
    ing=(x.get('ingredients') or '').strip()
    mh=HOMEO.search(t0) or HPUS.search(ing) or HPUS.search(bl) or (POTENCY.search(t0) and PELLET.search(t0+' '+str(x.get('item_form') or '')))
    if mh: return False,'EX_NOT_SUPPLEMENT','Z3 homeopathic: '+mh.group(0),fmt_of(t0)   # Z3
    if not re.search(r'ingredients?',ing,I) and cr and not HEALTHCAT.search(cr) and not SUPPSIG.search(t0+' '+bl) and not DOSE2.search(t0):   # Z4
        return False,'EX_NOT_SUPPLEMENT','Z4 no ingredients / supplement signal; category '+cr[:40],fmt_of(t0)
    pre=''; c=_coined(shelf,x)                                                   # Z9
    if c: x=dict(x,title=c[0]); pre=f'Z9 R8-1 coined "{c[1]}" names hero (label lead = hero); '
    ok,code,det,f,t,x=_base(shelf,x)
    if pre: det=pre+(det or '')
    if code=='EX_PET' or not ok: return ok,code,det,f
    mp=_Pet(H).search(t)                                                         # Z2
    if mp and not V2.HUMANS.search(t): return False,'EX_PET','Z2 animal word in title: '+mp.group(0),f
    if not V2.HUMANS.search(t):
        pdp=HERBPET.sub(' ',bl)
        ma=ANIMALPDP.search(pdp)
        if ma and (cr.lower().startswith('pet supplies') or len(ANIMALPDP.findall(pdp))>=2): return False,'EX_PET','Z2 animal product (category/PDP): '+ma.group(0),f
    if f in (None,'powder') and PARTPOW.search(t) and WEIGHT.search(t) and not DOSE2.search(t) and not NOTBULK.search(t) and not UNITCOUNT.search(t):   # Z5
        return False,'EX_NOT_SUPPLEMENT','Z5 bulk herb-part powder by weight, no dose (R5-4)',f
    if sh.get('form'):                                                           # Z7
        mf=list(re.finditer(sh['form'],t,I))
        if mf and all(re.search(r'\b('+MINERALS+r')\s*$',t[:m.start()],I) and not re.search(H+r'\s*$',t[:m.start()],I) for m in mf):
            tm=t
            for m in mf: tm=_blank(tm,m.start(),m.end())
            w=_hero_compound(shelf,x,tm)
            if w and not re.fullmatch(sh['form'],w,I): return False,'EX_FORM_MISMATCH',f'Z7 shelf form belongs to another mineral; hero form "{w}"',f
    D=_panel_doses(x)                                                            # Y6 + Z10
    micro=bool(VITMIN.search(shelf)) or bool(sh.get('form'))
    hi=[i for i,d in enumerate(D) if re.search(H,d[1],I)]
    if D and hi and not micro:
        hd=D[hi[0]]
        if re.search(r'\b(hdu|cfu|fu|iu|spu|dpp-?iv|alu|units?|billion)\b',hd[1]+' '+hd[3],I): hd=(hd[0],hd[1],None,'')
        heads={l.split()[0] for l in _lits(H) if len(l.split()[0])>=5}
        for d in D[:hi[0]]:
            if any(re.search(r'\b'+re.escape(h)+r'\b',d[1],I) for h in heads): break
            if VITMIN.search(d[0]) or BLENDW.search(d[0]) or (cls and re.search(cls,d[0],I)) or d[2] is None or hd[2] is None: continue
            if HELPER.search(d[0]) or HELPER.search(d[1]): continue
            if d[2]>hd[2]: return False,'HERO_SECONDARY',f'Y6 R7-1 label lead "{d[0][:30]}" {d[2]:g} mg > hero {hd[2]:g} mg',f
            break
    if not DOSE2.search(re.split(r'(?i)other ingredients|inactive ingredients|directions',x.get('ingredients') or '')[0]):
        mh=re.search(H,t,I)
        if mh:
            lk=list(re.finditer(r'\bwith\b|\+',t[:mh.start()],I))
            if lk and not re.search(r'[,|]',t[lk[-1].end():mh.start()]) and len(t[lk[-1].end():mh.start()].split())<=2:
                pre_=(V5.V4.strip_brand(t[:lk[-1].start()],x) or '').strip(' -|,')
                lead=_panel_lead(x)
                if pre_ and re.search(r'[A-Za-z]{2,}',pre_) and not V5.DESCR.search(pre_) and lead and not re.search(H,lead,I) and not (cls and re.search(cls,lead,I)) and not HELPER.search(lead):
                    return False,'HERO_SECONDARY',f'Y6 R6-1/R7-1 coined "{pre_[-25:]}" + hero, undosed label lead "{lead[:30]}"',f
    return ok,code,det,f
def classify(shelf,x): return _withpet(shelf,_classify,shelf,x)
TABS=re.compile(r"\b\d+\s*(tabs?|tablets?|capsules?|caps|vcaps|softgels?|gumm(y|ies)|count|ct|pieces?|lozenges?)\b|\(\s*\)",I)
def _ntitle2(p,keys):
    return ' '.join(re.findall(r'[a-z0-9]+',TABS.sub(' ',ntitle(brand_strip2(p['title'],p,keys)))))
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
            if gp and k.get('fmt') and gp!=k.get('fmt'): continue
            if _samebf(p,k) and _org(p['title'])!=_org(k['title']): continue
            if dp and any(dconf(d,dp) for d in members[k['asin']]): continue
            bk=ebrands(k,shelf_brands)|{bkey((k.get('brand') or '').lower())}-{''}; vk=set(k.get('variant_asins') or [])|{k['asin']}
            same_b=bool(bp&bk) or _samebf(p,k); real_p=bkey(p.get('brand')) not in GENERIC_BRAND|{''}; real_k=bkey(k.get('brand')) not in GENERIC_BRAND|{''}
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
            a,b=_segtok(p,bp|bk),_segtok(k,bp|bk)
            if a and b and min(len(a),len(b))>=5 and (a<=b or b<=a) and fp==fmt_of(k['title']): hit=(k,'same brand + name segment contained in the other'); break
            dk=hero_dose(dict(k,title=_thou(k['title'])),hero)
            if dp and dk and dp[:2]==dk[:2] and fp==fmt_of(k['title']) and bool(PACKM.search(p['title']))!=bool(PACKM.search(k['title'])):
                hit=(k,'same brand + same dose/format, multipack of the single'); break
            if dp and dk and dp[:2]==dk[:2] and _ntitle2(p,bp|bk) and _ntitle2(p,bp|bk)==_ntitle2(k,bp|bk): hit=(k,'Z8 same brand + same name/dose, different pack count'); break
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
