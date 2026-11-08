"""Competitor-set gate v8.1 (2026-10-28; addendum 4). v8.0 kept as gate_v8_0.py. Pre-registered in fork/EVALS_PREREG_ADDENDUM_3_2026-10-28.md.
Rules (applied to every page-1 listing BEFORE ranking by sales):
 R4 exclusions: EX_PET, EX_INFANT, EX_TOPICAL, EX_NOT_SUPPLEMENT (tea/coffee/food/bulk herb/books/seeds), EX_UNRELATED_BUNDLE
 R1 hero: EX_HERO_MISSING; hero must lead (named first after brand / product named for it):
        HERO_LED_COMPLEX (include, other actives named after hero) vs HERO_SECONDARY (exclude, another active leads)
 R2 form (only when shelf names one): EX_FORM_MISMATCH (form absent), EX_FORM_BLEND (another form of same compound named)
 R3 format (only when shelf names one): EX_FORMAT_MISMATCH (first format word in title is another format), EX_FORMAT_UNSTATED
 R5 variant collapse: EX_VARIANT_DUP (same ASIN; or same brand-prefix + same normalised line; or identical review count>=50 with
        title-token Jaccard>=0.5). Keep the best-selling variant (sold desc, then position).
 IN_OK / HERO_LED_COMPLEX = included.
Data limit: the Apify axesso search scrape has no item-form field and no parent ASIN, so format and variant are read from the title.
"""
import re,sys,os
sys.path.insert(0,os.path.join(os.path.dirname(__file__),'..'))
from relevance import LEX as _LEX
LEX=list(_LEX)+[r'ferritin',r'sunfiber|\bguar\b',r'polypodium',r'pentadecanoic|\bc15\b',r'tributyrin',r'thymoquinone',r'tocotrienols?',
    r'\b(hist)?dao\b|diamine oxidase',r'la[ck]toferrin',r'chanca piedra',r'lipoic',r'\bhesperidin\b',r'pomegranate',r'urolithin',r'bladderwrack',r'burdock',
    r'cassia',r'milk thistle',r'akkermansia',r'bitter melon',r'cranactin',r'vitamin b6|\bb6\b|p-5-p|p5p',r'\bmct oil\b',r'hops?\b',r'saffron',r'kava']
LEXR=[re.compile(x,re.I) for x in LEX]
I=re.I
PET=re.compile(r"\b(dogs?|cats?|pets?|canine|feline|pupp(y|ies)|kittens?|equine|livestock|poultry)\b(?!'s claw)(?! friendly)|\bfor horses\b",I)
INFANT=re.compile(r"\b(infants?|baby|babies|newborns?|toddlers?|enfamil|similac|infant formula|baby formula)\b",I)
TOPICAL=re.compile(r"\b(cream|lotion|serum|ointment|balm|shampoo|conditioner|soap|cleanser|face wash|moisturi[sz]er|sunscreen|spf ?\d+|roll[- ]on|topical|skin ?care|toothpaste|mouthwash|eye drops|nasal spray|massage oil|hair oil|body oil|essential oil|face mask)\b",I)
NONSUP={'tea':re.compile(r"\b(tea|teas|tea ?bags?|teabags|tisane)\b",I),
        'coffee':re.compile(r"\b(coffee|creamer|latte|espresso)\b",I),
        'food':re.compile(r"\b(cooking|culinary|seasoning|spices?|baking|cereal|snacks?|candy|candies|chips|juice|marshmallows|recipes?|ground cinnamon|cinnamon sticks?)\b",I),
        'bulk_herb':re.compile(r"\b(cut (and|&) sifted|c/s|loose leaf|dried root|whole root|root slices|raw root)\b",I),
        'other':re.compile(r"\b(book|paperback|hardcover|kindle|cookbook|seeds? for planting|planting|garden seeds|heirloom seeds|live plant|t-?shirt|mug|test kit|test strips)\b",I)}
USAGE=re.compile(r"\b(for|in|into|to|perfect|add|mix|smoothies?|recipes?|drinks?|beverages?)\b",I)
BUNDLE=re.compile(r"\b(bundle|variety pack|kit|combo pack|set of)\b",I)
FMT=[('gummy',r"gumm(y|ies)"),('chew',r"soft[- ]?chews?|\bchews?\b(?!able)"),  # v8.1: chews are their own format (not gummies)
     ('pill',r"capsules?|\bcaps\b|vcaps?|veg[- ]?caps|tablets?|softgels?|soft gels|caplets?|\bpills?\b|chewable tablets?|lozenges?"),
     ('powder',r"powder|\bground\b|drink mix|stick packs?|\bscoops?\b"),
     ('liquid',r"liquid|\bdrops\b|tincture|syrup|\bshots?\b|elixir|fl\.? ?oz|\bml\b"),
     ('gel',r"\bgel\b"),('tea',r"\btea\b(?!\s+(leaf\s+)?extract)|tea ?bags?"),('coffee',r"\bcoffee\b")]
