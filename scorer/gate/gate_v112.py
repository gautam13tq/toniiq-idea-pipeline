"""gate_v112 = gate_v111 + two bug fixes, a non-human / non-supplement pre-filter and brand-alias normalisation.
Nothing in gate_v111 (or older) is edited; v112 wraps v111.classify3 and patches a few v111/v110 module names only while a v112 call runs.
 F1 (R13-5 base path)  The base chain's '"X" named before hero' HERO_SECONDARY (deep in v92/v97) never reached v111's E5. v112 checks the title
     for a clean 2-in-1 pair "X &/and/+ hero" or "hero &/and/+ X" (X = 1-4 words, a dose allowed; no comma list, no third active) and keeps it
     as HERO_LED_COMPLEX (R13-5 / R10-1 equal billing; the X-first label lead does not bite). A listed pair ("A, B & hero") stays OUT.
     A label/dose OUT on a clean "hero & X" pair is kept the same way. R13-6 stays as v111 E3.
 F2 (R5-4 bulk)  A bulk herb-powder drop (Z5 / C3 / R5-4) whose copy or label gives a serving dose (teaspoon/tsp/tea-spoon, tablespoon,
     scoop, spoonful, grams per serving / "take N g", serving size, N servings) is not bulk: it is re-classified as a dosed product.
     The judge prompt (judge_prompt_v112.txt) B4a is reworded to match.
 F3 source descriptor  A single plant word directly before a mineral hero ("Bamboo Silica") whose label lead is guaranteed/standardised to the
     hero = hero named (H100 spec). Otherwise that shape goes to the judge (U11).
 F4 "<hero> gel" with an oral unit (tabs, capsules) in the title: gel is the ingredient (colloidal silica gel), not the format.
 F5 accents folded before matching (Acai = Açaí).
 F6 hero only inside a longer coined/brand word ("Nopalina"): with a label that never names the hero = HERO_SECONDARY; no label = judge (U12).
 NH pre-filter (runs on every listing; hero words are blanked first so Cat's Claw, Horse Chestnut, Horny Goat Weed, Horsetail survive):
     NH1 garden / plant food / hydroponic / soil / fertilizer; NH2 pet / animal; NH3 bags, apparel, accessories, books, toys;
     NH4 desiccant; NH5 raw herb by weight with no supplement form and no dose; NH6 seeds for planting; NH7 salves, essential oils,
     other topicals, room sprays. A decisive hit (category crumb, or the keyword with no oral-supplement signal) = OUT; a keyword next to an
     oral-supplement signal = UNSURE (U10, judge decides).
 E6 fix: the v111 seeds/oil/salve exclusions no longer fire when the title has extract / tincture / liquid / drops (Herb Pharm tincture);
     bare "plant"/"annual" no longer count as planting words ("4 Plant-Part Blend").
 P4 brand alias: bkey normalises case, punctuation and company suffixes (Inc, LLC, Co, Corp, Ltd, Foods, Supplements, Nutrition, Labs ...)
     so "NOW", "NOW Foods", "Now Foods" are one brand for collapse and the merge judge.
 JUDGE: judge_prompt_v112.txt (listing) and judge_merge_prompt_v111.txt (unchanged); full GAUTAM_DECISIONS text; cache by prompt sha."""
import re,sys,os,json,unicodedata,contextlib
import gate_v111 as G1
from gate_v111 import SH,INC,VITMIN,ORALW,norm9,sold,add_holdout_specs,spec_text,listing_text   # noqa
G0=G1.G0; V100=G1.V100; V99=G1.V99
I=re.I; _D=os.path.dirname(os.path.abspath(__file__))
P3X=G1.P3X
# ---------------- brand alias (P4)
SUFX=re.compile(r'(?:inc|llc|l\s*l\s*c|co|corp|corporation|ltd|limited|company|foods?|supplements?|nutrition(?:als?)?|vitamins?|labs?|laboratories|usa|brands?|international|naturals?)',I)
def bkey2(b):
    ws=re.sub(r'[^a-z0-9]+',' ',unicodedata.normalize('NFKD',str(b or '')).encode('ascii','ignore').decode().lower().replace("'",'')).split()
    while len(ws)>1 and SUFX.fullmatch(ws[-1]): ws.pop()
    return re.sub(r'[^a-z]','',''.join(ws))
# ---------------- patched v111 names (E6 fix)
ORAL2=re.compile(G1.ORAL.pattern+r'|\bextracts?\b|\btinctures?\b|\bdrops\b|\bliquid\b|\bglycerites?\b|\bvcaps\b|\btabs\b',I)
SEEDC2=re.compile(r'planting|heirloom|perennial|germinat|\bsow(?:ing)?\b|wildflower|flower\s+seeds?|\blawn\b|\bgarden(?:ing)?\b(?!\s+of\b)|seed\s+packets?|grow\s+your\s+own',I)
@contextlib.contextmanager
def _patched():
    saved=[]
    def put(m,a,v):
        saved.append((m,a,getattr(m,a))); setattr(m,a,v)
    try:
        for n,m in list(sys.modules.items()):
            if n and (n=='gate' or n.startswith('gate_')) and m is not None and hasattr(m,'bkey') and n!=__name__: put(m,'bkey',bkey2)
        put(G1,'ORAL',ORAL2); put(G1,'SEEDC',SEEDC2)
        yield
    finally:
        for m,a,v in reversed(saved): setattr(m,a,v)
