"""Relevance filter v2 (pre-registered in EVALS_PREREG_ADDENDUM_2026-10-27.md).
Per concept: hero aliases, allowed combo partners (named by the keyword or search queries), and ignore terms
(words that describe the hero itself, e.g. 'vitamin e' for tocotrienols, so they do not count as another active)."""
import re
LEX=[r"ashwagandha",r"melatonin",r"magnesium",r"\bzinc\b",r"vitamin c\b",r"vitamin d3?\b",r"vitamin b12|\bb12\b",r"vitamin e\b",r"vitamin k2?\b",r"biotin",r"collagen",
 r"elderberry",r"echinacea",r"turmeric",r"curcumin",r"ginger\b",r"black seed",r"nigella",r"oregano",r"apple cider vinegar|\bacv\b",r"berberine",r"chromium",r"cinnamon",
 r"glucomannan|konjac",r"probiotics?\b",r"prebiotics?\b",r"postbiotics?\b",r"\bfiber\b",r"psyllium",r"inulin",r"arginine",r"citrulline",r"beet ?root|\bbeets?\b",r"creatine",
 r"electrolytes?",r"caffeine",r"theanine",r"\bglycine\b",r"taurine",r"\bnac\b|n-acetyl",r"glutathione",r"quercetin",r"bromelain",r"\biron\b",r"methylfolate|\bfolate\b|folic acid",
 r"\bcalcium\b",r"potassium",r"coq10|ubiquinol",r"omega[- ]?3|fish oil|krill",r"saw palmetto",r"pumpkin seed",r"lion.?s mane",r"reishi",r"chaga",r"cordyceps",r"mushrooms?\b",
 r"\bmaca\b",r"tongkat",r"fadogia",r"shilajit",r"sea ?moss|irish moss",r"bladderwrack",r"burdock",r"dandelion",r"milk thistle",r"artichoke",r"licorice|\bdgl\b",r"slippery elm",
 r"marshmallow",r"\baloe\b",r"glutamine",r"digestive enzymes?",r"lactase",r"\bprotein\b",r"\bwhey\b",r"\bmct\b",r"cayenne|capsaicin",r"green tea|\begcg\b",r"garcinia",
 r"hesperidin",r"diosmin",r"horse chestnut",r"butcher.?s broom",r"grape seed",r"resveratrol",r"\bnmn\b",r"\btmg\b|betaine",r"sam-?e\b",r"alpha[- ]lipoic",r"tudca",r"ox bile",
 r"\bdim\b",r"glucarate",r"sulforaphane|broccoli",r"ginseng",r"rhodiola",r"holy basil|tulsi",r"valerian",r"chamomile",r"passion ?flower",r"lemon balm",r"\bgaba\b",r"5-htp",
 r"tyrosine",r"mucuna",r"cranberry",r"mannose",r"hibiscus",r"tocopherols?",r"lutein",r"astaxanthin",r"spirulina",r"chlorella",r"moringa",r"nattokinase",r"serrapeptase",
 r"boswellia",r"\bmsm\b",r"glucosamine",r"chondroitin",r"hyaluronic",r"keratin",r"lithium",r"selenium",r"iodine",r"b[- ]complex",r"multivitamin",r"butyrate|butyric",
 r"lactoferrin",r"colostrum",r"beta[- ]glucan",r"andrographis",r"olive leaf",r"monolaurin",r"mullein",r"\bpqq\b",r"citicoline",r"alpha[- ]?gpc",r"\bcholine\b",r"bacopa",
 r"ginkgo",r"phosphatidylserine",r"luteolin",r"palmitoylethanolamide",r"pine pollen",r"shatavari",r"black cohosh",r"vitex|chasteberry",r"dong quai",r"red clover",r"bitter melon",
 r"gymnema",r"hawthorn",r"garlic",r"boulardii|saccharomyces",r"paraxanthine",r"pregnenolone",r"dhea",r"epicatechin",r"guarana",r"yerba mate"]
LEXR=[re.compile(x,re.I) for x in LEX]
DOSE=re.compile(r"^\W{0,3}\(?\s*\d[\d,.]*\s?(mg|mcg|g|billion|cfu|iu|%)\b",re.I)
ANYDOSE=re.compile(r"\d[\d,.]*\s?(mg|mcg|g|billion|cfu|iu)\b",re.I)
CONN=r"\s*(\+|&|\band\b|/)\s*"

