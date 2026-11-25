import json,re,sys
sys.path.insert(0,'/home/user/toniiq-idea-pipeline/scorer')
from shelfscorer import sleeves as SL
T=open('/mnt/project-files/product-dev/amazon-ideas-system/fable-advisor-2026-11-25/FULL-ROWS.md').read()
def rows(key):
    for line in T.splitlines():
        if line.startswith(key+' '):
            body=line.split('. ',1)[1]
            out=[]
            for part in re.split(r';\s*',body):
                m=re.match(r'(.+?)\s+([\d,]+)$',part.strip())
                if m and '(' not in m.group(1): out.append((m.group(1).strip(),int(m.group(2).replace(',',''))))
            return out
    raise KeyError(key)
W="2026-11-25T17:20:00+00:00"
NOTE="Fable-38 (fable-advisor-2026-11-25): Keyword Spy own rows, FULL-ROWS.md (US, Related, Oct 2026). Planning thread relay 25 Nov; Gautam 'do the whole plan today'. Not published until confirmed."
KIDS=r"\bkids?\b|\bkid'?s\b|\bchild(?:ren)?'?s?\b|\btoddlers?\b|\bbab(?:y|ies)\b|\binfants?\b|niños|\bteens?\b"
WOMEN=r"^(?!.*\bmen\s*(?:&|and|/|\+)\s*wom[ae]n\b)(?!.*\bwom[ae]n\s*(?:&|and|/|\+)\s*men\b).*(?:\bwom[ae]n\b|\bwomen'?s\b|\bfemale\b|\bher\b)"
S={}
def add(fid,key,shelf,hero,cluster,kind=None,sreg=None,req=None,fmt=None,excl=None,qual=None,parent_kw=None,microbial=False,extra=None):
    rr=rows(key); s=dict(shelf_keyword=shelf,hero_name=shelf,hero_regex=hero,cluster_keywords=cluster,parent_keyword=parent_kw,microbial=microbial,
        finder_terms=cluster[:3],candidate_subniches=[],seed_asins=[],written_at=W,spec_round="fable38-2026-11-25",spec_note=NOTE)
    if excl: s['hero_exclude_regex']=excl
    if req: s['required_regex']=req
    if qual: s['qualifier_regex']=qual
    if fmt: s['gate_format']=fmt
    if kind:
        s.update(scored_on='sleeve',sleeve_kind=kind,sleeve_regex=sreg,demand_keyword=parent_kw or shelf)
        s['sleeve_cluster']=[k for k,_ in rr if SL.phrasing_ok(k,s)]
        dropped=[k for k,_ in rr if k not in s['sleeve_cluster']]
    else:
        s.update(scored_on='parent',demand_keyword=shelf)
        H=re.compile(hero,re.I); E=re.compile(excl,re.I) if excl else None
        s['demand_cluster']=[k for k,_ in rr if H.search(k) and not (E and E.search(k))]
        dropped=[k for k,_ in rr if k not in s['demand_cluster']]
    if extra: s.update(extra)
    kept=sum(c for k,c in rr if k not in dropped)
    S[fid]=(s,kept,len(rr)-len(dropped),dropped)