FMTR=[(k,re.compile(v,I)) for k,v in FMT]
def fmt_of(t):
    best=None
    for k,rx in FMTR:
        m=rx.search(t)
        if m and (best is None or m.start()<best[1]): best=(k,m.start())
    return best[0] if best else None
MAGF=r"citrate|oxide|malate|threonate|taurate|taurinate|chloride|sulfate|orotate|lactate|aspartate|carbonate|hydroxide|gluconate|picolinate|triple|\btri-|\b\d ?(in ?1|x)\b|multi[- ]?magnesium|\b\d forms?\b|full spectrum"
BLEND_BEFORE=r"magnesium (complex|blend)"  # counts as a blend only when named before the shelf form ("Magnesium Complex with ... glycinate")
def S(kw,hero,form=None,ofo=None,fmt=None,req=None,cls=None,allow=()):
    return dict(kw=kw,hero=hero,form=form,ofo=ofo,fmt=fmt,req=req,cls=cls,allow=set(allow))
SH={
 'lactoferrin':S('lactoferrin',r'la[ck]toferrin'),
 'diosmin':S('diosmin',r'diosmin'),
 'saccharomyces boulardii':S('saccharomyces boulardii',r'boulardii|saccharomyces',cls=r'probiotics?\b|prebiotics?\b'),
 'cayenne pepper capsules':S('cayenne pepper capsules',r'cayenne|capsaicin|capsicum',fmt='pill'),
 'dandelion root':S('dandelion root',r'dandelion'),
 'creatine electrolytes':S('creatine electrolytes',r'creatine',fmt='powder',req=r'electrolytes?|hydration',cls=r'electrolytes?'),
 'polypodium leucotomos':S('polypodium leucotomos',r'polypodium|fernblock|fern extract'),
 'sunfiber':S('sunfiber',r'sunfiber|partially hydrolyzed guar|\bphgg\b|guar',cls=r'\bfiber\b|prebiotics?\b'),
 'andrographis':S('andrographis',r'andrographis'),
 'l citrulline powder':S('l citrulline powder',r'citrulline',ofo=r'malate|\bdl-',fmt='powder'),
 'glynac':S('glynac',r'glynac|\bglycine\b',req=r'glynac|\bnac\b|n-acetyl',cls=r'\bnac\b|n-acetyl'),
 'iron bisglycinate':S('iron bisglycinate',r'\biron\b|ferrous|ferrochel',form=r'bisglycinate|glycinate|ferrochel',ofo=r'sulfate|fumarate|gluconate|carbonyl|polysaccharide|heme iron|ferric|succinylate'),
 'gentle iron':S('gentle iron',r'\biron\b|ferrous|ferrochel'),
 'butyrate':S('butyrate',r'butyrate|butyric|tributyrin'),
 'palmitoylethanolamide':S('palmitoylethanolamide',r'palmitoylethanolamide|\bpea\b|levagen'),
 'horse chestnut extract':S('horse chestnut extract',r'horse chestnut|aescin|escin'),
 'bitter melon':S('bitter melon',r'bitter melon|momordica|karela|bitter gourd'),
 'liposomal magnesium glycinate':S('liposomal magnesium glycinate',r'magnes\w*',form=r'glycinate',ofo=MAGF,req=r'liposom'),
 'hawthorn berry':S('hawthorn berry',r'hawthorn|crataegus'),
 'gaba':S('gaba',r'\bgaba\b|gamma[- ]amino|pharmagaba'),
 'dim supplement':S('dim supplement',r'\bdim\b|diindolylmethane'),
 'epicatechin':S('epicatechin',r'epicatechin'),
 'liposomal iron':S('liposomal iron',r'\biron\b|ferrous',req=r'liposom|sucrosom'),
 'oregano oil and black seed oil':S('oregano oil and black seed oil',r'oregano|black seed|nigella',req=r'(?=.*oregano)(?=.*(black seed|nigella))'),
 'pentadecanoic acid':S('pentadecanoic acid',r'pentadecanoic|\bc15|fatty15'),
 'curcumin phytosome':S('curcumin phytosome',r'curcumin',form=r'phytosome|meriva',cls=r'turmeric'),
 'holy basil':S('holy basil',r'holy basil|tulsi|ocimum'),
 'ginseng':S('ginseng',r'ginseng|ginsenoside|panax'),
 'mucuna pruriens':S('mucuna pruriens',r'mucuna|l-dopa|velvet bean'),
 'magnesium glycinate powder':S('magnesium glycinate powder',r'magnes\w*',form=r'glycinate',ofo=MAGF,fmt='powder'),
 'reishi mushroom capsules':S('reishi mushroom capsules',r'reishi|ganoderma',fmt='pill',cls=r'mushrooms?\b'),
 'mushroom coffee':S('mushroom coffee',r'mushrooms?|lion.?s mane|chaga|reishi|cordyceps',req=r'coffee',cls=r"lion.?s mane|chaga|reishi|cordyceps|turkey tail",allow=('coffee',)),
 'berberine phytosome':S('berberine phytosome',r'berberine',form=r'phytosome'),
 'taurine powder':S('taurine powder',r'taurine',fmt='powder'),
 'beef protein powder':S('beef protein powder',r'\bbeef\b',req=r'protein',fmt='powder',cls=r'\bprotein\b'),
 'glucomannan':S('glucomannan',r'glucomannan|konjac'),
 'pine pollen':S('pine pollen',r'pine pollen'),
 'shatavari':S('shatavari',r'shatavari|asparagus racemosus'),
 'luteolin':S('luteolin',r'luteolin'),
 'r alpha lipoic acid':S('r alpha lipoic acid',r'lipoic|\br-?ala\b',form=r'\br[- ]?(alpha|ala|lipoic)|r-ala|na-?rala|\br\(\+\)'),
 'pregnenolone':S('pregnenolone',r'pregnenolone'),
 'tributyrin':S('tributyrin',r'tributyrin',cls=r'butyrate|butyric'),
 'thymoquinone':S('thymoquinone',r'thymoquinone|black seed|nigella|black cumin|kalonji'),
 'magnesium glycinate gummies':S('magnesium glycinate gummies',r'magnes\w*',form=r'glycinate',ofo=MAGF,fmt='gummy'),
 'sea moss gummies':S('sea moss gummies',r'sea ?moss|irish moss',fmt='gummy'),
 'creatine gummies':S('creatine gummies',r'creatine',fmt='gummy'),
 'berberine gummies':S('berberine gummies',r'berberine',fmt='gummy'),
 'potassium citrate':S('potassium citrate',r'potassium',form=r'citrate',ofo=r'gluconate|chloride|bicarbonate|iodide|aspartate|orotate|glycinate|carbonate|phosphate'),
 'ceylon cinnamon powder':S('ceylon cinnamon powder',r'cinnamon',form=r'ceylon|true cinnamon|cinnamomum verum|zeylanicum',ofo=r'cassia|saigon|korintje',fmt='powder',allow=('food',)),
 'dao enzyme':S('dao enzyme',r'\b(hist)?dao\b|diamine oxidase'),
 'citicoline':S('citicoline',r'citicoline|cdp[- ]?choline|cognizin',cls=r'\bcholine\b'),
 'tudca':S('tudca',r'tudca|tauroursodeoxycholic'),
 'pumpkin seed oil capsules':S('pumpkin seed oil capsules',r'pumpkin seed',fmt='pill'),
 'paraxanthine':S('paraxanthine',r'paraxanthine|enfinity'),
 'l citrulline':S('l citrulline',r'citrulline',ofo=r'malate|\bdl-'),
 'tocotrienols':S('tocotrienols',r'tocotrienol',cls=r'tocopherols?|vitamin e\b'),
 'lithium orotate':S('lithium orotate',r'lithium',form=r'orotate',ofo=r'aspartate|citrate|carbonate'),
 'magnesium taurate':S('magnesium taurate',r'magnes\w*',form=r'taurate|taurinate|tauromag',ofo=MAGF.replace('taurate|taurinate|','')),
 'lemon balm':S('lemon balm',r'lemon balm|melissa'),
 'slippery elm':S('slippery elm',r'slippery elm|ulmus'),
 'marshmallow root':S('marshmallow root',r'marshmallow|althaea'),
 'chanca piedra':S('chanca piedra',r'chanca piedra|phyllanthus|stone breaker'),
 'd mannose':S('d mannose',r'mannose'),
}
def _spans(rx,t): return [m.span() for m in re.finditer(rx,t,I)]
def classify(sh,title):
    """returns (include:bool, code:str, detail:str, fmt:str|None)"""
    t=title or ''; f=fmt_of(t)
    if PET.search(t): return False,'EX_PET',PET.search(t).group(0),f
    if INFANT.search(t): return False,'EX_INFANT',INFANT.search(t).group(0),f
    _hs=_spans(sh['hero'],t)  # addendum 3b: a topical word inside the hero name ("lemon balm") is not a topical product
    for m in TOPICAL.finditer(t):
        if any(a<=m.start()<b for a,b in _hs): continue
        w=m.group(0).lower()
        if w=='balm' and re.search(r'lemon\s+$',t[:m.start()],I): continue  # v8.1: "lemon balm" is an ingredient
        if w.replace(' ','') in ('skincare',) and re.search(r'supplement|capsules?|softgels?|tablets?|gumm(y|ies)',t,I): continue  # v8.1: oral "skin care supplement"
        return False,'EX_TOPICAL',m.group(0),f
    for k,rx in NONSUP.items():
        if k in sh['allow']: continue
        for m in rx.finditer(t):
            if k in ('tea','coffee','food') and USAGE.search(t[max(0,m.start()-40):m.start()]): continue  # usage mention ("for cooking, coffee & tea")
            if k=='tea' and re.match(r'\s*(leaf\s+)?extract',t[m.end():],I): continue  # v8.1: "green tea extract" is an ingredient
            if k=='food' and m.group(0).lower().startswith('recipe') and _hs and m.start()<_hs[0][0]: continue  # v8.1: brand name ("Doctor's Recipes")
            return False,'EX_NOT_SUPPLEMENT',f'{k}:{m.group(0)}',f
    hs=_spans(sh['hero'],t)
    if not hs: return False,'EX_HERO_MISSING','hero term absent',f
    if sh['req'] and not re.search(sh['req'],t,I): return False,'EX_HERO_MISSING','shelf co-term absent: '+sh['req'],f
    # hero-lead test: earliest other active (not hero, not hero class word, not shelf co-term) vs earliest hero
    masked=t
    for rx in [sh['hero']]+([sh['cls']] if sh['cls'] else [])+([sh['req']] if sh['req'] and '(?=' not in sh['req'] else []):
        masked=re.sub(rx,lambda m:' '*len(m.group(0)),masked,flags=I)
    others=[]
    for rx in LEXR:
        m=rx.search(masked)
        if m: others.append((m.start(),m.group(0)))
    h0=hs[0][0]
    lead_other=[o for o in others if o[0]<h0]
    if lead_other:
        o=min(lead_other); return False,'HERO_SECONDARY',f'"{o[1]}" named before hero',f
    if BUNDLE.search(t) and others: return False,'EX_UNRELATED_BUNDLE',BUNDLE.search(t).group(0),f
    if sh['form']:
        if not re.search(sh['form'],t,I): return False,'EX_FORM_MISMATCH','shelf form absent',f
        if sh['ofo'] and re.search(sh['ofo'],t,I): return False,'EX_FORM_BLEND',re.search(sh['ofo'],t,I).group(0),f
        mb=re.search(BLEND_BEFORE,t,I); mf=re.search(sh['form'],t,I)
        if mb and mb.start()<mf.start(): return False,'EX_FORM_BLEND',mb.group(0)+' named before form',f
    elif sh['ofo'] and re.search(sh['ofo'],t,I): return False,'EX_FORM_MISMATCH',re.search(sh['ofo'],t,I).group(0),f
    if sh['fmt']:
        if f is None:
            if sh['fmt']=='pill' and re.search(r'\d\s*(mg|mcg|iu)\b',t,I): return True,'FORMAT_INFERRED_PILL','no format word; dose-stated, pill is default supplement format',f
            return False,'EX_FORMAT_UNSTATED','no format word in title',f
        if f!=sh['fmt']: return False,'EX_FORMAT_MISMATCH',f'{f} on {sh["fmt"]} shelf',f
    elif f in ('tea','coffee','gel') and f not in sh['allow']: return False,'EX_NOT_SUPPLEMENT','format '+f,f
    return True,('HERO_LED_COMPLEX' if others else 'IN_OK'),(', '.join(o[1] for o in others) if others else ''),f