def fold(s):   # strip accents only (Açaí -> Acai); keep dashes, curly quotes and other punctuation as they are
    if not isinstance(s,str): return s
    return unicodedata.normalize('NFC',''.join(c for c in unicodedata.normalize('NFD',s) if not unicodedata.combining(c)))
def _fold_rec(x):
    return {k:(fold(v) if isinstance(v,str) else [fold(z) if isinstance(z,str) else z for z in v] if isinstance(v,list) else v) for k,v in x.items()}
# ---------------- shared text helpers
def _bul(y):
    b=y.get('bullets'); return ' '.join(b) if isinstance(b,list) else str(b or '')
def _crumbs(y): return str(y.get('crumbs') or '')
def _copy(y): return _bul(y)+' | '+str(y.get('description') or '')
def _ing(y): return str(y.get('ingredients') or '')
def _tb(y): return G0._t(y)
def _nohero(s,H): return re.sub(H,lambda m:' '*len(m.group(0)),s,flags=I)
# ---------------- F2 serving dose
SERV2=re.compile(r'\bscoops?\b|\btea[\s-]?spoons?(?:ful)?\b|\btsp\b|\btable[\s-]?spoons?(?:ful)?\b|\btbsp\b|\bspoonfuls?\b'
                 r'|\b\d+(?:\.\d+)?\s*(?:g|gm|gms|grams?)\s*(?:\)|\()?\s*(?:per\s+(?:day|serving|dose)|each\s+(?:day|serving)|daily|of\s+powder|\d+\s*times|twice|once)\b'
                 r'|\b(?:take|use|mix|add|consume|dose|dosage)\b[^.|;]{0,25}?\b\d+(?:\.\d+)?\s*(?:g|gm|gms|grams?)\b'
                 r'|\bserving\s+size\b|\bservings?\s+per\b|\bper\s+serving\b|\b\d+\s*servings\b'
                 r'|\b\d+\s*(?:capsules?|caps)\s*(?:per|a|daily|twice|once|with)\b',I)