def S(alias,partners=(),ignore=()): return dict(alias=alias,partners=list(partners),ignore=list(ignore))
MAG=r"magnesium|\bmag\b"
SPEC=[ # (row-name prefix, spec)
 ("Lactoferrin",S(r"lactoferr?in")),
 ("Micronized Diosmin",S(r"diosmin|\bmpff\b|daflon",["hesperidin"])),
 ("S. boulardii",S(r"boulardii|saccharomyces|florastor",ignore=["probiotic"])),
 ("Cayenne + MCT",S(r"cayenne|capsaicin|capsicum",["mct"])),
 ("Dandelion",S(r"dandelion|taraxacum")),
 ("Creatine Electrolytes",S(r"creatine",["electrolyte","hydration"])),
 ("Polypodium",S(r"polypodium|polipodium|leucotomos|fernblock|heliocare")),
 ("Toniiq Sunfiber",S(r"sunfiber|\bguar\b|\bphgg\b",ignore=["fiber","prebiotic"])),
 ("Andrographis",S(r"andrographi(s|olide)")),
 ("L-Citrulline",S(r"citrulline")),("L-citrulline",S(r"citrulline")),
 ("NAC + Glycine",S(r"\bglycine\b",["\\bnac\\b|n-acetyl"])),
 ("MTHFR-Friendly Gentle Iron",S(r"\biron\b|ferrous|ferric|ferrochel|\bheme\b",ignore=["iron"])),
 ("Liposomal Iron",S(r"\biron\b|ferrous|ferric|ferrochel|\bheme\b")),
 ("Synbiotic Butyrate",S(r"butyrate|butyric|tributyrin",ignore=["prebiotic","postbiotic"])),
 ("PEA (",S(r"palmitoylethanolamide|\bpea\b(?!\s*protein)|levagen|optipea")),
 ("Horse Chestnut",S(r"horse chestnut|aescin|\bescin")),
 ("Bitter Melon",S(r"bitter (melon|gourd)|momordica|charantia|karela")),
 ("Liposomal Magnesium",S(MAG)),
 ("Hawthorn",S(r"hawthorn|crataegus")),
 ("GABA",S(r"\bgaba\b|gamma[- ]amino")),
 ("DIM Estrogen",S(r"\bdim\b|diindolylmethane",["glucarate","zinc"])),
 ("Pumpkin",S(r"pumpkin seed")),
 ("Epicatechin",S(r"epicatechin")),
 ("Oil of Oregano",S(r"black seed|nigella|oregano|thymoquinone")),
 ("Pentadecanoic",S(r"pentadecanoic|\bc15(:0)?\b|fatty15")),
 ("Curcumin Phytosome",S(r"curcumin|turmeric|meriva")),
 ("Holy Basil",S(r"holy basil|tulsi|ocimum")),
 ("Complete Ginsenoside",S(r"ginseng|ginsenoside|panax")),
 ("Dopamine Support",S(r"mucuna|l-?dopa|dopamine",["tyrosine"])),
 ("Pure Magnesium Glycinate",S(MAG)),
 ("Magnesium Glycinate Sleep",S(MAG,["theanine","glycine"])),
 ("Creatine + GAA",S(r"creatine",["gaa","guanidino"])),
 ("Liposomal Luteolin",S(r"luteolin")),
 ("Pine Pollen",S(r"pine pollen")),
 ("Shatavari",S(r"shatavari|asparagus racemosus")),
 ("Toniiq Ultra Reishi",S(r"reishi|ganoderma|lingzhi",ignore=["mushroom"])),
 ("Mushroom Coffee",S(r"mushroom coffee|(lion.?s mane|chaga|reishi|cordyceps|mushrooms?)[^,]{0,40}coffee|coffee[^,]{0,40}(lion.?s mane|chaga|reishi|cordyceps|mushroom)",
   ["protein","creatine"],ignore=["lion.?s mane","chaga","reishi","cordyceps","mushroom"])),
 ("Toniiq Berberine",S(r"berberine")),
 ("Creatine GAA Complex",S(r"creatine")),
 ("Pure Taurine",S(r"taurine")),
 ("Clear Plant Protein",S(r"\bprotein\b",ignore=["whey","electrolyte","collagen"])),
 ("Grass-Fed Beef",S(r"beef[^,]{0,25}(protein|isolate)|carnivor",ignore=["protein","collagen"])),
 ("Glucomannan",S(r"glucomannan|konjac",["chromium"],ignore=["fiber"])),
 ("R-alpha",S(r"\br[- ]?(\(\+\)[- ]?)?(alpha[- ]?)?lipoic|\br[- ]ala\b|na-r-ala|r-lipoate",ignore=["alpha[- ]lipoic"])),
 ("Pregnenolone",S(r"pregnenolone")),
 ("Tributyrin",S(r"tributyrin",ignore=["butyrate|butyric","postbiotic"])),
 ("Thymoquinone",S(r"thymoquinone|black seed|nigella",ignore=["oil"])),
 ("Magnesium glycinate gummies",S(r"magnesium[ -]?(bis[- ]?)?glycinate|glycinate magnesium|mag(nesium)? bisglycinate",ignore=["magnesium"])),
 ("Sea moss",S(r"sea ?moss|irish moss")),
 ("Creatine gummies",S(r"creatine")),
 ("Berberine gummies",S(r"berberine")),
 ("Iron bisglycinate",S(r"(iron|ferrous)[ -]?(bis[- ]?)?glycinate|bis[- ]?glycinate|ferrochel|chelated iron|iron chelate",ignore=["iron"])),
 ("Potassium citrate",S(r"potassium citrate",ignore=["potassium"])),
 ("Ceylon",S(r"ceylon|cinnamon")),
 ("DAO",S(r"\bdao\b|diamine oxidase")),
 ("Citicoline",S(r"citicoline|cdp[- ]?choline|cognizin")),
 ("TUDCA",S(r"tudca|tauroursodeoxycholic")),
 ("Paraxanthine",S(r"paraxanthine|enfinity")),
 ("Tocotrienols",S(r"tocotrienol|toco[- ]?sorb|evnol|deltagold|delta gold|tocomin|annatto[- ]?(e|vitamin e)\b",ignore=["vitamin e","tocopherols?"])),
 ("Lithium orotate",S(r"lithium\W{0,3}orotate|orotate\W{0,15}lithium",ignore=["lithium"])),
 ("Magnesium taurate",S(r"magnesium\W{0,3}(taurate|taurinate)|magnesium[^,]{0,15}taurine|taurate",ignore=["taurine","magnesium"])),
 ("Lemon balm",S(r"lemon balm|melissa")),
 ("Slippery elm",S(r"slippery elm|ulmus")),
 ("Marshmallow",S(r"marshmallow|althaea")),
 ("Chanca piedra",S(r"chanca piedra|phyllanthus|stone ?breaker|quebra pedra")),
 ("D mannose",S(r"\bd[- ]?mannose",ignore=["mannose"])),
]
def spec_for(name):
    for pre,s in SPEC:
        if name.startswith(pre): return s
    raise KeyError(name)