# kids sweep
add('k1-kids-iron','37b','iron supplements for kids',r"\biron\b|ferrous|ferric",["iron supplements for kids","kids iron supplement","iron for kids","iron gummies for kids"],'audience',KIDS,KIDS,excl=r"cast iron|flat iron|curling|iron man|ironing",qual=KIDS,parent_kw='iron')
add('k2-kids-omega-3','37c','omega 3 for kids',r"omega|\bdha\b|fish oil",["omega 3 for kids","kids omega 3","omega 3 kids","kids omega 3 gummies"],'audience',KIDS,KIDS,qual=KIDS,parent_kw='omega 3')
add('k3-kids-calm','37d','kids calm gummies',r"calm|mood|anxiety|relax",["kids calm gummies","calm gummies kids","calm kids","calming gummies for kids"],'audience',KIDS,KIDS,qual=KIDS,parent_kw='calm',extra={'benefit_led':True})
add('k4-kids-electrolytes','37e','kids electrolytes',r"electrolyt|hydration|electrolito",["kids electrolytes","electrolytes for kids","electrolytes kids","kids hydration packets"],'audience',KIDS,KIDS,qual=KIDS,parent_kw='electrolytes')
add('k5-kids-focus','37f','focus gummies for kids',r"focus|brain|attention",["focus gummies for kids","focus supplements for kids","focus vitamins for kids","kids brain vitamins"],'audience',KIDS,KIDS,qual=KIDS,parent_kw='focus',extra={'benefit_led':True})
add('k6-kids-vitamin-d','37g','vitamin d gummies for kids',r"vitamin d|\bd3\b",["vitamin d gummies for kids","vitamin d3 for kids","vitamin d kids gummies","kid vitamin d"],'audience',KIDS,KIDS,qual=KIDS,parent_kw='vitamin d')
add('k7-saffron-gummies-kids','13','saffron gummies kids',r"saffron|safron|affron|satiereal",["saffron gummies kids","kids saffron gummies","saffron gummies for kids","saffron kids gummies"],'audience',KIDS,KIDS,fmt='gummy',qual=KIDS,parent_kw='saffron')
# creatine for women sweep
add('w1-creatine-gummies-for-women','38a','creatine gummies for women',r"creatine|creapure",["creatine gummies for women","creatine for women gummies","womens creatine gummies","women creatine gummies"],'audience',r"wom[ae]n|female",WOMEN,fmt='gummy',qual=r"wom[ae]n",parent_kw='creatine')
add('w2-creatine-over-50','32b','creatine for women over 50',r"creatine|creapure",["creatine for women over 50","creatine for men over 50","creatine for women over 40","creatine for men over 60"],'audience',r"over\s*(?:40|50|60)",r"over\s*(?:40|50|60)|\b(?:40|50|60)\s*\+|\b(?:40|50|60)s\b|senior|menopaus|mature|older adults|aging",qual=r"over\s*(?:40|50|60)",parent_kw='creatine')
add('w3-sugar-free-creatine-gummies','23','sugar free creatine gummies',r"creatine|creapure",["sugar free creatine gummies","creatine gummies sugar free","creatine gummies no sugar","creatine gummies zero sugar"],'variety',r"sugar[- ]?free|no sugar|zero sugar",r"sugar[- ]?free|no sugar|zero sugar|0g sugar|0 g sugar",fmt='gummy',qual=r"sugar",parent_kw='creatine')
# K2, lutein
add('v1-vitamin-k2-mk7','34a','vitamin k2 mk7',r"\bk2\b|k-2|mk[- ]?7|menaquinone|\bmk7",["vitamin k2 mk7","k2 mk7","mk7 vitamin k2","vitamin k2 mk-7"],excl=r"\bd3\b|\bd-3\b|vitamin d|\bdk3?\b",parent_kw='vitamin k2')
add('v2-lutein-zeaxanthin','35a','lutein and zeaxanthin supplements',r"lutein|luteina",["lutein and zeaxanthin supplements","lutein and zeaxanthin","lutein zeaxanthin","zeaxanthin and lutein for eyes"],req=r"zeaxanthin|zeaxantina",qual=r"zeaxan",excl=r"spray|eye ?drops",parent_kw='lutein')
add('v3-lutein-20mg','35b','lutein 20mg',r"lutein|luteina",["lutein 20mg","lutein 20 mg","lutein 20mg softgels","lutein 20 mg with zeaxanthin"],'dose',r"\b20\s*mg\b",r"\b20\s*mg\b",qual=r"20\s*mg",parent_kw='lutein',extra={'sleeve_words':['20mg','20 mg']})
# rest
add('r01-saffron-gummies','1','saffron gummies',r"saffron|safron|affron|satiereal",["saffron gummies","saffron gummy","saffron gummies for adults","saffron supplements gummies"],'format',r"gumm(?:y|ies)",fmt='gummy',excl=KIDS,qual=r"gumm",parent_kw='saffron')
add('r02-butyrate','3','butyrate',r"butyr|butyric",["butyrate","sodium butyrate","butyrate supplement","butyrate gut health supplement"],excl=r"tributyr",parent_kw='butyrate',extra={'scored_on_why':'parent; tributyrin rows excluded (tributyrin is IN DEV)'})
add('r03-electrolyte-gummies','4','electrolyte gummies',r"electrolyt|salt chews",["electrolyte gummies","electrolyte chews","electrolytes gummies","electrolyte gummy"],'format',r"gumm(?:y|ies)|chews?",parent_kw='electrolytes',extra={'gate_format':'gummy','other_forms':['chew']})
add('r04-l-theanine-gummies','6','l theanine gummies',r"theanine",["l theanine gummies","l-theanine gummies","theanine gummies","l theanine chewable"],'format',r"gumm(?:y|ies)|chewable",fmt='gummy',qual=r"gumm|chewable",parent_kw='l theanine')
add('r05-hydrogen-water-tablets','11','hydrogen water tablets',r"hydrogen|\bh2\b",["hydrogen water tablets","hydrogen tablets","molecular hydrogen tablets","hydrogen tablets for drinking water"],excl=r"peroxide",parent_kw='hydrogen')
add('r06-oral-probiotics','12','oral probiotics',r"oral|dental|mouth|teeth|breath|k12|m18",["oral probiotics","dental probiotic","oral probiotic","oral probiotics for teeth and gums"],microbial=True,parent_kw='oral probiotics')
add('r07-prenatal-choline','14','choline prenatal',r"choline",["choline prenatal","prenatal choline","choline supplements pregnancy","prenatal with choline"],req=r"prenatal|pregnan|maternal|pre-natal",qual=r"prenatal|pregnan",parent_kw='choline')
add('r08-fodmap-enzymes','15','fodmap digestive enzymes',r"fodmap|fructan",["fodmap digestive enzymes","fodmap enzymes","fructan hydrolase","fructan hydrolase digestive enzyme"],parent_kw='fodmap')
add('r09-lemon-balm-tincture','16','lemon balm tincture',r"lemon ?balm",["lemon balm tincture","lemon balm drops","lemon balm extract","organic lemon balm tincture"],'format',r"tincture|drops|extract|liquid",fmt='liquid',qual=r"tincture|drops|extract",excl=r"\btea\b|seeds?|plant|essential oil|lip balm|salve|ointment|cream",parent_kw='lemon balm')
add('r10-ttfd','18','ttfd',r"ttfd|thiamine tetrahydrofurfuryl|allithiamine",["ttfd","ttfd thiamine","ttfd thiamine b1 supplement","thiamine ttfd"],parent_kw='thiamine')
add('r11-monolaurin','19','monolaurin',r"monolaur|lauric",["monolaurin","monolaurin supplement","monolaurin and lysine supplement","lysine monolaurin"],parent_kw='monolaurin')
add('r12-sea-buckthorn-oil','21','sea buckthorn oil',r"buckthorn|espino amarillo|omega 7",["sea buckthorn oil","sea buckthorn oil capsules","seabuckthorn oil","sea buckthorn"],excl=r"for face|for skin|serum|hair",parent_kw='sea buckthorn')
add('r13-low-dose-melatonin','22','low dose melatonin',r"melatonin",["low dose melatonin","melatonin 0.5mg","melatonin 300 mcg","melatonin low dose"],'dose',r"low dose|micro|0?\.\s?[35]\s*mg|0?\.\s?[35]\b|\b(?:300|500)\s*mcg",r"low[- ]dose|micro[- ]?dose|0?\.\s?[35]\s*mg|\b(?:300|500)\s*mcg",parent_kw='melatonin',extra={'sleeve_words':['0.5mg','300 mcg','low dose']})
add('r14-tart-cherry-gummies','24','tart cherry gummies',r"cherr",["tart cherry gummies","cherry tart gummies","tart cherry gummy","tart cherry extract gummies"],'format',r"gumm(?:y|ies)",fmt='gummy',qual=r"gumm",parent_kw='tart cherry')
add('r15-melatonin-free-sleep','26','melatonin free sleep aid',r"melatonin[- ]free|sleep",["melatonin free sleep aid","melatonin free sleep gummies","melatonin free sleep aid for adults","melatonin free sleep aid gummies"],req=r"melatonin[- ]free|non[- ]melatonin|no melatonin|without melatonin|0 ?mg melatonin",qual=r"melatonin free",excl=r"patch",parent_kw='sleep aid',extra={'benefit_led':True})
add('r16-glp1-supplement','39a','glp-1 supplement weight loss',r"\bglp",["glp-1 supplement weight loss","glp1 booster","glp 1 booster","glp1 supplement"],excl=r"patch",parent_kw='glp-1',extra={'benefit_led':True,'scored_on_why':'parent; drug-name pill rows (wegovy, ozempic, tirzepatide, semaglutide, zepbound) left out of demand because they do not name GLP'})
rep=[]
for fid,(s,kept,n,dropped) in S.items():
    json.dump(s,open(f'/home/user/toniiq-idea-pipeline/scorer/specs/fable38-2026-11-25/{fid}.json','w'),indent=1)
    H=re.compile(s['hero_regex'],re.I); bad=[k for k in s['cluster_keywords'] if not H.search(k) or (s.get('qualifier_regex') and not re.search(s['qualifier_regex'],k,re.I))]
    rep.append(f"{fid}: {s['scored_on']} kept {kept} clicks/{n} rows; dropped {len(dropped)} {dropped[:6]} BADCL {bad}")
print("\n".join(rep))
