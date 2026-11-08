r"""Competitor-set gate v10.0 (2026-11-01; addendum 15). Follows SHELF_RULEBOOK.md rulebook_v2.2 (v2.1 + Gautam R11-1 + NPD settles).
Imports frozen gate_v99.py (not modified; through it v98..v92) and wraps classify / run_shelf / add_holdout_specs. General rules only
(no ASIN or brand lists):
 C1 R11-1 trademark ingredient names: the trademark table is parsed from the rulebook ("Trademark ingredient table"); a listing whose
    title (or label) uses a trademark mapped to the shelf hero/form gets the generic hero/form words written next to the trademark
    before classification ("ChromeMate" -> "ChromeMate (chromium polynicotinate)"). Only the missing generic words are added.
 C2 Personal care: body wash / face wash / toner / cleanser / serum / lotion / shampoo / conditioner / soap / cream / mask / scrub /
    moisturizer / balm / deodorant / ointment in the title (or a Beauty & Personal Care category with no oral-supplement word) =
    EX_TOPICAL, unless the title names an oral supplement form or "supplement" ("Skin Support Capsules").
 C3 Bulk (R5-4): on plain-herb shelves (no form, not a powder-format shelf, not a vitamin/mineral hero), a title with no
    extract/tincture/oral-form word and no mg/mcg/IU or per-serving dose (title or label actives) is EX_NOT_SUPPLEMENT when it says
    "Root Cut" / "Cut & Sifted" / "C/S", or (title has a botanical word: root/leaf/bark/herb/berry/seed/flower/organic/whole, and no
    count / liquid / oil) it is a powder sold by the pound (lb / kg / >=16 oz) or a weight-only pouch/bag.
 C4 R5-3 coined formula with the hero as an add-in: no label panel, the hero first appears after "with/plus/featuring", the text before
    it holds no hero word but holds a coined name (CamelCase / CAPS-Hyphen / TM) AND either a formula word (formula, agent,
    partitioning, disposal, complex, stack, blend, supplement) or a v9.9 co-lead that is an amino acid (glycine, taurine...) =
    HERO_SECONDARY. An amino acid is never the co-lead that makes such a formula HERO_LED_COMPLEX.
 C5 Spec hygiene + lint: holdout spec hero/form regexes have trademark alternatives removed at load (C1 maps them), and descriptor
    alternatives (GTF / glucose tolerance factor / niacin-bound) and the shelf form itself are removed from "other forms". lint_specs()
    reports any such entry; the freeze script refuses to freeze specs with lint findings."""
import re,sys,os,json
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))

from gate_v99 import *            # noqa: F401,F403
from gate_v99 import SH,ncomma,VITMIN,collapse,sold,norm9
import gate_v99 as V99
I=re.I
_D=os.path.dirname(os.path.abspath(__file__))
# ---------- C1 trademark table (parsed from the rulebook)
def _tm_table(path=os.path.join(_D,'SHELF_RULEBOOK.md')):
    s=open(path).read(); s=s.split('### Trademark ingredient table')[1].split('\n## ')[0]
    out=[]
    for line in s.splitlines():
        c=[z.strip() for z in line.strip().strip('|').split('|')]
        if len(c)!=3 or c[0] in ('Trademark','---') or set(c[0])<=set('-'): continue
        hero=None if c[1] in ('—','-','') else c[1]; form=None if c[2] in ('—','-','') else c[2]
        for name in c[0].split(' / '):
            toks=[re.escape(t) for t in re.split(r'[\s\-]+',name.strip()) if t]
            rx=r'(?<![A-Za-z0-9])'+r'[\s\-]?'.join(toks)+r'(?:\s*[®™])?(?![A-Za-z0-9])'
            out.append(dict(name=name.strip(),rx=re.compile(rx,I),hero=hero,form=form))
    return out
TM=_tm_table()
def _tm_inject(shelf,x):
    sh=SH[shelf]; H=sh['hero']; F=sh.get('form')
    t=x.get('title') or ''; changed=False; y=dict(x)
    for tm in TM:
        add=[]
        if tm['hero'] and re.search(H,tm['hero'],I) and not re.search(H,t,I): add.append(tm['hero'])
        if F and tm['form'] and re.search(F,tm['form'],I) and not re.search(F,t,I) and (tm['hero'] or re.search(H,t,I)): add.append(tm['form'])
        if not add: continue
        for k in ('title','ingredients'):
            v=y.get(k)
            if isinstance(v,str) and tm['rx'].search(v):
                y[k]=tm['rx'].sub(lambda m:m.group(0)+' ('+' '.join(add)+')',v,count=1); changed=True
        if changed: t=y.get('title') or ''
    return y,changed
