# Tiny chess engine (0x88 board): negamax + alpha-beta, quiescence,
# Zobrist transposition table, killer moves, MVV-LVA ordering,
# iterative deepening to a fixed node budget, tapered material +
# piece-square evaluation. Lone-king mate bonus drives the enemy king
# to the edge and closes in with our king.
import os,json,random,urllib.request as u
random.seed(42)
P,N,B,R,Q,K=1,2,3,4,5,6
V=(0,100,320,330,500,900,0)
PS_P=(0,0,0,0,50,50,50,50,10,10,20,30,5,5,10,25,0,0,0,20,5,-5,-10,0,5,10,10,-20,0,0,0,0)
PS_N=(-50,-40,-30,-30,-40,-20,0,0,-30,0,10,15,-30,5,15,20,-30,0,15,20,-30,5,10,15,-40,-20,0,5,-50,-40,-30,-30)
PS_B=(-20,-10,-10,-10,-10,0,0,0,-10,0,5,10,-10,5,5,10,-10,0,10,10,-10,10,10,10,-10,5,0,0,-20,-10,-10,-10)
PS_R=(0,0,0,0,5,10,10,10,-5,0,0,0,-5,0,0,0,-5,0,0,0,-5,0,0,0,-5,0,0,0,0,0,0,5)
PS_Q=(-20,-10,-10,-5,-10,0,0,0,-10,0,5,5,-5,0,5,5,0,0,5,5,-10,5,5,5,-10,0,5,0,-20,-10,-10,-5)
PS_K=(-30,-40,-40,-50,-30,-40,-40,-50,-30,-40,-40,-50,-30,-40,-40,-50,-20,-30,-30,-40,-10,-20,-20,-20,20,20,0,0,20,30,10,0)
PS_E=(-50,-40,-30,-20,-30,-20,-10,0,-30,-10,20,30,-30,-10,30,40,-30,-10,30,40,-30,-10,20,30,-30,-30,0,0,-50,-30,-30,-30)
PS=(None,PS_P,PS_N,PS_B,PS_R,PS_Q,PS_K)
NS=(33,31,18,14,-14,-18,-31,-33)
DS=(15,17,-15,-17)
OS=(1,-1,16,-16)
KS=OS+DS
KP=[15]*128
KP[4]=12;KP[7]=14;KP[0]=13;KP[116]=3;KP[119]=11;KP[112]=7
M=100000;NB=60000;MD=32
b=[0]*128
T=1
C=0
E=-1
Kg=[4,116]
U=[]
Nd=0
TT={}
Kl=[[0,0] for _ in range(64)]
G=random.getrandbits
ZB=[[G(64) for _ in range(128)] for _ in range(12)]
ZS=G(64)
ZC=[G(64) for _ in range(16)]
ZE=[G(64) for _ in range(8)]
Z=0
def zp(p,s):
    return ZB[(p-1) if p>0 else (5-p)][s] if p else 0
def pf(f):
    global b,T,C,E,Kg,Z
    b=[0]*128
    Kg=[4,116]
    Z=0
    w=f.split()
    for r,row in enumerate(w[0].split("/")):
        rk=7-r
        fl=0
        for ch in row:
            if ch.isdigit(): fl+=int(ch)
            else:
                s=rk*16+fl
                pc="PNBRQK".index(ch.upper())+1
                if ch.islower(): pc=-pc
                b[s]=pc
                Z^=zp(pc,s)
                if abs(pc)==K: Kg[0 if pc>0 else 1]=s
                fl+=1
    T=1 if w[1]=="w" else -1
    C=0
    if w[2]!="-":
        if "K" in w[2]: C|=1
        if "Q" in w[2]: C|=2
        if "k" in w[2]: C|=4
        if "q" in w[2]: C|=8
    E=-1
    if len(w)>3 and w[3]!="-": E=(int(w[3][1])-1)*16+(ord(w[3][0])-97)
    if T<0: Z^=ZS
    Z^=ZC[C]
    if E>=0: Z^=ZE[E&7]
def atk(s,w):
    for d in ((-15,-17) if w else (15,17)):
        t=s+d
        if not (t&0x88) and b[t]==(P if w else -P): return True
    for d in NS:
        t=s+d
        if not (t&0x88) and b[t]==(N if w else -N): return True
    for d in KS:
        t=s+d
        if not (t&0x88) and b[t]==(K if w else -K): return True
    for d in DS:
        t=s+d
        while not (t&0x88):
            p=b[t]
            if p:
                if p==(B if w else -B) or p==(Q if w else -Q): return True
                break
            t+=d
    for d in OS:
        t=s+d
        while not (t&0x88):
            p=b[t]
            if p:
                if p==(R if w else -R) or p==(Q if w else -Q): return True
                break
            t+=d
    return False