def _bulk_drop(code,det): return code=='EX_NOT_SUPPLEMENT' and bool(re.search(r'\bZ5\b|^C3|C3 R5-4|R5-4',str(det)))
# ---------------- NH pre-filter
ORALSIG=re.compile(ORAL2.pattern+r'|\boral\b|internal\s+use|food\s+grade|for\s+(?:men|women|adults)\b|\bsupplement\s+facts\b|\bvegan\b',I)
SUPFORM=re.compile(r'\b(?:capsules?|caps|vcaps|tablets?|tabs|softgels?|gumm(?:y|ies)|chewables?|lozenges?|pills?|caplets?|extracts?|tinctures?|drops|liquid|glycerites?|tea\s*bags?|sachets?|stick\s*packs?|drink\s+mix|supplement\s+facts)\b',I)
DOSEANY=re.compile(SERV2.pattern+r'|\b\d[\d.,]*\s*(?:mg|mcg|µg|iu)\b',I)
NH=[ # name, code, title rx, crumb rx, decisive title rx (None = decisive only via crumbs / no oral signal)
 ('NH1 garden/plant product','EX_NOT_SUPPLEMENT',
  r'\bhydroponics?\b|\bfertili[sz]\w*|\bplant\s+(?:food|nutrients?|strength|supplements?|growth|feed)\b|\bfor\s+(?:indoor\s+|outdoor\s+|all\s+)?plants\b|\bpotting\b|\bsoil\b(?![\s-]+based)|\bgarden(?:s|ing)?\b(?!\s+of\b)|\blawn\b|\bnpk\b|\b\d{1,2}-\d{1,2}-\d{1,2}(?:\.\d+)?\b|\bgrow(?:ing)?\s+medi(?:a|um)\b|\bbloom\s+booster|\bfoliar\b|\bper\s+gallon\b',
  r'patio,\s*lawn|gardening|hydroponic|fertiliz|plant\s+food|pest\s+control',
  r'\bhydroponics?\b|\bfertili[sz]\w*|\bplant\s+(?:food|nutrients?|strength|supplements?|growth|feed)\b|\bnpk\b|\b\d{1,2}-\d{1,2}-\d{1,2}(?:\.\d+)?\b|\bfoliar\b|\bfor\s+(?:indoor\s+|outdoor\s+|all\s+)?plants\b'),
 ('NH2 pet/animal product','EX_PET',
  r"\b(?:dogs?|pupp(?:y|ies)|cats?(?!['’]?\s*s?\s*claw)|kittens?|pets?|canines?|felines?|equine|horses?(?!\s*(?:chestnut|tail|radish))|ponies|pony|livestock|cattle|poultry|chickens?\s+feed|goats?(?!['’]?\s*s?\s+(?:milk|weed|rue))|birds?|parrots?|reptiles?)\b",
  r'pet\s+supplies|\bdogs?\b|\bcats?\b|horse|equine|livestock|small\s+animals|birds?\b',
  r"\bfor\s+(?:dogs?|cats?|pets?|horses?|puppies|kittens?|animals|livestock)\b|\b(?:dog|cat|pet|canine|feline|equine|horse|puppy|kitten)s?\s+(?:supplements?|chews?|treats?|food|vitamins?|health|joint|hip|formula)\b"),
 ('NH3 bag/apparel/accessory','EX_NOT_SUPPLEMENT',
  r'\bdiaper\s+bags?\b|\bcrossbody\b|\bbackpacks?\b|\btote(?:\s+bags?)?\b|\borgani[sz]ers?\b|\bpouch\s+sets?\b|\bwallets?\b|\bpurses?\b|\bhandbags?\b|\bt-?shirts?\b|\bhoodies?\b|\bsweatshirts?\b|\bsocks\b|\bkey\s?chains?\b|\bstickers?\b|\bdecals?\b|\bmugs?\b|\btumblers?\b|\bnecklaces?\b|\bbracelets?\b|\bearrings?\b|\bjewelry\b|\bplush\b|\btoys?\b|\bcostumes?\b|\bposters?\b|\bwall\s+art\b|\bcandles?\b|\bpaperback\b|\bhardcover\b|\bbooks?\b|\bornaments?\b|\bfigurines?\b|\bpill\s+(?:box|case|cutter|crusher)s?\b',
  r'clothing|shoes\s*&|jewelry|diapering|luggage|handbags|toys\s*&\s*games|office\s+products|arts,\s*crafts|^\s*books|kindle|home\s+d[eé]cor|automotive|tools\s*&\s*home|electronics|cell\s+phones|storage\s*&\s*organization',
  None),
 ('NH4 desiccant','EX_NOT_SUPPLEMENT',
  r'\bdesiccants?\b|\bsilica\s+gel\s+(?:packs?|packets?|beads?|bags?|canisters?|sachets?)\b|\bmoisture\s+absorb\w*|\bdehumidif\w*|\boxygen\s+absorbers?\b|\bcat\s+litter\b|\bfood\s+grade\s+silica\s+gel\b',
  r'desiccant|dehumidif',
  r'.'),
 ('NH7 topical/aroma product','EX_TOPICAL',
  r"\bsalves?\b|\bointments?\b|\b(?:lip\s+)?balms?\b|\blotions?\b|\bcreams?\b(?<!ice\scream)(?!\s+of\s+tartar)|\bbody\s+(?:wash|butter|oil|scrub)\b|\bshampoos?\b|\bconditioners?\b|\bsoaps?\b|\btoners?\b|\bserums?\b|\broll[\s-]?ons?\b|\bliniments?\b|\bmassage\s+oils?\b|\bface\s+(?:masks?|wash)\b|\bfacial\b|\bessential\s+oils?\b|\baromatherapy\b|\bdiffusers?\b|\bbath\s+(?:salts?|bombs?|soak)\b|\bpoultices?\b|\btopical\b|\bdeodorants?\b|\btoothpaste\b|\bmouthwash\b|\b(?:room|linen|pillow|fabric|air)\s+(?:(?:and|&)\s+\w+\s+)?(?:spray|mist)s?\b|\bair\s+fresheners?\b|\bincense\b|\bsmudge\b|\bhair\s+(?:oil|mask)\b|\bskin\s*care\b",
  r'beauty\s*&\s*personal\s*care|skin\s+care|aromatherapy|bath\s*&|hair\s+care|oral\s+care|air\s+fresheners',
  None),
]
PETCOPY=re.compile(r"\bfor\s+(?:your\s+)?(?:dogs?|cats?|pets?|horses?|puppies|kittens?|animals|livestock)\b|\b(?:dog|cat|pet|horse|canine|feline)s?['’]?s?\s+(?:food|treats?|chews?|health|diet|joints?|coat|owners?)\b",I)
NONPOWDERFORM=re.compile(r'liquid|drop|capsule|tablet|softgel|gumm|tincture|lozenge|chewable|spray|caplet|pill',I)
NHC=[(n,c,re.compile(t,I),re.compile(cr,I),re.compile(d,I) if d else None) for n,c,t,cr,d in NH]
RAWW=re.compile(r'\b(?:roots?|herbs?|leaf|leaves|bark|cut|sifted|c/s|whole|dried|dry|raw|flowers?|berries|rhizomes?|stems?|slices?|chips?|pieces)\b',I)
WTW=re.compile(r'\b\d+(?:\.\d+)?\s*(?:lbs?|pounds?|oz|ounces?|kg|kilos?|kilograms?|g|gm|gms|grm|grms|grams?)\b',I)
BINOM=re.compile(r'\(\s*[A-Z][a-z]{3,}\s+[A-Za-z][a-z]{3,}\s*[)/,]|\b[A-Z][a-z]{3,}\s+[a-z]{3,}(?:a|us|um|is|ii|ae|e)\b')   # Latin binomial = botanical
def _rawish(tn,t,cr,ing=''):
    if RAWW.search(tn): return True
    if not re.search(r'\bpowder(?:ed)?\b',tn,I): return False
    return bool(re.search(r'herbal',cr,I) or re.search(r'\b(?:herbs?|herbal|ayurvedic|botanicals?)\b',t,I) or BINOM.search(t+' | '+ing))