# ---------- C5 spec hygiene + lint
DESCR=re.compile(r'^(gtf|glucose tolerance factor|niacin.{0,4}bound)$',I)
def _alts(rx):
    out=[]; d=0; cur=''
    for ch in rx:
        if ch in '([': d+=1
        elif ch in ')]': d-=1
        if ch=='|' and d==0: out.append(cur); cur=''
        else: cur+=ch
    out.append(cur); return out
def _lit(a): return re.sub(r'\\[bw]|[\\^$?*+.()\[\]{}]','',a).replace('-',' ').strip().lower()
def _is_tm(a): return any(tm['rx'].fullmatch(_lit(a)) or _lit(a).replace(' ','')==tm['name'].lower().replace('-','').replace(' ','') for tm in TM)
def lint_specs(specs):
    """specs: dict shelf -> {hero, form, ofo, ...}; returns a list of findings (empty = clean)."""
    bad=[]
    for k,v in specs.items():
        for fld in ('hero','form'):
            for a in _alts(v.get(fld) or ''):
                if a and _is_tm(a): bad.append(f'{k}: {fld} lists trademark "{a}" (use the rulebook trademark table)')
        for a in _alts(v.get('ofo') or ''):
            if a and DESCR.match(_lit(a)): bad.append(f'{k}: ofo lists descriptor "{a}"')
            if a and v.get('form') and re.fullmatch(v['form'],_lit(a),I): bad.append(f'{k}: ofo lists the shelf form "{a}"')
            if a and _is_tm(a): bad.append(f'{k}: ofo lists trademark "{a}"')
    return bad
def _clean(v):
    v=dict(v)
    for fld in ('hero','form'):
        if v.get(fld):
            keep=[a for a in _alts(v[fld]) if not _is_tm(a)]; v[fld]='|'.join(keep) if keep else v[fld]
    if v.get('ofo'):
        v['ofo']='|'.join(a for a in _alts(v['ofo']) if not DESCR.match(_lit(a)) and not _is_tm(a) and not (v.get('form') and re.fullmatch(v['form'],_lit(a),I))) or None
    return v
def add_holdout_specs(path):
    V99.add_holdout_specs(path)
    for k,v in json.load(open(path)).items():
        c=_clean(v)
        for fld in ('hero','form','ofo'):
            if (v.get(fld) or None)!=(c.get(fld) or None): SH[k][fld]=V99.apos(c[fld]) if fld=='hero' and c.get(fld) and "'" in c[fld] else c.get(fld)
# ---------- C2 personal care
TOPW=re.compile(r"\b(body\s*wash|face\s*wash|facial\s*wash|toners?|cleansers?|cleansing\s+(?:oil|balm|foam|gel)|serums?|lotions?|shampoos?|conditioners?|soaps?|creams?|masks?|scrubs?|moisturi[sz]ers?|(?:lip|body|face)\s*balms?|deodorants?|ointments?|body\s*butter|hair\s*oil|face\s*oil|bath\s*(?:bombs?|salts?))\b",I)
ORALW=re.compile(r"\b(capsules?|caps|vcaps|veg\s*caps|tablets?|softgels?|gumm(?:y|ies)|chewables?|pills?|caplets?|lozenges?|dietary\s+supplement|supplements?|tea\s*bags?|drink\s+mix)\b",I)
BEAUTY=re.compile(r"^\s*beauty\s*&\s*personal care",I)
def _topical(x):
    t=x.get('title') or ''
    if ORALW.search(t): return None
    m=TOPW.search(t)
    if m and not re.search(r"\bice\s+cream|cream\s+of\s+tartar|creamer\b",t,I): return m.group(0)
    if BEAUTY.search(str(x.get('crumbs') or '')) and not ORALW.search(' '.join(x.get('bullets') or []) if isinstance(x.get('bullets'),list) else str(x.get('bullets') or '')): return 'Beauty & Personal Care category'
    return None