def gen():
    mv=[]
    us=T
    for s in range(128):
        if s&0x88: continue
        p=b[s]
        if p==0 or (p>0)!=(us>0): continue
        t=abs(p)
        if t==P:
            d=16 if us>0 else -16
            sr=1 if us>0 else 6
            pr=7 if us>0 else 0
            o=s+d
            if not (o&0x88) and b[o]==0:
                if (o>>4)==pr:
                    for x in (Q,R,B,N): mv.append(s|(o<<7)|(x<<14))
                else:
                    mv.append(s|(o<<7))
                    if (s>>4)==sr:
                        w=s+2*d
                        if b[w]==0: mv.append(s|(w<<7))
            for dd in (d-1,d+1):
                to=s+dd
                if to&0x88: continue
                q=b[to]
                if q!=0 and (q>0)!=(us>0):
                    if (to>>4)==pr:
                        for x in (Q,R,B,N): mv.append(s|(to<<7)|(x<<14))
                    else: mv.append(s|(to<<7))
                elif to==E: mv.append(s|(to<<7))
        elif t==N or t==K:
            for d in (NS if t==N else KS):
                to=s+d
                if to&0x88: continue
                q=b[to]
                if q==0 or (q>0)!=(us>0): mv.append(s|(to<<7))
        else:
            st=DS if t==B else OS if t==R else DS+OS
            for d in st:
                to=s+d
                while not (to&0x88):
                    q=b[to]
                    if q==0: mv.append(s|(to<<7))
                    else:
                        if (q>0)!=(us>0): mv.append(s|(to<<7))
                        break
                    to+=d
    if us>0:
        if (C&1) and b[4]==K and b[7]==R and b[5]==0 and b[6]==0 and not atk(4,False) and not atk(5,False) and not atk(6,False): mv.append(4|(6<<7))
        if (C&2) and b[4]==K and b[0]==R and b[3]==0 and b[2]==0 and b[1]==0 and not atk(4,False) and not atk(3,False) and not atk(2,False): mv.append(4|(2<<7))
    else:
        if (C&4) and b[116]==-K and b[119]==-R and b[117]==0 and b[118]==0 and not atk(116,True) and not atk(117,True) and not atk(118,True): mv.append(116|(118<<7))
        if (C&8) and b[116]==-K and b[112]==-R and b[115]==0 and b[114]==0 and b[113]==0 and not atk(116,True) and not atk(115,True) and not atk(114,True): mv.append(116|(114<<7))
    return mv
def mk(m):
    global T,C,E,Z
    fr=m&127;to=(m>>7)&127;pr=(m>>14)&7
    p=b[fr];cap=b[to];cs=to
    Z^=zp(p,fr)
    if cap: Z^=zp(cap,to)
    Z^=ZC[C]
    if E>=0: Z^=ZE[E&7]
    if abs(p)==P and to==E and cap==0:
        cs=to-16 if T>0 else to+16
        cap=b[cs];b[cs]=0;Z^=zp(cap,cs)
    rm=None
    if abs(p)==K and abs(to-fr)==2:
        rm=(fr+3,fr+1) if to>fr else (fr-4,fr-1)
        Z^=zp(b[rm[0]],rm[0]);b[rm[1]]=b[rm[0]];b[rm[0]]=0;Z^=zp(b[rm[1]],rm[1])
    U.append((m,cap,cs,C,E,rm))
    b[fr]=0
    np=(pr if T>0 else -pr) if pr else p
    b[to]=np;Z^=zp(np,to)
    if abs(p)==K: Kg[0 if T>0 else 1]=to
    C&=KP[fr]&KP[to]
    if abs(p)==P and abs(to-fr)==32: E=(fr+to)//2
    else: E=-1
    Z^=ZC[C]
    if E>=0: Z^=ZE[E&7]
    Z^=ZS
    T=-T
def un():
    global T,C,E,Z
    m,cap,cs,oc,oe,rm=U.pop()
    fr=m&127;to=(m>>7)&127;pr=(m>>14)&7
    T=-T
    Z^=ZS
    Z^=ZC[C]
    if E>=0: Z^=ZE[E&7]
    C=oc;E=oe
    Z^=ZC[C]
    if E>=0: Z^=ZE[E&7]
    mv=b[to];b[to]=0;Z^=zp(mv,to)
    if rm:
        Z^=zp(b[rm[1]],rm[1]);b[rm[0]]=b[rm[1]];b[rm[1]]=0;Z^=zp(b[rm[0]],rm[0])
    if pr: b[fr]=P if T>0 else -P
    else: b[fr]=mv
    Z^=zp(b[fr],fr)
    if cap: b[cs]=cap;Z^=zp(cap,cs)
    if abs(mv)==K: Kg[0 if T>0 else 1]=fr
