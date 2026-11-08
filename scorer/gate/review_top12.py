"""Review a scored shelf: top 12 kept listings with ASIN, URL, title, label lead, price, reviews, image URL.
Usage: python3 review_top12.py --listings FILE.json [--shelf NAME ...] [--specs shelf_specs.json] [--raw RAW.json ...] [--live] [--md OUT.md] [--json OUT.json]
  FILE.json = {shelf: [listing records]} (e.g. holdout_vNNN/holdout_listings.json).
  Judge is cache-only unless --live (live judge only touches rules-UNSURE items). No Apify calls."""
import sys,os,json,glob
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
import gate_v112 as G
A=sys.argv
def opts(k): return [A[i+1] for i,a in enumerate(A) if a==k and i+1<len(A)]
LIVE='--live' in A
lf=opts('--listings'); assert lf,'--listings required'
sp=opts('--specs') or [os.path.join(os.path.dirname(os.path.abspath(lf[0])),'shelf_specs.json')]
for f in sp:
    if os.path.exists(f): G.add_holdout_specs(f)
L=json.load(open(lf[0])); shelves=opts('--shelf') or [s for s in L if s in G.SH]
raws=opts('--raw') or glob.glob(os.path.join(os.path.dirname(os.path.abspath(lf[0])),'raw_junglee*.json')) or glob.glob(os.path.join(os.path.dirname(os.path.abspath(__file__)),'*','raw_junglee*.json'))
IMG={}
for f in raws:
    for r in json.load(open(f)):
        u=r.get('thumbnailImage') or ((r.get('highResolutionImages') or [None])[0])
        for k in (r.get('asin'),r.get('originalAsin')):
            if k and u: IMG.setdefault(k,u)
jf=(lambda s,x:G.judge(s,x)) if LIVE else (lambda s,x:G.judge(s,x,cache_only=True))
mf=(lambda s,a,b:G.judge_merge(s,a,b)) if LIVE else (lambda s,a,b:G.judge_merge(s,a,b,cache_only=True))
out={}; md=[]
for sh in shelves:
    R=L[sh]; byid={x['id']:G.norm9(x) for x in R}
    r=G.run_shelf(sh,R,judge_fn=jf,merge_fn=mf)
    rows=[]
    for rank,i in enumerate(r['top'],1):
        x=byid[i]; lead,_=G.G0._lead10(x)
        rows.append(dict(rank=rank,asin=x['asin'],url=f"https://www.amazon.com/dp/{x['asin']}",title=x.get('title'),label_lead=lead,
                         price=x.get('price'),reviews=x.get('reviews'),image=IMG.get(x['asin']) or IMG.get(x.get('original_asin')),code=r['dec'][i]['code']))
    nf=sum(1 for d in r['dec'].values() if d.get('judge_fallback'))
    out[sh]=dict(kept=len(r['kept']),judge_fallback=nf,top=rows)
    md.append(f"## {sh} — kept {len(r['kept'])}, top {len(rows)}"+(f" (judge fallback on {nf} UNSURE)" if nf else ''))
    md.append('| # | ASIN | Title | Label lead | Price | Reviews | Image |'); md.append('|---|---|---|---|---|---|---|')
    for w in rows:
        t=(w['title'] or '').replace('|','/')[:90]; ld=(w['label_lead'] or '—').replace('|','/')[:40]
        md.append(f"| {w['rank']} | [{w['asin']}]({w['url']}) | {t} | {ld} | {w['price'] if w['price'] is not None else '—'} | {w['reviews'] if w['reviews'] is not None else '—'} | {('[img]('+w['image']+')') if w['image'] else '—'} |")
    md.append('')
txt='\n'.join(md)
if opts('--md'): open(opts('--md')[0],'w').write(txt)
if opts('--json'): json.dump(out,open(opts('--json')[0],'w'),indent=1)
print(txt)
