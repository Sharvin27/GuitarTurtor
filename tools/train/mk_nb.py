import json
C = []
def md(s): C.append({"cell_type": "markdown", "metadata": {}, "source": s.strip().splitlines(True)})
def code(s): C.append({"cell_type": "code", "metadata": {}, "execution_count": None, "outputs": [], "source": s.strip().splitlines(True)})

md("""# GuitarTurtor - string/fret chooser fine-tune (GuitarSet pretrain -> priority fine-tune on our songs)
**Honest warning:** 2 songs (~850 notes) CANNOT train a neural net from scratch - it overfits. Recipe: pretrain on a big public set, then fine-tune on our songs with a much higher sample weight; select by the HELD-OUT part of our songs (last 40% + leave-one-song-out); GuitarSet test is only a sanity check. For a real audio->pitch fine-tune add more data: **GuitarSet** (CC BY 4.0, used here), **GAPS** (classical guitar), **SynthTab** (huge synthetic tab/audio). Put extra (audio, tab) pairs in `GuitarTurtor/train/pairs/<name>/`.
Locally run `python package_data.py --guitarset`, unzip `out/GuitarTurtor_train.zip` into Drive `MyDrive/`. Audio is private; never commit it.""")
code("!pip -q install torch numpy scikit-learn")
code("from google.colab import drive; drive.mount('/content/drive')\nROOT='/content/drive/MyDrive/GuitarTurtor/train'; import os; print(os.listdir(ROOT))")
code("""import json, zipfile, os, numpy as np, torch, torch.nn as nn
OPEN=[64,59,55,50,45,40]
def cands(p): return [(s,p-OPEN[s]) for s in range(6) if 0<=p-OPEN[s]<=22]
def load_gs(players):   # GuitarSet note_midi per string (data_source 0 = low E)
    z=zipfile.ZipFile(f'{ROOT}/guitarset/annotation.zip'); res=[]
    for nm in z.namelist():
        if not nm.endswith('.jams') or nm[:2] not in players: continue
        d=json.load(z.open(nm)); ns=[]
        for a in d['annotations']:
            if a['namespace']!='note_midi': continue
            s=5-int(a['annotation_metadata']['data_source'])
            for x in a['data']:
                p=int(round(x['value'])); f=p-OPEN[s]
                if 0<=f<=22: ns.append((x['time'],p,s,f))
        res.append(sorted(ns))
    return res
def load_ours(name,lo=0,hi=1):   # skip conf<0.7 / flagged notes
    d=json.load(open(f'{ROOT}/pairs/{name}/tab.json'))['notes']
    d=[n for n in d if n.get('conf',1)>=.7 and not n.get('flags')]
    ts=[n['t'] for n in d]; a0,a1=min(ts),max(ts); T0=a0+lo*(a1-a0); T1=a0+hi*(a1-a0)+(1e-6 if hi<1 else 1)
    return sorted((n['t'],OPEN[s]+f,s,f) for n in d if T0<=n['t']<T1 for s,f in n['n'])
H=4
def seq_to_samples(seq):
    X=[];M=[];Y=[];hist=[]
    for t,p,s,f in seq:
        h=hist[-H:]; h=[(0,0,60,-9)]*(H-len(h))+h
        X.append([p/88]+[v for hs,hf,hp,ht in h for v in (hs/5,hf/22,hp/88,min(t-ht,2.0)/2)])
        m=np.zeros(6)
        for cs,cf in cands(p): m[cs]=1
        M.append(m); Y.append(s); hist.append((s,f,p,t))
    return np.array(X,'f'),np.array(M,'f'),np.array(Y)
class Net(nn.Module):
    def __init__(s): super().__init__(); s.f=nn.Sequential(nn.Linear(1+4*H,128),nn.ReLU(),nn.Dropout(.2),nn.Linear(128,128),nn.ReLU(),nn.Dropout(.2),nn.Linear(128,6))
    def forward(s,x,m): return s.f(x).masked_fill(m==0,-1e9)
dev='cuda' if torch.cuda.is_available() else 'cpu'
def tens(seqs,w):
    parts=[seq_to_samples(q) for q in seqs if len(q)>1]
    X=np.vstack([p[0] for p in parts]);M=np.vstack([p[1] for p in parts]);Y=np.concatenate([p[2] for p in parts])
    return [torch.tensor(a).to(dev) for a in (X,M,Y)]+[torch.full((len(Y),),float(w)).to(dev)]
def acc(net,T):
    net.eval()
    with torch.no_grad(): return (net(T[0],T[1]).argmax(1)==T[2]).float().mean().item()
def train(net,parts,val,epochs=60,lr=2e-3,patience=8):
    X,M,Y,W=[torch.cat([p[i] for p in parts]) for i in range(4)]
    opt=torch.optim.AdamW(net.parameters(),lr=lr,weight_decay=1e-2); best=(-1,None); bad=0
    for ep in range(epochs):
        net.train(); perm=torch.randperm(len(Y),device=dev)
        for i in range(0,len(Y),512):
            b=perm[i:i+512]; l=(nn.functional.cross_entropy(net(X[b],M[b]),Y[b],reduction='none')*W[b]).sum()/W[b].sum()
            opt.zero_grad(); l.backward(); opt.step()
        a=acc(net,val)
        if a>best[0]: best=(a,{k:v.clone() for k,v in net.state_dict().items()}); bad=0
        else:
            bad+=1
            if bad>=patience: break
    net.load_state_dict(best[1]); return best[0]""")