def _notea(s):   # tea-making directions ("a teaspoon ... steep") are not a supplement serving dose
    return ' '.join(z for z in re.split(r'(?<=[.!?|])\s+',s) if not re.search(r'\bsteep|\binfus|\bbrew|make\s+(?:a\s+)?tea|cup\s+of\s+(?:hot|boiling)\s+water|boiling\s+water',z,I))
def _nonhuman(shelf,y):
    """returns (sure:bool, code, detail) or None"""
    H=SH[shelf]['hero']; t,tb=_tb(y); tn=_nohero(tb,H); cr=_crumbs(y); cp=_copy(y)
    oral=bool(ORALSIG.search(tn))
    for name,code,TR,CR,DR in NHC:
        if name.startswith('NH7') and re.search(r'\bice\s+cream|cookies\s*(?:and|&|n)\s*cream|cream\s+of\s+tartar|creamer',tn,I):
            tn2=re.sub(r'ice\s+cream|cookies\s*(?:and|&|n)\s*cream|cream\s+of\s+tartar|creamer',' ',tn,flags=I)
        else: tn2=tn
        m=TR.search(tn2); mc=CR.search(cr) if cr else None
        if name.startswith('NH2') and mc and not m and not PETCOPY.search(cp): mc=None   # a pet crumb needs copy aimed at animals (rulebook)
        if name.startswith('NH7') and mc and not m: continue                              # beauty/bath/oral-care crumbs alone are weak (Ayurvedic oral products sit there)
        if name.startswith('NH3') and mc and not m and (SUPFORM.search(tn) or re.search(r'vitamin|supplement|health',cr,I)): mc=None
        if not m and not mc: continue
        what=(m.group(0) if m else mc.group(0)).strip()
        dec=bool(mc) or (DR is not None and m and DR.search(tn2)) or (m and not oral)
        if name.startswith('NH4'): dec=bool(m) or bool(mc)
        if name.startswith('NH7') and m and oral: dec=False
        if dec: return True,code,f'{name} ("{what}")'
        return False,code,f'{name} keyword "{what}" next to an oral-supplement signal'
    # NH6 seeds for planting
    if re.search(r'\bseeds?\b',tn,I) and not SUPFORM.search(tn):
        m=SEEDC2.search(tn) or re.search(r'\b\d[\d,]*\+?\s*seeds\b|\bnon[\s-]?gmo\s+seeds\b',tn,I)
        mc=re.search(r'patio|garden|seeds\s*&\s*bulbs|plants,\s*seeds',cr,I)
        if m or mc: return True,'EX_NOT_SUPPLEMENT',f'NH6 seeds for planting ("{(m or mc).group(0)}")'
    # NH5 raw herb by weight, no supplement form, no dose
    sh=SH[shelf]
    compound=bool(re.search(r'\d|\s[a-z]$|(?:ine|ate|ide|ol|one|acid|in\s[a-z])$',shelf.strip(),I))   # a chemical compound is not a raw herb
    if not compound and not sh.get('form') and (sh.get('fmt') or '') not in ('powder',) and not VITMIN.search(H) and not re.search(r'magnes|zinc|iron|calcium|chromium|selen|potassium|copper|iodine|boron|manganese|vitamin|silica',H,I):
        frm=str(y.get('item_form') or '')+' '+str(y.get('dosage_form') or '')
        if NONPOWDERFORM.search(frm) or re.search(r'\bextracts?\b|(?<![\d.])(?:\d{1,2}(?:\.\d+)?|0?\.\d+)\s*%|\b\d+\s*:\s*1\b|\bblend\b',t,I) or re.search(r'\bextracts?\b',_ing(y),I): pass
        elif WTW.search(t) and _rawish(tn,t,cr,_ing(y)) and not SUPFORM.search(re.split(r'\bfor\b',t,1,flags=I)[0]) and not DOSEANY.search(_notea(t+' | '+cp+' | '+_ing(y))):
            return True,'EX_NOT_SUPPLEMENT',f'NH5 raw herb sold by weight ("{WTW.search(t).group(0)}"), no supplement form or dose (R5-4)'
    return None