def decide(name,title):
    s=spec_for(name); t=title or ''
    hm=[m.span() for m in re.finditer(s['alias'],t,re.I)]
    if not hm: return False,'hero alias not in title'
    hi=hm[0][0]
    ign=[re.compile(x,re.I) for x in s['ignore']]; par=[re.compile(x,re.I) for x in s['partners']]
    def is_hero(a,b): return any(not(b<=x or a>=y) for x,y in hm)
    others=[]
    for rx in LEXR:
        for m in rx.finditer(t):
            a,b=m.span()
            if re.match(r'[- ]free\b',t[b:b+6],re.I): continue
            if is_hero(a,b) or any(g.fullmatch(m.group(0)) or g.search(m.group(0)) for g in ign): continue
            others.append((a,b,m.group(0)))
    others.sort()
    # co-primary combo: hero CONN other, or other CONN hero
    for a,b,w in others:
        for x,y in hm[:1]:
            seg=t[y:a] if a>=y else t[b:x] if x>=b else None
            if seg is not None and re.fullmatch(CONN,seg,re.I) and not re.search(r'\bwith\b',seg,re.I):
                if any(p.search(w) for p in par): continue
                return False,f'co-primary combo with "{w}" (keyword does not name it)'
    lead=[o for o in others if o[0]<hi and not any(p.search(o[2]) for p in par)]
    if lead:
        hero_dose=bool(DOSE.match(t[hm[0][1]:]))
        if hero_dose and not ANYDOSE.search(t[:hi]): return True,f'hero dose stated; "{lead[0][2]}" named earlier without a dose'
        return False,f'another active ("{lead[0][2]}") is named before the hero'
    return True,'hero is the first named active'
