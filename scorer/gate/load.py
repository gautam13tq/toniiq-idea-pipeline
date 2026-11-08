import json,re
B='/workspace/challenge-65/'
FILES={'stage1':B+'apify_page1_2026-10-26.json','stage2':B+'s2/apify_page1_s2_2026-10-26.json','flat':B+'s2/apify_page1_flat_2026-10-26.json',
 'v2':'/workspace/competitive-ideas-2026-10-26/v2/apify_page1_2026-10-26.json','new':B+'fork/gate/apify_page1_shelves_2026-10-28.json',
 'thymo':B+'fork/thymo_2026-10-28/apify_search_2026-10-28.json'}
def badge(v):
    m=re.search(r'([\d.]+)\s*([KkMm]?)\+?\s*bought',str(v or ''))
    if not m: return 0
    x=float(m.group(1)); g=m.group(2).lower(); return int(x*(1000 if g=='k' else 1e6 if g=='m' else 1))
def raw(src):
    d=json.load(open(FILES[src])); return d['items'] if isinstance(d,dict) else d
def page(src,kw):
    rows=sorted([x for x in raw(src) if (x.get('keyword') or '').lower()==kw],key=lambda x:(x.get('page') or 1,x.get('searchResultPosition',0)))
    out=[]
    for i,x in enumerate(rows):
        out.append(dict(pos=i+1,asin=x['asin'],title=(x.get('productDescription') or ''),reviews=int(x.get('countReview') or 0),
            sold=badge(x.get('salesVolume')),badge=x.get('salesVolume'),sp=x.get('sponsored'),page=x.get('page') or 1))
    return out