# ---------------- F1 clean 2-in-1
TOK=r"(?:\d[\d.,]*\s*(?:mg|mcg|g|iu)\b|[A-Za-z][\w'’\-]*)"
NOTACT=r'(?:capsules?|caps|tablets?|tabs|softgels?|gumm(?:y|ies)|powder|liquid|drops|supplements?|extracts?|veg(?:an|gie|etarian)?|organic|non|gluten|free|tinctures?|formula|complex|support|blend|tea|root|leaf|herb|seeds?|berry|fruit|plus|with|for|daily|count|ct|pack|men|women|adults?|kids)'
DESC=set("""usda organic certified pure natural all premium wild wildcrafted raw ayurvedic herbal advanced extra ultra super strength
 max maximum high potency the of new original best daily standardized standardised fermented whole food non gmo vegan kosher""".split())
HARD=re.compile(r"(?:capsules?|caps|vcaps|tablets?|tabs|softgels?|gumm(?:y|ies)|chewables?|powder|liquid|drops|supplements?|tinctures?|formula|complex|support|blend|tea|with|for|by|plus|in|from|featuring|men|women|adults?|kids|bundle|kit|combo|set|pack|multi\w*|multivitamins?|health|relief|cleanse|detox)$",I)
MINV=re.compile(r"^(?:magnesium|zinc|iron|calcium|chromium|selenium|potassium|copper|iodine|boron|manganese|vanadium|vitamins?|[a-k]\d{0,2})$",I)
MINHERO=re.compile(r'magnes|zinc|iron|calcium|chromium|selen|potassium|copper|iodine|boron|manganese|silica|silicon|vitamin',I)
DOSE_T=re.compile(r"^\d[\d.,]*\s*(?:mg|mcg|g|iu|%)?$",I)
def _toks(s): return [(m.start(),m.end(),m.group(0)) for m in re.finditer(r"[A-Za-z0-9][\w'’.\-]*",s)]
def _pre_ok(pre,btoks):
    for _,_,w in _toks(pre):
        lw=w.lower().strip(".'’")
        if lw in DESC or lw in btoks or DOSE_T.match(lw): continue
        return False
    return True
def _pair(t,H,brand=''):
    """R13-5 clean 2-in-1 in the product-name segment (first segment of the title).
    returns (X, start, end, kind): kind 'X&H' with [start,end) the 'X &' span, or 'H&X'. None otherwise.
    Clean = before the pair only brand words, descriptors or a dose; X is 1-4 tokens naming one active
    (no form/benefit/joiner words, not two minerals/vitamins); nothing else '&'-listed after the pair;
    the title is not a bundle/kit and never says 'with <hero>'."""
    if re.search(r'\b(?:bundle|kit|combo|variety\s+pack)\b',t,I) or re.search(r'\bwith\s+(?:(?:organic|pure)\s+)?(?:'+H+')',t,I): return None
    btoks={w.lower() for w in re.findall(r"[A-Za-z0-9]+",brand or '')}
    seg=None
    for m in re.finditer(r"[^|:(\[\]\u2013\u2014,]+",t):
        p=m.group(0)
        for q in re.finditer(r'(?:(?!\s-\s).)+',p):
            if any(w.lower() not in DESC and w.lower() not in btoks for _,_,w in _toks(q.group(0))): seg=(m.start()+q.start(),q.group(0)); break
        if seg: break
    if not seg: return None
    o,p=seg; SEP=r'\s*(?:&|\band\b|\+)\s*'
    m=re.search(SEP+r'(?:(?:organic|pure|wild|wildcrafted|raw)\s+)?(?P<h>'+H+r')',p,I)
    if m and m.start()>0:
        before=p[:m.start()]; tk=_toks(before); X=[]
        while tk and len(X)<4:
            s0,e0,w=tk[-1]; lw=w.lower()
            if lw in btoks or lw in DESC or lw in ('of','the'): break
            X.insert(0,tk.pop())
        if X:
            xs=before[X[0][0]:]; words=[w for _,_,w in X]
            ok=(not any(HARD.match(w) for w in words) and not all(w.lower() in DESC or DOSE_T.match(w) for w in words)
                and sum(bool(MINV.match(w)) for w in words)<2 and _pre_ok(before[:X[0][0]],btoks)
                and not re.match(r"[\w'’]*\s*(?:,|&|\band\b|\+)\s*(?!\d)[A-Za-z]{3,}",t[o+m.end('h'):],I))
            if ok: return xs.strip(),o+X[0][0],o+m.start('h'),'X&H'
    m=re.search(r'(?P<h>'+H+r")[\w'’]*(?:\s+[A-Za-z0-9][\w'’\-]*)?"+SEP+r"(?P<X>[A-Za-z0-9][\w'’\-]*(?:\s+[A-Za-z0-9][\w'’\-]*){0,2})",p,I)
    if m and _pre_ok(p[:m.start('h')],btoks):
        words=m.group('X').split()
        while words and (HARD.match(words[-1]) or DOSE_T.match(words[-1])): words.pop()
        if words and not HARD.match(words[0]) and not any(re.match(r'(?:with|for|by|in)$',w,I) for w in words) \
           and not re.match(r"\s*(?:,|&|\band\b|\+)\s*(?!\d)[A-Za-z]{3,}",t[o+m.end('X'):],I):
            return ' '.join(words),o+m.start('h'),o+m.end('X'),'H&X'
    return None