# ---------- C3 bulk (botanical, no dose)
CUTW=re.compile(r"\b(?:root|bark|leaf|leaves|herb|flowers?)\s+cut\b|\bcut\s*(?:&|and|/)\s*sifted\b|\bc\s*/\s*s\b|\bcut\s+(?:root|bark|leaf)\b",I)
WT=re.compile(r"\b(\d+(?:\.\d+)?)\s*(lbs?|pounds?|oz|ounces?|kg|kilograms?|g|grams?)\b",I)
COUNTW=re.compile(r"\b\d+\s*(?:count|ct|caps|capsules?|tablets?|softgels?|gummies|pieces|tea\s*bags|bags|sachets|sticks|packets)\b|\bfl\.?\s*oz\b|\b\d+\s*ml\b|\bliquid\b|\boil\b|\bglycerite\b",I)
DOSEW=re.compile(r"\b\d[\d.,]*\s*(mg|mcg|µg|iu)\b|\b\d[\d.,]*\s*g\s*(?:per|/)\s*serv|\bservings?\b|\bper\s+serving\b",I)
BOTAN=re.compile(r"\b(root|roots|leaf|leaves|bark|herb|herbs|herbal|berry|berries|seeds?|flowers?|rhizome|organic|wildcrafted|whole)\b",I)
POUCH=re.compile(r"\b(pouch|resealable|bag)\b",I)
def _bulk(shelf,x):
    sh=SH[shelf]; H=sh['hero']
    if sh.get('form') or (sh.get('fmt') or '') in ('powder',) or re.search(r'magnes|zinc|iron|calcium|chromium|selen|potassium|copper|iodine|boron|manganese|vitamin',H,I): return None
    t=x.get('title') or ''
    if re.search(r'\bextracts?\b|\btinctures?\b|\bdrops\b',t,I) or ORALW.search(t): return None
    act=re.split(r'(?i)other ingredients|inactive ingredients|\bdirections\b',x.get('ingredients') or '')[0]
    if DOSEW.search(t) or re.search(r"\b\d[\d.,]*\s*(mg|mcg|µg|iu)\b",act,I): return None
    if CUTW.search(t): return 'cut herb ('+CUTW.search(t).group(0)+')'
    if not BOTAN.search(t) or COUNTW.search(t): return None
    w=[(float(m.group(1)),m.group(2).lower()) for m in WT.finditer(t)]
    lb=any(u.startswith(('lb','pound','kg','kilo')) or (u.startswith(('oz','ounce')) and n>=16) for n,u in w)
    if re.search(r'\bpowder\b',t,I) and lb: return 'bulk herb powder by the pound, no dose'
    if w and POUCH.search(t): return 'weight-only pouch, no dose'
    return None
# ---------- C4 coined formula + hero as add-in, no panel
AMINO=re.compile(r"^(?:l-?\s*)?(glycine|taurine|glutamine|arginine|leucine|isoleucine|valine|alanine|lysine|tyrosine|methionine|cysteine|carnitine|citrulline|ornithine|serine|proline|histidine|threonine|tryptophan|phenylalanine)$",I)
COINED=re.compile(r"\b[A-Z][a-z]+[A-Z]\w*\b|\b[A-Z]{2,}-[A-Z][a-z]+\b|\b[A-Z][a-z]+-[A-Z]{2,}\b|[™®]")
FORMW=re.compile(r"\b(formula|formulations?|agent|partitioning|disposal|complex|stack|matrix|system|blend|supplement)\b",I)
def _coined_addin(shelf,x,tb,lead=None):
    H=SH[shelf]['hero']
    ing=str(x.get('ingredients') or '')
    if ing.strip() and ing.strip().lower()!='none': return None
    mh=re.search(H,tb,I)
    if not mh: return None
    pre=tb[:mh.start()]
    mw=re.search(r"\b(with|plus|featuring|added|contains)\b[^,|]{0,25}$",pre,I)
    if not mw: return None
    head=pre[:mw.start()]
    if re.search(H,head,I): return None
    c=COINED.search(head); fw=FORMW.search(head)
    amino_lead=bool(lead and AMINO.match(lead.strip()))
    if c and (fw or amino_lead): return c.group(0)
    return None
def classify(shelf,x):
    y,tmc=_tm_inject(shelf,x)
    ok,code,det,f=V99.classify(shelf,y)
    if tmc: det='C1 trademark ingredient name (R11-1); '+str(det)
    if not ok and code in ('EX_TOPICAL','EX_NOT_SUPPLEMENT','EX_PET','EX_INFANT','EX_KIDS'): return ok,code,det,f
    tp=_topical(y)
    if tp: return False,'EX_TOPICAL',f'C2 personal-care product ({tp})',f
    if ok:
        b=_bulk(shelf,y)
        if b: return False,'EX_NOT_SUPPLEMENT',f'C3 R5-4 {b}',f
        t=ncomma(y.get('title') or ''); tb=V99.V7.V5.V4.strip_brand(t,y) or t
        c=_coined_addin(shelf,y,tb,lead=str(det).split(';')[0] if code=='HERO_LED_COMPLEX' else None)
        if c: return False,'HERO_SECONDARY',f'C4 R5-3 coined formula "{c}" with hero as add-in, no label panel',f
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