def ev():
    s=0;ph=0;wk=bk=0;wm=bn=0
    for sq in range(128):
        if sq&0x88: continue
        p=b[sq]
        if not p: continue
        t=abs(p);rk=sq>>4;fl=sq&7
        if t not in(P,K): ph+=(0,0,1,1,2,4,0)[t]
        if t==K:
            if p>0: wk=sq
            else: bk=sq
            continue
        if p>0: wm+=V[t]
        else: bn+=V[t]
        f2=fl if fl<4 else 7-fl
        if p>0: s+=V[t]+PS[t][(7-rk)*4+f2]
        else: s-=V[t]+PS[t][rk*4+f2]
    f=min(ph,24)
    for sq,sg in ((wk,1),(bk,-1)):
        rk=sq>>4;fl=sq&7;f2=fl if fl<4 else 7-fl
        if sg>0: mg=PS_K[(7-rk)*4+f2];eg=PS_E[(7-rk)*4+f2]
        else: mg=PS_K[rk*4+f2];eg=PS_E[rk*4+f2]
        s+=sg*(mg*f+eg*(24-f))//24
    if bn==0 and wm>=500: s+=max(abs((bk&7)-3),abs((bk>>4)-3))*25+(7-max(abs((wk&7)-(bk&7)),abs((wk>>4)-(bk>>4))))*12
    elif wm==0 and bn>=500: s-=max(abs((wk&7)-3),abs((wk>>4)-3))*25+(7-max(abs((wk&7)-(bk&7)),abs((wk>>4)-(bk>>4))))*12
    return s
def ms(m,pl,tm):
    if m==tm: return 1<<24
    fr=m&127;to=(m>>7)&127;cap=b[to]
    if cap==0 and abs(b[fr])==P and to==E: cap=P
    if cap: return (V[abs(cap)]*10-V[abs(b[fr])]/10)+(1<<20)
    if m==Kl[pl][0]: return 1<<19
    if m==Kl[pl][1]: return 1<<18
    return 0
def om(mv,pl,tm):
    return sorted(mv,key=lambda m:-ms(m,pl,tm))
class Ab(Exception): pass
def q(a,be,pl):
    global Nd
    Nd+=1
    if Nd>NB: raise Ab
    st=ev()*T
    if st>=be: return be
    if st>a: a=st
    if atk(Kg[0 if T>0 else 1],T<0): mv=gen()
    else:
        mv=[]
        for m in gen():
            to=(m>>7)&127
            if b[to]!=0 or (abs(b[m&127])==P and to==E): mv.append(m)
    for m in om(mv,pl,0):
        mk(m)
        if not atk(Kg[0 if T<0 else 1],T>0):
            s=-q(-be,-a,pl+1);un()
            if s>=be: return be
            if s>a: a=s
        else: un()
    return a
def s(d,a,be,pl):
    global Nd
    Nd+=1
    if Nd>NB: raise Ab
    if d<=0: return q(a,be,pl)
    en=TT.get(Z);tm=0
    if en and en[0]>=d:
        d0,s0,fl,bm=en;tm=bm
        if fl==0: return s0
        if fl==1 and s0>a: a=s0
        elif fl==2 and s0<be: be=s0
        if a>=be: return s0
    elif en: tm=en[3]
    mv=om(gen(),pl,tm)
    bs=-M;bm=0;lg=0;oa=a
    for m in mv:
        mk(m)
        if atk(Kg[0 if T<0 else 1],T>0): un();continue
        lg+=1
        sc=-s(d-1,-be,-a,pl+1);un()
        if sc>bs: bs=sc;bm=m
        if sc>a: a=sc
        if a>=be:
            if b[(m>>7)&127]==0 and not ((m>>14)&7):
                if Kl[pl][0]!=m: Kl[pl][1]=Kl[pl][0];Kl[pl][0]=m
            break
    if lg==0:
        if atk(Kg[0 if T>0 else 1],T<0): return -M+pl
        return 0
    fl=2 if bs<=oa else 1 if bs>=be else 0
    if Z not in TT or TT[Z][0]<=d: TT[Z]=(d,bs,fl,bm)
    return bs
def uci(m):
    fr=m&127;to=(m>>7)&127;pr=(m>>14)&7
    r="abcdefgh"[fr&7]+str((fr>>4)+1)+"abcdefgh"[to&7]+str((to>>4)+1)
    if pr: r+="nbrq"[pr-2]
    return r
def cm(fen,lu):
    global Nd
    pf(fen)
    TT.clear()
    rm=[m for m in gen() if uci(m) in lu]
    rl=[]
    for m in rm:
        mk(m)
        if not atk(Kg[0 if T<0 else 1],T>0): rl.append(m)
        un()
    if not rl: return lu[0]
    bm=rl[0];bs=-M
    for d in range(1,MD+1):
        Nd=0
        try:
            a=-M;be=M;cb=bm;cs=-M
            for m in om(rl,0,bm):
                mk(m);sc=-s(d-1,-be,-a,1);un()
                if sc>cs: cs=sc;cb=m
                if sc>a: a=sc
            bm=cb;bs=cs
            if bs>M-100: break
        except Ab: break
    return uci(bm)
ENV=os.environ["MAKEFUN_ENV_URL"]
def post(p,bo):
    rq=u.Request(ENV+p,data=json.dumps(bo).encode(),headers={"content-type":"application/json"})
    with u.urlopen(rq) as r: return json.load(r)
if __name__=="__main__":
    while True:
        g=post("/game",{})
        if g["status"]=="done": break
        while g["status"]=="your_move":
            g=post("/move",{"game":g["game"],"move":cm(g["fen"],g["legal_moves"])})