# ---------------- F6 hero only inside a longer word
def _hero_in_coined_only(t,H):
    ms=list(re.finditer(H,t,I))
    if not ms: return None
    for m in ms:
        nxt=t[m.end():m.end()+3]
        if not re.match(r'[a-z]',nxt,I) or re.match(r"(?:s|es|'s)\b",nxt,I): return None
    w=re.match(r'\w+',t[ms[0].start():]).group(0); return w
# ---------------- classify3
def _base(shelf,x):
    with _patched(): return G1.classify3(shelf,x)
def classify3(shelf,x):
    x=_fold_rec(x)                                                                 # F5
    sh=SH[shelf]; H=sh['hero']
    v,code,det,f,u=_base(shelf,x)
    y=norm9(x); t,tb=_tb(y)
    nh=_nonhuman(shelf,y)                                                          # NH pre-filter
    if nh and nh[0]: return 'OUT',nh[1],nh[2],f,None
    # F2 bulk with a serving dose
    if ((v=='OUT' and _bulk_drop(code,det)) or (v=='UNSURE' and (u or '').startswith('U8'))) and re.search(r'\bpowder(?:ed)?\b|\bground\b',t+' '+str(y.get('item_form') or ''),I):
        sm=SERV2.search(_copy(y)+' | '+_ing(y))
        if sm:
            v2,c2,d2,f2,u2=_base(shelf,dict(x,title=(x.get('title') or '')+' | per serving'))
            if not (v2=='OUT' and _bulk_drop(c2,d2)):
                v,code,det,f,u=v2,c2,f'F2 R5-4 not bulk: serving dose in copy/label ("{sm.group(0)[:25]}"); '+str(d2),f2,u2
    # F4 "<hero> gel" with an oral unit = ingredient, not format
    if code in ('EX_NOT_SUPPLEMENT','EX_FORMAT_MISMATCH','EX_FORMAT_UNSTATED') and 'gel' in str(det).lower() and re.search('(?:'+H+r')\s+gel\b',t,I) and re.search(r'\b(?:tabs|tablets?|capsules?|caps|vcaps|softgels?)\b',t,I):
        t2=re.sub('((?:'+H+r'))\s+gel\b',r'\1',x.get('title') or '',flags=I)
        v2,c2,d2,f2,u2=_base(shelf,dict(x,title=t2))
        if v2!='OUT' or c2!=code: v,code,det,f,u=v2,c2,'F4 "hero gel" with an oral unit = ingredient, not format; '+str(d2),f2,u2
    # F1 R13-5 clean 2-in-1 (base path) and F3 source descriptor
    if code=='HERO_SECONDARY' and v!='IN' or (v=='UNSURE' and (u or '').startswith('U2')):
        pr=_pair(x.get('title') or '',H,str(y.get('brand') or ''))
        mx=re.search(r'"([^"]+)"\s+(?:co-)?named before hero',str(det))
        if pr and not G1._derivative(shelf,tb):
            X,s0,s1,kind=pr
            if kind=='X&H':
                v2,c2,d2,f2,u2=_base(shelf,dict(x,title=V99._blank(x.get('title') or '',s0,s1)))
            else: v2,c2,d2,f2,u2='IN',code,det,f,None
            if v2=='OUT' and c2 not in ('HERO_SECONDARY',): v,code,det,f,u=v2,c2,d2,f2,u2
            else:
                return 'IN','HERO_LED_COMPLEX',f'F1 R13-5 2-in-1 "{X.strip()[:30]}" + hero = equal billing',f2 or f,None
        elif mx and v=='OUT' and re.search(re.escape(mx.group(1).strip())+r'\s*\(\s*(?:'+H+')',t,I):
            i0=re.search(re.escape(mx.group(1).strip()),x.get('title') or '',I)
            if i0:
                v2,c2,d2,f2,u2=_base(shelf,dict(x,title=V99._blank(x.get('title') or '',i0.start(),i0.end())))
                if v2!='OUT' or c2!='HERO_SECONDARY': return v2,c2,'F7 "X (hero)" = translated/alias name, not a co-active; '+str(d2),f2,u2
        elif mx and v=='OUT' and MINHERO.search(H):
            X=mx.group(1).strip()
            if re.fullmatch(r"[A-Za-z][\w'’\-]*",X) and not VITMIN.search(X) and re.search(r'\b'+re.escape(X)+r'\s+(?:'+H+')',t,I):
                lead=re.split(r'[;,](?![^()]*\))',re.sub(r'^\s*ingredients?\s*:\s*','',_ing(y),flags=I))[0]
                if re.search(X,lead,I) and re.search(H,lead,I) and re.search(r'guarantee|standardi[sz]ed|yield|provid|contain|equiv|as\s+',lead,I):
                    i0=re.search(r'\b'+re.escape(X)+r'\s+(?=(?:'+H+'))',t,I)
                    v2,c2,d2,f2,u2=_base(shelf,dict(x,title=V99._blank(x.get('title') or '',i0.start(),i0.end())))
                    if v2!='OUT' or c2!='HERO_SECONDARY':
                        return v2 if v2!='UNSURE' else 'IN',(c2 if c2 in INC else 'IN_OK') if v2!='OUT' else c2,f'F3 source descriptor "{X}" (label guarantees the hero); '+str(d2),f2,None
                return 'UNSURE',code,det,f,f'U11 single word "{X}" directly before a mineral/hero word (source descriptor?)'
    # F6 hero only inside a longer coined/brand word
    if v!='OUT':
        w=_hero_in_coined_only(t,H)
        if w and w.lower() in bkey2(str(y.get('brand') or '')).replace(' ','') :
            ing=_ing(y)
            if ing.strip() and ing.strip().lower()!='none' and not re.search(H,ing,I):
                return 'OUT','HERO_SECONDARY',f'F6 hero only inside the coined word "{w}" and never on the label (R8-1)',f,None
            if not ing.strip() or ing.strip().lower()=='none':
                return 'UNSURE',code,det,f,f'U12 hero only inside the coined word "{w}", no label'
    if nh and not nh[0] and v!='OUT': return 'UNSURE',code,det,f,'U10 '+nh[2]
    return v,code,det,f,u
