# Copy of Grok eval_v112.py with holdout_v110 removed (its dev labels were not in the 8 Nov export). Run from /workspace/challenge-65/fork/gate.
"""Multi-set offline validation for gate_v112 (and the v111 baseline): gold v7 + spent holdouts v96..v111 with adjudicated / corrected labels.
Metric definitions unchanged from eval_v111 (P1 top-12 precision, P2 format violations in top 12, P3 P3X codes in top 12, P4 duplicate lines in
top 12, P5 false drops / excluded (variant dups excluded), P7 agreement). Unresolved adjudicated items are scored best (gate's call stands) and
worst (label stands). v110 uses the dev copy with Gautam Round 13 answers. Judge = cache only (no live calls); misses are counted as fallbacks.
Optional --corr GOLD_CORRECTIONS_v112.json applies append-only gold corrections (ASIN -> code) on top of the labels.
usage: python3 eval_v112.py gate_v112|gate_v111 [--corr file] [--out file.json]"""
import json,sys,collections,importlib,os
B='/workspace/challenge-65/fork/gate/'; sys.path.insert(0,B)
GM=sys.argv[1] if len(sys.argv)>1 and not sys.argv[1].startswith('-') else 'gate_v112'
G=importlib.import_module(GM)
SETS=[('holdout_v96','holdout_labels.json'),('holdout_v97','holdout_labels_r10_corrected.json'),('holdout_v98','holdout_labels.json'),
      ('holdout_v99','holdout_labels_r11_corrected.json'),('holdout_v100','holdout_labels.json'),
      ('holdout_v111','holdout_labels_adjudicated.json')]
for p in ('holdout_v9','holdout_v91','holdout_v92','holdout_v93','holdout_v94','holdout_v95')+tuple(s for s,_ in SETS):
    if os.path.exists(B+p+'/shelf_specs.json'): G.add_holdout_specs(B+p+'/shelf_specs.json')
INC={'IN_OK','HERO_LED_COMPLEX'}; FMTX={'EX_FORMAT_MISMATCH','EX_FORMAT_UNSTATED'}; P3X={'EX_PET','EX_INFANT','EX_KIDS','EX_NOT_SUPPLEMENT','EX_TOPICAL'}
def arg(k):
    return sys.argv[sys.argv.index(k)+1] if k in sys.argv else None
CORR={}
if arg('--corr'):
    for c in json.load(open(arg('--corr')))['corrections']: CORR[(c['shelf'],c['asin'])]=c
def load():
    out={}
    L=json.load(open(B+'gold_work/listings.json')); V=json.load(open(B+'gold_set_v7.json')); gl=collections.defaultdict(dict)
    for r in V['listings']: gl[r['shelf']][r['id']]=dict(code=r['hero_code'],line_id=r['line_id'])
    out['gold7']=({s:L[s] for s in V['stats']},gl)
    for d,lf in SETS:
        recs=json.load(open(B+d+'/holdout_listings.json')); lab=json.load(open(B+d+'/'+lf))['labels']
        out[d]=({s:r for s,r in recs.items() if s in G.SH},lab)
    return out
def resolve(recs,lab,mode):
    out=collections.defaultdict(dict)
    for sh,R in lab.items():
        asn={x['id']:x['asin'] for x in recs.get(sh,[])}
        for i,l in R.items():
            l=dict(l); a=l.get('adj') or {}
            if a.get('status')=='unresolved' and mode=='best':
                if a['gate_include']: l['code']='IN_OK'; l['line_id']=l.get('line_id') or f'adj-{sh}-{i}'
                else: l['code']=a['gate_code'] if a['gate_code'] not in INC else 'HERO_SECONDARY'
            c=CORR.get((sh,asn.get(i)))
            if c:
                l['code']=c['code']; l['corrected']=c['id']
                if c['code'] in INC: l['line_id']=c.get('line_id') or l.get('line_id') or f'corr-{sh}-{i}'
            out[sh][i]=l
    return out