FLAV=r"\b(strawberry|raspberry|blueberry|berry|mixed berry|cherry|lemon|lime|orange|citrus|mango|peach|watermelon|grape|apple|tropical|pineapple|coconut|vanilla|chocolate|unflavou?red|natural flavou?r|flavou?r(ed|s)?|sour|sugar[- ]free|zero sugar|fruit punch|blue razz|cotton candy|green apple|pomegranate|passion fruit|mint)\b"
STOP=set('for and with the of in to a by per plus women men adults adult kids supplement supplements support count ct pack servings serving day month supply bottle bottles each high strength potency extra vegan non gmo gluten free made usa'.split())
def toks(t):
    t=re.sub(FLAV,' ',t.lower()); t=re.sub(r'\(.*?\)',' ',t); t=re.sub(r'[\d.,]+\s*(mg|mcg|g|oz|ml|lbs?|ct|count|pack|servings?|caps(ules)?|tablets?|gummies|softgels?|day|days|month|months)?\b',' ',t)
    return [w for w in re.findall(r'[a-z][a-z\-]+',t) if w not in STOP]
def brand(t,sh):
    m=re.search(sh['hero'],t or '',I); pre=(t or '')[:m.start()] if m else ''
    pre=re.sub(r'[®™,|\-–]',' ',pre); pre=re.sub(r'\b[\d.,]+\s*[a-z]*\b',' ',pre,flags=I); w=[x for x in re.findall(r"[A-Za-z][A-Za-z'.&]+",pre) if x.lower() not in STOP and not re.match(r'^(sugar|free|organic|pure|natural|premium|liposomal|high|extra|ultra|max|advanced|clinical|new|best)$',x,I)]
    return ' '.join(w[:3]).lower()