md("## Recipe: (1) pretrain on GuitarSet, (2) priority fine-tune on our songs (weight 20x), early stop on our held-out last 40%")
code("""SONGS=os.listdir(f'{ROOT}/pairs'); print(SONGS)
gs_tr=load_gs([f'0{i}' for i in range(4)]); gs_va=load_gs(['04']); gs_te=load_gs(['05'])
G_tr,G_va,G_te=tens(gs_tr,1),tens(gs_va,1),tens(gs_te,1)
net=Net().to(dev)
print('pretrain GuitarSet val acc',train(net,[G_tr],G_va,epochs=40))
torch.save(net.state_dict(),'/content/pre.pt')
O_tr=tens([load_ours(n,0,.6) for n in SONGS],20); O_te=tens([load_ours(n,.6,1) for n in SONGS],1)
print('before fine-tune: ours held-out',acc(net,O_te),'GuitarSet test',acc(net,G_te))
print('fine-tune, early stop on our held-out',train(net,[O_tr,G_tr],O_te,epochs=40,lr=5e-4))
res=dict(ours_heldout=acc(net,O_te),guitarset_test=acc(net,G_te),ours_train=acc(net,O_tr)); print(res)""")
code("""loso={}   # leave-one-song-out (needs >=2 songs)
for held in SONGS:
    tr=[n for n in SONGS if n!=held]
    if not tr: continue
    n2=Net().to(dev); n2.load_state_dict(torch.load('/content/pre.pt'))
    V=tens([load_ours(held)],1)
    train(n2,[tens([load_ours(n) for n in tr],20),G_tr],V,epochs=30,lr=5e-4); loso[held]=acc(n2,V)
print('LOSO',loso); res['loso']=loso""")
code("""out=f'{ROOT}/../out'; os.makedirs(out,exist_ok=True)
torch.save(net.state_dict(),f'{out}/string_chooser.pt'); json.dump(res,open(f'{out}/results.json','w'),indent=1); print('saved to',out)""")
md("""## Optional: fine-tune guitab's pitch head
Not run here (needs audio pairs + the guitab repo/weights). Steps: clone guitab, freeze the encoder, train only the pitch head with BCE on frame labels rendered from `tab.json` (`OPEN[s]+fret`), weight our songs 20x vs GuitarSet audio (`audio_mono-mic.zip`, 656 MB, Zenodo 3371780), early-stop on the held-out last 40% of our songs. GuitarSet: CC BY 4.0, Xi et al., ISMIR 2018.""")
json.dump({"cells": C, "metadata": {"accelerator": "GPU", "kernelspec": {"name": "python3", "display_name": "Python 3"}}, "nbformat": 4, "nbformat_minor": 5}, open("colab_finetune.ipynb", "w"), indent=1)