def classify(shelf,x):
    v,code,det,f,u=classify3(shelf,x); return v=='IN',code,det,f
# ---------------- judge
JUDGE_PROMPT=os.path.join(_D,'judge_prompt_v112.txt'); MERGE_PROMPT=G1.MERGE_PROMPT; DECISIONS=G1.DECISIONS
JSCHEMA=G1.JSCHEMA; MSCHEMA=G1.MSCHEMA
def judge_prompt(shelf,x):
    return open(JUDGE_PROMPT).read().replace('{{SPEC}}',spec_text(shelf)).replace('{{LISTING}}',listing_text(x)).replace('{{DECISIONS}}',open(DECISIONS).read())
def judge(shelf,x,cache_only=False): return G1._ask(judge_prompt(shelf,_fold_rec(x)),JSCHEMA,('IN','OUT'),cache_only)
def judge_merge(shelf,a,b,cache_only=False): return G1.judge_merge(shelf,a,b,cache_only)
# ---------------- Z9 (P4): same brand + same hero dose + same format + same variant words = one line sold in different counts
import gate_v97 as _V97, gate_v94 as _V94
Z9V={'zero':'zero','sugar':'sugar','sugarfree':'sugar','time':'tr','timed':'tr','release':'tr','fast':'fd','dissolve':'fd','quick':'fd','extended':'tr',
     'sustained':'tr','delayed':'dr','organic':'org','extract':'ext','standardized':'ext','ksm':'ksm','sensoril':'sens','gold':'gold','extra':'xs',
     'strength':'xs','maximum':'max','max':'max','dual':'dual','spectrum':'dual','layer':'dual','liposomal':'lipo','chewable':'chew','chewables':'chew',
     'kids':'kids','children':'kids','childrens':'kids','prenatal':'pre','senior':'sen',
     'whole':'wf','raw':'raw','fermented':'ferm','micronized':'micro','buffered':'buf','liquid':'liq','powder':'pow','gummy':'gum','gummies':'gum',
     'capsule':'cap','capsules':'cap','caps':'cap','vcaps':'cap','vegcaps':'cap','tablet':'tab','tablets':'tab','tabs':'tab','caplets':'tab','caplet':'tab',
     'softgel':'sg','softgels':'sg','lozenge':'loz','lozenges':'loz','spray':'spr','absorption':'abs','complex':'cx','formula':'cx','blend':'cx','bundle':'bun'}
Z9G={'natural','pure','premium','quality','the','of','for','supplement','supplements','dietary','herbal','mineral','essential','high','ultra','veg',
     'vegetarian','non','gmo','usa','made','in','per','serving','servings','count','ct','pack','mg','mcg','g','iu'}
def _z9tok(t): return re.findall(r"[a-z0-9]+",re.sub(r"['’]",'',_V94._thou(t).lower()))
def _z9keys(x,shelf_keys):
    ks={bkey2(x.get('brand'))}-{''}; w=_z9tok(x.get('title') or '')
    for n in (1,2):
        k=bkey2(' '.join(w[:n]))
        if len(k)>=4 and k in shelf_keys: ks.add(k)
    return ks