def jac(a,b):
    a,b=set(a),set(b); return len(a&b)/len(a|b) if a|b else 0
def bkey(b): return re.sub(r'[^a-z]','',b or '')
DOSE=re.compile(r'(\d[\d.,]*)\s*(mg|mcg|billion|cfu|iu)\b',I)
def doses(t): return {(a.replace(',',''),u.lower()) for a,u in DOSE.findall(t)}
GENERIC_B=set('ethiopian egyptian irish peruvian indian himalayan korean japanese organic wild raw cold pressed premium nsf certified usda vegan natural pure whole true best new original authentic genuine'.split())
def real_brand(t,sh):
    """brand prefix usable for the product-name rule: none of its words generic descriptors or words of the shelf keyword"""
    b=brand(t,sh); w=b.split(); kw=set(sh['kw'].split())
    return b if w and not any(x in GENERIC_B or x in kw for x in w) else ''
def core(t,sh):
    seg=re.split(r'[|–—(]|, | - ',t)[0]
    bw=set(brand(t,sh).split())
    return set(x for x in toks(seg) if x not in bw and bkey(x) not in (bkey(brand(t,sh)),))
def collapse(items,sh):
    """items: included listings with sold,pos,reviews,title,asin. Returns kept, dropped(list of (item, kept_asin, why))
    v8.1: brand compared letters-only ("SP Nutrition"=="Spnutrition"); same brand + same review count>=50 = one line;
    same real brand + same format + identical product-name segment (flavour/count/pack variants); unbranded vs any with >=10-token
    titles and full-title Jaccard>=0.75. Never merge when both titles state doses and the doses differ."""
    order=sorted(items,key=lambda p:(-p['sold'],p['pos'])); kept=[]; dropped=[]
    for p in order:
        tp=toks(p['title'])[:10]; bp=bkey(brand(p['title'],sh)); hit=None; fa=toks(p['title'])
        for k in kept:
            if p['asin']==k['asin']: hit=(k,'same ASIN'); break
            dp,dk=doses(p['title']),doses(k['title'])
            if dp and dk and dp!=dk: continue
            tk=toks(k['title'])[:10]; j=jac(tp,tk); bk=bkey(brand(k['title'],sh)); same_f=fmt_of(p['title'])==fmt_of(k['title'])
            if bp and bp==bk and j>=0.6 and same_f: hit=(k,f'same brand "{bp}" + line (J={j:.2f})'); break
            same_b=bool(bp and bk and (bp==bk or (min(len(bp),len(bk))>=4 and (bp.startswith(bk) or bk.startswith(bp)))))
            if p['reviews']>=50 and p['reviews']==k['reviews'] and (j>=0.5 or same_b): hit=(k,f'shared review pool {p["reviews"]} (J={j:.2f})'); break
            rp,rk=bkey(real_brand(p['title'],sh)),bkey(real_brand(k['title'],sh))
            if rp and rp==rk and same_f:
                cp,ck=core(p['title'],sh),core(k['title'],sh)
                if len(cp)>=2 and cp==ck: hit=(k,f'same brand "{rp}" + same product name (variant)'); break
            fk=toks(k['title'])
            if (not bp or not bk) and len(fa)>=10 and len(fk)>=10 and jac(fa,fk)>=0.75 and same_f: hit=(k,f'near-identical title (J={jac(fa,fk):.2f})'); break
        if hit: dropped.append((p,hit[0]['asin'],hit[1]))
        else: kept.append(p)
    return kept,dropped