cj=lambda sh,x:G.judge(sh,x,cache_only=True); cm=lambda sh,a,b:G.judge_merge(sh,a,b,cache_only=True)
def evaluate(name,recs,lab):
    T=collections.Counter(); ex=collections.defaultdict(list)
    for sh,R in recs.items():
        r=G.run_shelf(sh,R,judge_fn=cj,merge_fn=cm); D=r['dec']; top=r['top']; kept=set(r['kept'])
        byid={x['id']:x for x in R}
        lin=lambda i:lab[sh][i].get('line_id') if lab[sh][i]['code'] in INC else None
        T['top']+=len(top); T['top_in']+=sum(lab[sh][i]['code'] in INC for i in top)
        T['p2']+=sum(lab[sh][i]['code'] in FMTX for i in top); T['p3']+=sum(lab[sh][i]['code'] in P3X for i in top)
        ls=[lin(i) for i in top if lin(i)]; T['p4']+=len(ls)-len(set(ls))
        for l in set(ls):
            if ls.count(l)>1: ex['p4'].append(dict(set=name,shelf=sh,line=l,ids=[(i,byid[i]['asin'],byid[i]['brand'],byid[i]['title'][:70]) for i in top if lin(i)==l]))
        exc=[i for i in D if not D[i]['include'] and D[i]['code']!='EX_VARIANT_DUP']; fd=[i for i in exc if lab[sh][i]['code'] in INC]
        T['exc']+=len(exc); T['fd']+=len(fd)
        T['n']+=len(D); T['agree']+=sum((D[i]['include'] or D[i]['code']=='EX_VARIANT_DUP')==(lab[sh][i]['code'] in INC) for i in D)
        un=[i for i in D if D[i]['verdict3']=='UNSURE']; T['unsure']+=len(un)
        jd=[i for i in un if (D[i].get('judge') or {}).get('verdict') in ('IN','OUT')]; T['judged']+=len(jd); T['judge_miss']+=len(un)-len(jd)
        T['judge_ok']+=sum((D[i]['judge']['verdict']=='IN')==(lab[sh][i]['code'] in INC) for i in jd)
        T['merge_pairs']+=len(r['merges']); T['merge_miss']+=sum(1 for m in r['merges'] if not m['judge'])
        def row(i,kind):
            d=D[i]; return dict(set=name,shelf=sh,id=i,asin=byid[i]['asin'],label=lab[sh][i]['code'],corrected=lab[sh][i].get('corrected'),
                                adj=(lab[sh][i].get('adj') or {}).get('status'),gate=d['code'],detail=str(d['detail'])[:110],unsure=d.get('unsure'),
                                judge=(d.get('judge') or {}).get('verdict'),judge_rule=(d.get('judge') or {}).get('rule_id'),title=byid[i]['title'][:100],kind=kind)
        for i in top:
            if lab[sh][i]['code'] not in INC: ex['p1'].append(row(i,'top12 wrong-in'))
        for i in fd: ex['p5'].append(row(i,'false drop'))
    m=dict(P1=T['top_in']/max(T['top'],1),P2=T['p2'],P3=T['p3'],P4=T['p4'],P5=T['fd']/max(T['exc'],1),P7=T['agree']/max(T['n'],1),
           unsure_rate=T['unsure']/max(T['n'],1),judge_acc=T['judge_ok']/max(T['judged'],1),counts=dict(T))
    return m,ex
def bars(m): return dict(P1=m['P1']>=0.95,P2=m['P2']==0,P3=m['P3']==0,P4=m['P4']==0,P5=m['P5']<=0.05,P7=m['P7']>=0.90)
def pooled(Ts):
    T=collections.Counter()
    for t in Ts: T.update(t)
    return dict(P1=T['top_in']/T['top'],P2=T['p2'],P3=T['p3'],P4=T['p4'],P5=T['fd']/T['exc'],P7=T['agree']/T['n'],unsure_rate=T['unsure']/T['n'],judge_acc=T['judge_ok']/max(T['judged'],1),counts=dict(T))
if __name__=='__main__':
    S=load(); res={}
    for mode in ('best','worst'):
        per={}; exs={}
        for n,(recs,lab) in S.items():
            m,ex=evaluate(n,recs,resolve(recs,lab,mode)); m['pass']=bars(m); per[n]=m; exs[n]=ex
            c=m['counts']; print(f"{mode:5} {n:13} P1 {m['P1']:.1%} ({c['top_in']}/{c['top']}) P2 {m['P2']} P3 {m['P3']} P4 {m['P4']} P5 {m['P5']:.1%} ({c['fd']}/{c['exc']}) P7 {m['P7']:.1%} unsure {c['unsure']} judge_miss {c['judge_miss']} merge_miss {c['merge_miss']}",flush=True)
        P=pooled([per[n]['counts'] for n in per]); P['pass']=bars(P); hold=pooled([per[n]['counts'] for n in per if n!='gold7']); hold['pass']=bars(hold)
        c=P['counts']; print(f"{mode:5} POOLED        P1 {P['P1']:.1%} ({c['top_in']}/{c['top']}) P2 {P['P2']} P3 {P['P3']} P4 {P['P4']} P5 {P['P5']:.1%} ({c['fd']}/{c['exc']}) P7 {P['P7']:.1%} unsure {c['unsure']} judge_miss {c['judge_miss']} merge_miss {c['merge_miss']}")
        c=hold['counts']; print(f"{mode:5} HOLDOUTS-ALL  P1 {hold['P1']:.1%} ({c['top_in']}/{c['top']}) P2 {hold['P2']} P3 {hold['P3']} P4 {hold['P4']} P5 {hold['P5']:.1%} ({c['fd']}/{c['exc']}) P7 {hold['P7']:.1%}")
        res[mode]=dict(per_set=per,pooled=P,holdouts_pooled=hold,errors=exs)
    out=arg('--out') or B+f'eval_v112_{GM}.json'
    json.dump(dict(gate=GM,corrections=arg('--corr'),results=res),open(out,'w'),indent=1,default=str); print('wrote',out)