def _z9sig(x,keys,H):
    w=_z9tok(x.get('title') or '')
    while w and (any(re.sub(r'[^a-z]','',w[0]) and re.sub(r'[^a-z]','',w[0]) in k for k in keys) or SUFX.fullmatch(w[0])): w=w[1:]
    t=' '.join(w); m=re.search(H,t,I)
    if not m: return None
    raw=_V94._thou(x.get('title') or '').lower().replace('\u2019',"'")
    while True:   # brand-strip the raw title, keeping punctuation
        m2=re.match(r"[\s,]*([a-z0-9']+)",raw); z=re.sub(r'[^a-z]','',m2.group(1)) if m2 else ''
        if m2 and ((z and any(z in k for k in keys)) or SUFX.fullmatch(z or '-')): raw=raw[m2.end():]
        else: break
    head=re.split(r"\s[-\u2013\u2014|]\s|\||\(|\bfor\b|\bsupports?\b|\bpromotes?\b",raw)[0]   # product phrase; marketing tail ignored
    head=','.join(head.split(',')[:2])                                                                 # at most the first two comma segments
    head=re.split(r'\b(?:capsules?|caps|vcaps|veg\s*caps|tablets?|tabs|caplets?|softgels?|gumm(?:y|ies)|lozenges?|chewables?)\b',head.lstrip(' ,'),1,flags=I)[0]   # product phrase ends at the format word
    hw=_z9tok(head)
    pre={z for z in _z9tok(t[:m.start()]) if z not in Z9G and z not in Z9V and not z.isdigit()}
    var={Z9V[z] for z in _z9tok(head.lstrip(' ,').split(',')[0]) if z in Z9V}-{'cap','tab','sg','gum','pow','liq','loz','spr','chew'}   # format is checked separately (fmt_of); variant words come from the first comma segment only
    hm=re.search(H,head,I)
    combo=set(re.findall(r"(?:&|\+|\band\b|\bwith\b)\s*(?!\d)([a-z][a-z\-]{2,})",head[hm.end():] if hm else head))
    combo-={'added','zero','no','sugar','vegetarian','veg','non','gluten','gmo','vegan','high','free'}|set(Z9V)
    nx=[z for z in _z9tok(t[m.end():])[:1] if not z[0].isdigit() and z not in Z9G and z not in Z9V]
    return pre,var,combo,tuple(nx)
def _z9(p,k,H,shelf_keys,soft=False):
    kp,kk=_z9keys(p,shelf_keys),_z9keys(k,shelf_keys)
    if not (kp&kk) or (kp&kk)<=set(G0.GENERIC_BRAND): return False
    if G0.fmt_of(p['title'])!=G0.fmt_of(k['title']) or (p.get('fmt') and k.get('fmt') and p['fmt']!=k['fmt']): return False
    dp=_V97.hero_dose(dict(p,title=_V94._thou(p['title'])),H); dk=_V97.hero_dose(dict(k,title=_V94._thou(k['title'])),H)
    a,b=_z9sig(p,kp|kk,H),_z9sig(k,kp|kk,H)
    if not (a and b): return False
    if not soft: return bool(dp and dk and dp[:2]==dk[:2] and a==b)
    # soft (merge-judge candidate): same variant words and co-actives; dose equal or both unstated; name words may differ
    if (dp or dk) and not (dp and dk and dp[:2]==dk[:2]): return False
    return a[1]==b[1] and a[2]==b[2] and a!=b or (not dp and not dk and a==b)
def collapse(inc,H):
    with _patched(): kept,dropped=G1.collapse(inc,H)
    sk={bkey2(x.get('brand')) for x in inc if len(bkey2(x.get('brand')))>=4}
    out=[]
    for p in sorted(kept,key=lambda p:(-(p.get('reviews') or 0),p.get('page') or 9,p.get('pos') or 99)):
        hit=next((k for k in out if _z9(p,k,H,sk)),None)
        if hit: dropped.append((p,hit['asin'],'Z9 same brand + same hero dose/format/variant words, different count'))
        else: out.append(p)
    ids={p['id'] for p in out}
    return [p for p in kept if p['id'] in ids],dropped
def merge_candidates(kept,H=None):
    with _patched(): out=list(G1.merge_candidates(kept))
    if H:   # Z9 soft: same brand/format/dose/variant words but different name words -> ask the merge judge (UNSURE duplicate)
        seen={frozenset((a['id'],b['id'])) for a,b in out}; sk={bkey2(x.get('brand')) for x in kept if len(bkey2(x.get('brand')))>=4}
        for i,a in enumerate(kept):
            for b in kept[i+1:]:
                if frozenset((a['id'],b['id'])) not in seen and _z9(a,b,H,sk,soft=True): out.append((a,b))
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
    for a,b in merge_candidates(kept,SH[shelf]['hero']):
        if not any(z['id']==a['id'] for z in kept) or not any(z['id']==b['id'] for z in kept): continue
        j=merge_fn(shelf,a,b) if merge_fn else None
        merges.append(dict(a=a['id'],b=b['id'],judge=j))
        if j and j.get('verdict')=='MERGE':
            keep,drop=sorted([a,b],key=lambda p:(-(p.get('reviews') or 0),p.get('page') or 9,p.get('pos') or 99))
            kept=[z for z in kept if z['id']!=drop['id']]
            dec[drop['id']].update(include=False,code='EX_VARIANT_DUP',detail=f'U9 merge judge: same line -> {keep["asin"]}',dup_of=keep['asin'],merge_judge=j)
    top=sorted(kept,key=lambda p:(-p['sold'],p.get('page') or 9,p.get('pos') or 99))[:k]
    return dict(dec=dec,kept=[p['id'] for p in kept],top=[p['id'] for p in top],merges=merges)
