# **어텐션 추천 신경망 학습** (src/ai/recommendAttention.ts 가 읽는 src/ai/models/recommend-attn.json 을 쓴다 · GPU)
#
#   (scripts/attn-rollout.ts 를 vite build --ssr 로 묶어 attn-rollout.mjs 로)
#   python3 scripts/train-recommend-attn.py --bin attn-rollout.mjs
#
# 1. 일꾼(node)들이 가상 운전자를 과정대로 가르치며, 고를 차례마다 전문가(예전 프로그램)가 고른 판과 그 갈래의 판 전부(많으면 256)를
#    한 묶음으로 적는다 (scripts/attn-rollout.ts). 둘째 차례부터는 방금 배운 신경망이 가르친다 (DAgger).
# 2. 묶음 하나를 통째로 넣어 — 판마다 읽고(은닉 64) 먼저 보는 점수로 위 64판을 추려 셀프 어텐션 2층으로 서로를 보게 한 뒤 —
#    전문가가 고른 판의 확률이 커지도록 배운다. 먼저 보는 점수도 함께 배운다 (전문가가 고른 판이 위 64판에 들도록).
#    계산은 recommendAttention.ts 와 한 줄씩 같다 (층 정규화 앞 · 잔차 · 머리 4 · 앞먹임 ReLU · 자리 정보 없음).
# 3. 차례 신경망(갈래 일곱)도 전문가의 갈래로 배우고, 내보낼 때 온도 `--turn_temp`(0.5)를 굽는다 — 지금 신경망에서 차례를 날카롭게
#    하자 프로그램보다 낮던 레벨(−0.22)이 같아졌다 (2026-11-02, 4,000명).
import argparse, json, math, os, subprocess, time
import numpy as np
import torch
import torch.nn.functional as F

p = argparse.ArgumentParser()
p.add_argument('--bin', required=True)
p.add_argument('--teacher', default='', help='전문가를 프로그램 대신 이 판마다 채점 신경망으로 (scripts/attn-rollout.ts 의 --teacher)')
p.add_argument('--soft', type=int, default=0,
               help='스승의 판마다 채점을 앞단(E1 · pre)에 그대로 심어 얼리고, 스승이 갈래마다 준 확률 × 갈래 안 점수를 통째로 따라 배운다 — 고른 판 하나만 '
                    '따라 배우면 스승의 레벨 +0.133 이 −0.013 으로 줄었다(2026-11-05). 앞단 꼴이 스승과 같아 어텐션은 갈래 비율만 배우면 된다')
p.add_argument('--rounds', type=int, default=3)
p.add_argument('--learners', type=int, default=800)
p.add_argument('--jobs', type=int, default=os.cpu_count())
p.add_argument('--cap', type=int, default=256)
p.add_argument('--work', default='.train-recommend-attn')
p.add_argument('--out', default='src/ai/models/recommend-attn.json')
p.add_argument('--epochs', type=int, default=12)
p.add_argument('--batch', type=int, default=256)
p.add_argument('--lr', type=float, default=1e-3)
p.add_argument('--hidden', type=int, default=64)
p.add_argument('--dim', type=int, default=32)
p.add_argument('--heads', type=int, default=4)
p.add_argument('--ff', type=int, default=64)
p.add_argument('--layers', type=int, default=2)
p.add_argument('--k', type=int, default=64)
p.add_argument('--pre_w', type=float, default=0.5, help='먼저 보는 점수의 손실 무게')
p.add_argument('--turn_hidden', type=int, default=24)
p.add_argument('--turn_epochs', type=int, default=40)
p.add_argument('--turn_temp', type=float, default=0.5)
p.add_argument('--plateau_runs', type=int, default=70, help='한 레벨에 머무는 운전자의 판 수')
p.add_argument('--global', dest='global_', type=int, default=0,
               help='1 — 어텐션 신경망 하나로: 갈래 신경망 없이 모든 갈래의 후보를 한 묶음으로 보고 상황 토큰과 함께 고른다')
p.add_argument('--per_class', type=int, default=24, help='하나로 고를 때 갈래마다 어텐션에 넣는 판 수')
p.add_argument('--data_per_class', type=int, default=64, help='하나로 고를 때 자료의 갈래마다 무작위 판 수')
p.add_argument('--master_w', type=float, default=3.0,
               help='마스터 운행 차례의 무게 — 손해가 거의 다 거기서 났다 (마스터 운행만 프로그램이 고르면 신경망이 프로그램과 같았다)')
a = p.parse_args()
dev = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
t0 = time.time()
secs = lambda: f'{time.time() - t0:.0f}초'
os.makedirs(a.work, exist_ok=True)
torch.manual_seed(0)


def rollout(rnd, model_path):
    out = os.path.join(a.work, f'round-{rnd}')
    os.makedirs(out, exist_ok=True)
    cmd = lambda k: ['node', '--max-old-space-size=8000', a.bin, '--round', str(rnd), '--worker', str(k), '--jobs', str(a.jobs), '--learners', str(a.learners),
                     '--cap', str(a.cap), '--out', out, '--global', str(a.global_), '--perClass', str(a.data_per_class), '--plateauRuns', str(a.plateau_runs)] + (['--model', model_path] if model_path else []) + (['--teacher', a.teacher] if a.teacher else [])
    procs = [subprocess.Popen(cmd(k)) for k in range(a.jobs)]
    for pr in procs:
        if pr.wait() != 0:
            raise RuntimeError('일꾼 실패')
    return out


def load(dirs):
    parts = {k: [] for k in ['rows', 'n', 'short', 'cls_size', 'turn', 'avail', 'cls', 'rowcls', 'tprob']}
    meta = None
    for d in dirs:
        for k in range(a.jobs):
            b = os.path.join(d, f'w{k}')
            meta = json.load(open(b + '.json'))
            m = meta['decisions']
            if m == 0:
                continue
            rd = lambda f: np.fromfile(f'{b}-{f}.f32', dtype=np.float32)
            n = rd('n').astype(np.int64)
            flat = rd('rows').reshape(-1, len(meta['names']))
            # 반정밀도로 담는다 — 하나로 고르는 자료는 묶음이 커서(갈래마다 64판) 단정밀도면 수십 GB 다
            pad = np.zeros((m, a.cap, flat.shape[1]), dtype=np.float16)
            off = np.concatenate([[0], np.cumsum(n)])
            for i in range(m):
                pad[i, :n[i]] = flat[off[i]:off[i + 1]]
            if a.global_:
                rc = rd('rowcls').astype(np.int64)
                padc = np.full((m, a.cap), -1, dtype=np.int64)
                for i in range(m):
                    padc[i, :n[i]] = rc[off[i]:off[i + 1]]
                parts['rowcls'].append(padc)
            parts['rows'].append(pad)
            parts['n'].append(n)
            parts['short'].append(rd('short').astype(np.int64))
            parts['cls_size'].append(rd('class'))
            parts['turn'].append(rd('turn').reshape(m, -1))
            parts['avail'].append(rd('avail').reshape(m, -1))
            parts['cls'].append(rd('cls').astype(np.int64))
            if a.soft:
                parts['tprob'].append(rd('tprob').reshape(m, -1))
    return {k: np.concatenate(v) for k, v in parts.items() if v}, meta


class Attn(torch.nn.Module):
    def __init__(self, nf):
        super().__init__()
        H, D, Fd = a.hidden, a.dim, a.ff
        self.E1 = torch.nn.Linear(nf, H)
        self.pre = torch.nn.Linear(H, 1)
        self.TW = torch.nn.Linear(H, D)
        self.tu = torch.nn.Parameter(torch.zeros(D))
        self.layers = torch.nn.ModuleList()
        for _ in range(a.layers):
            L = torch.nn.Module()
            L.ln1 = torch.nn.LayerNorm(D)
            L.q = torch.nn.Linear(D, D, bias=False)
            L.k = torch.nn.Linear(D, D, bias=False)
            L.v = torch.nn.Linear(D, D, bias=False)
            L.o = torch.nn.Linear(D, D)
            L.ln2 = torch.nn.LayerNorm(D)
            L.f1 = torch.nn.Linear(D, Fd)
            L.f2 = torch.nn.Linear(Fd, D)
            self.layers.append(L)
        self.lnf = torch.nn.LayerNorm(D)
        self.out = torch.nn.Linear(D, 1)
        if a.global_:
            # 상황 토큰 — 차례 신경망이 보던 입력 + 탈 수 있는 갈래 일곱 → 은닉 32 (tanh) → 토큰
            self.c1 = torch.nn.Linear(nt_global, 32)
            self.c2 = torch.nn.Linear(32, D)
        if a.soft:
            self.cw = torch.nn.Linear(D, nc_global)

    def base(self, z):
        h = torch.tanh(self.E1(z))
        return h, self.pre(h).squeeze(-1)

    def class_offset(self, tc, base, keymask, cls):
        # 갈래 머리 — 판마다 더할 값: 갈래의 로그 확률 − 그 갈래 판들의 먼저 보는 점수의 로그합 (recommendAttention.ts 의 offset)
        cls = cls.clamp(min=0)
        oh = F.one_hot(cls, self.cw.out_features).bool() & keymask[..., None]
        lse = base[..., None].masked_fill(~oh, -1e9).logsumexp(1)
        logp = F.log_softmax(self.cw(self.lnf(tc)).masked_fill(~oh.any(1), -1e9), -1)
        return (logp - lse).gather(1, cls)

    def final(self, h, base, keymask, ctx=None, cls=None):
        # h [B,K,H] · base [B,K] · keymask [B,K] (True = 판 있음) · ctx [B, 입력] (하나로 고를 때 — 맨 뒤 토큰, 점수는 받지 않는다)
        t = self.TW(h) + base[..., None] * self.tu
        K0 = t.shape[1]
        if ctx is not None:
            t = torch.cat([t, self.c2(torch.tanh(self.c1(ctx)))[:, None, :]], 1)
            keymask = torch.cat([keymask, torch.ones_like(keymask[:, :1])], 1)
        B, K, D = t.shape
        nh, dh = a.heads, D // a.heads
        for L in self.layers:
            x = L.ln1(t)
            q = L.q(x).view(B, K, nh, dh).transpose(1, 2)
            k = L.k(x).view(B, K, nh, dh).transpose(1, 2)
            v = L.v(x).view(B, K, nh, dh).transpose(1, 2)
            att = (q @ k.transpose(-1, -2)) / math.sqrt(dh)
            att = att.masked_fill(~keymask[:, None, None, :], -1e9).softmax(-1)
            mixed = (att @ v).transpose(1, 2).reshape(B, K, D)
            t = t + L.o(mixed)
            t = t + L.f2(F.relu(L.f1(L.ln2(t))))
        off = self.class_offset(t[:, K0], base, keymask[:, :K0], cls) if a.soft else 0
        return base + off + self.out(self.lnf(t[:, :K0])).squeeze(-1)


def train(data, meta):
    global nt_global, nc_global
    nf = len(meta['names'])
    N = len(data['n'])
    G = a.global_ == 1
    nt_global = data['turn'].shape[1] + data['avail'].shape[1]
    nc_global = data['avail'].shape[1]
    mask_np = np.arange(a.cap)[None, :] < data['n'][:, None]
    # 표준화 — 판 20만 개 표본으로 (자료 전부를 단정밀도로 펼치면 수십 GB 다)
    rng = np.random.default_rng(2)
    di, ri = np.nonzero(mask_np)
    pick = rng.choice(len(di), size=min(200_000, len(di)), replace=False)
    sample = data['rows'][di[pick], ri[pick]].astype(np.float32)
    mean = sample.mean(0)
    std = sample.std(0)
    # 거의 늘 같은 입력은 표준편차를 0.01 아래로 두지 않는다 — 가중치를 소수 여섯째 자리로 내보내면 브라우저 계산이 어긋났다(0.01)
    std = np.maximum(std, 0.01)
    if a.soft:
        # 앞단을 스승 그대로 — 표준화도 스승의 값 (표준편차 0 은 브라우저처럼 1 로)
        T = json.load(open(a.teacher))
        mean = np.asarray(T['mean'], dtype=np.float32)
        std = np.asarray(T['std'], dtype=np.float32)
        std = np.where(std == 0, 1.0, std).astype(np.float32)
    Xraw = torch.tensor(data['rows'], device=dev)
    mean_t = torch.tensor(mean, device=dev)
    std_t = torch.tensor(std, device=dev)
    M = torch.tensor(mask_np, device=dev)
    S = torch.tensor(data['short'], device=dev)
    n_t = torch.tensor(data['n'], device=dev)
    CLS = torch.tensor(data['cls'], device=dev)
    RC = torch.tensor(data['rowcls'], device=dev) if G else None
    CTX = torch.tensor(np.concatenate([data['turn'], data['avail']], 1), device=dev) if G else None
    ar = torch.arange(a.cap, device=dev)[None, :]
    mi = meta['turnNames'].index('master')
    Wd = torch.tensor(1.0 + (a.master_w - 1.0) * (data['turn'][:, mi] > 0.5), device=dev, dtype=torch.float32)
    if G:
        # 먼저 보는 점수는 전문가 갈래 안에서 배운다 — 그 갈래의 무작위 판 하나가 대신하는 판 수로 보정
        in_cls = (RC == CLS[:, None]) & M
        n_rand = (in_cls & (ar >= S[:, None])).sum(1).clamp(min=1)
        short_in = (in_cls & (ar < S[:, None])).sum(1)
        rest = (torch.tensor(data['cls_size'], device=dev) - short_in).clamp(min=1) / n_rand
        corr = torch.log(rest)[:, None] * (ar >= S[:, None]).float()
    else:
        rest = torch.tensor(np.maximum(1, data['cls_size'] - data['short']) / np.maximum(1, data['n'] - data['short']), device=dev, dtype=torch.float32)
        corr = torch.log(rest)[:, None] * (ar >= S[:, None]).float()
    perm = np.random.default_rng(1).permutation(N)
    va = torch.tensor(perm[: N // 10], device=dev)
    tr = torch.tensor(perm[N // 10:], device=dev)
    net = Attn(nf).to(dev)
    if a.soft:
        with torch.no_grad():
            net.E1.weight.copy_(torch.tensor(T['W1'], device=dev))
            net.E1.bias.copy_(torch.tensor(T['b1'], device=dev))
            net.pre.weight.copy_(torch.tensor(T['w2'], device=dev)[None])
            net.pre.bias.fill_(float(T['b2']))
            net.out.weight.zero_()
            net.out.bias.zero_()
        for q in [*net.E1.parameters(), *net.pre.parameters()]:
            q.requires_grad_(False)
        TP = torch.tensor(data['tprob'], device=dev)
    opt = torch.optim.AdamW([q for q in net.parameters() if q.requires_grad], lr=a.lr, weight_decay=1e-4)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, a.epochs)
    K = min(a.k, a.cap)
    P = a.per_class
    NC = data['avail'].shape[1]

    def forward(idx, force_expert=True):
        m = M[idx]
        z = (Xraw[idx].float() - mean_t) / std_t * m[..., None]
        h, base = net.base(z)
        base = base.masked_fill(~m, -1e9)
        sel_key = base.clone()
        if force_expert:
            sel_key[:, 0] = 1e9  # 학습 때는 전문가가 고른 판을 늘 넣는다 (먼저 보는 점수는 따로 배운다)
        if G:
            # 갈래마다 위 P 판 (브라우저와 같다 — 순서는 상관없다: 자리 정보가 없어 어텐션은 순서를 모른다)
            rc = RC[idx]
            tops, valid = [], []
            for c in range(NC):
                kc = sel_key.masked_fill(rc != c, -2e9)
                v, ix = kc.topk(min(P, a.cap), dim=1)
                tops.append(ix)
                valid.append(v > -1e8)
            top = torch.cat(tops, 1)
            mk = torch.cat(valid, 1)
        else:
            top = sel_key.topk(K, dim=1).indices
            mk = m.gather(1, top)
        hk = h.gather(1, top[..., None].expand(-1, -1, h.shape[-1]))
        bk = base.gather(1, top)
        fin = net.final(hk, bk, mk, CTX[idx] if G else None, RC[idx].gather(1, top) if G else None).masked_fill(~mk, -1e9)
        return base, top, fin, mk

    def target(top, mk):
        # 전문가가 고른 판(묶음의 0번)이 놓인 자리
        return ((top == 0) & mk).float().argmax(-1)

    def soft_target(base, top, mk, idx):
        # 스승의 분포 — 갈래 확률 × 갈래 안 점수의 소프트맥스 (top 은 갈래마다 P 칸씩 이어 붙였다)
        k3 = mk.view(len(idx), NC, -1)
        within = base.gather(1, top).view(len(idx), NC, -1).masked_fill(~k3, -1e9).softmax(-1) * k3
        q = (within * TP[idx][:, :, None]).view(len(idx), -1)
        return q / q.sum(-1, keepdim=True).clamp(min=1e-9)

    def evaluate(idx):
        net.eval()
        with torch.no_grad():
            base, top, fin, mk = forward(idx, force_expert=False)
            p = fin.softmax(-1)
            is_exp = (top == 0) & mk
            is_short = (top < S[idx][:, None]) & mk
            res = {
                'top1': float((fin.argmax(-1) == target(top, mk)).float()[is_exp.any(-1)].mean()) if is_exp.any() else 0.0,
                'recallK': float(is_exp.any(-1).float().mean()),
                'massExpert': float((p * is_exp).sum(-1).mean()),
                'massShort': float((p * is_short).sum(-1).mean()),
            }
            # 마스터 운행에서 확률이 '학습자 모델의 가장 옅은 개념을 시험하는 판' 에 실리는 몫 (예전 프로그램은 거기서만 골랐다)
            if 'weakest' in meta['names']:
                wi = meta['names'].index('weakest')
                is_w = (Xraw[idx].gather(1, top[..., None].expand(-1, -1, Xraw.shape[-1]))[..., wi] > 0.5) & mk
                ms = Wd[idx] > 1.0
                res['masterWeakest'] = float((p * is_w).sum(-1)[ms].mean()) if ms.any() else 0.0
            if a.soft:
                q = soft_target(base, top, mk, idx)
                res['softKl'] = float((q * (torch.log(q.clamp(min=1e-12)) - F.log_softmax(fin, -1))).sum(-1).mean())
            if G:
                # 갈래 비율 — 신경망이 갈래마다 준 확률의 평균 대 전문가가 그 갈래를 고른 비율 (다양성 검사가 보는 것)
                rc = RC[idx].gather(1, top)
                pc = torch.stack([(p * ((rc == c) & mk)).sum(-1) for c in range(NC)], 1)
                if a.soft:
                    tp = TP[idx]
                    res['classKl'] = float((tp * (torch.log(tp.clamp(min=1e-9)) - torch.log(pc.clamp(min=1e-9)))).sum(-1).mean())
                res['classP'] = [round(float(v), 4) for v in pc.mean(0)]
                res['classFreq'] = [round(float(v), 4) for v in F.one_hot(CLS[idx], NC).float().mean(0)]
                res['classLogP'] = float(torch.log(pc.gather(1, CLS[idx][:, None]).clamp(min=1e-9)).mean())
        net.train()
        return res

    print(f'\n어텐션 신경망{" (하나로 — 모든 갈래 · 상황 토큰)" if G else ""} — 고를 차례 {N} · 묶음 평균 {float(n_t.float().mean()):.0f}판 · 최종 후보 평균 {float(S.float().mean()):.1f}판 · {dev}', flush=True)
    for ep in range(a.epochs):
        sh = tr[torch.randperm(len(tr), device=dev)]
        tot = 0.0
        for s0 in range(0, len(sh), a.batch):
            idx = sh[s0:s0 + a.batch]
            w = Wd[idx] / Wd[idx].mean()
            if a.soft:
                # 앞단은 스승 그대로라 게임처럼 위 판들만 본다 — 고른 판을 억지로 넣지 않는다
                base, top, fin, mk = forward(idx, force_expert=False)
                loss = (-(soft_target(base, top, mk, idx) * F.log_softmax(fin, -1)).sum(-1) * w).mean()
            else:
                base, top, fin, mk = forward(idx)
                l_fin = (F.cross_entropy(fin, target(top, mk), reduction='none') * w).mean()
                pre = base + corr[idx]
                if G:
                    pre = pre.masked_fill(RC[idx] != CLS[idx][:, None], -1e9)
                l_pre = (F.cross_entropy(pre, torch.zeros(len(idx), dtype=torch.long, device=dev), reduction='none') * w).mean()
                loss = l_fin + a.pre_w * l_pre
            opt.zero_grad()
            loss.backward()
            torch.nn.utils.clip_grad_norm_(net.parameters(), 1.0)
            opt.step()
            tot += float(loss.detach()) * len(idx)
        sched.step()
        if ep % 3 == 2 or ep == a.epochs - 1:
            r = evaluate(va)
            line = (f"  {ep + 1} · 손실 {tot / len(tr):.4f} · 검증: 전문가 판 1등 {r['top1']:.1%} · 어텐션에 듦 {r['recallK']:.1%} · 확률이 전문가 판에 {r['massExpert']:.1%}"
                    f" · 최종 후보에 {r['massShort']:.1%}")
            if 'masterWeakest' in r:
                line += f" · 마스터 운행에서 가장 옅은 개념 판에 {r['masterWeakest']:.1%}"
            if a.soft:
                line += f" · 스승과의 KL {r['softKl']:.4f} · 갈래 KL {r['classKl']:.4f}"
            if G:
                line += f" · 전문가 갈래의 로그 확률 {r['classLogP']:.3f} · 갈래 확률 {r['classP']} (실제 {r['classFreq']})"
            print(line + f' · {secs()}', flush=True)
    # 브라우저 계산과 맞는지 볼 견본 — 검증 차례 다섯의 날 입력과 torch 가 낸 마지막 점수 (판을 고르지 않은 자리는 null)
    net.eval()
    with torch.no_grad():
        idx = va[:5]
        base, top, fin, mk = forward(idx, force_expert=False)
        probe = []
        for b in range(len(idx)):
            n = int(n_t[idx[b]])
            f = [None] * n
            for j in range(top.shape[1]):
                if bool(mk[b, j]):
                    f[int(top[b, j])] = float(fin[b, j])
            item = {'rows': data['rows'][int(idx[b]), :n].astype(np.float64).tolist(), 'final': f, 'base': base[b, :n].double().cpu().tolist()}
            if G:
                item['classes'] = data['rowcls'][int(idx[b]), :n].tolist()
                item['ctx'] = CTX[idx[b]].double().cpu().tolist()
            probe.append(item)
    net.train()
    json.dump(probe, open(os.path.join(a.work, 'probe.json'), 'w'))
    return net, mean, std, evaluate(va)


def train_turn(data, meta):
    X = torch.tensor(data['turn'], device=dev)
    A = torch.tensor(data['avail'] > 0.5, device=dev)
    Y = torch.tensor(data['cls'], device=dev)
    nt, nc = X.shape[1], A.shape[1]
    net = torch.nn.Sequential(torch.nn.Linear(nt, a.turn_hidden), torch.nn.Tanh(), torch.nn.Linear(a.turn_hidden, nc)).to(dev)
    opt = torch.optim.Adam(net.parameters(), lr=3e-3)
    for ep in range(a.turn_epochs):
        perm = torch.randperm(len(Y), device=dev)
        for s in range(0, len(Y), 512):
            idx = perm[s:s + 512]
            logit = net(X[idx]).masked_fill(~A[idx], -1e9)
            loss = F.cross_entropy(logit, Y[idx])
            opt.zero_grad()
            loss.backward()
            opt.step()
    with torch.no_grad():
        lp = net(X).masked_fill(~A, -1e9).log_softmax(-1).gather(1, Y[:, None]).mean()
    print(f'  차례 신경망 — 전문가 갈래의 로그 확률 {float(lp):.3f} · {secs()}', flush=True)
    return net


r6 = lambda t: np.asarray(t.detach().cpu().double().numpy()).round(6).tolist()


def export(net, mean, std, turn, meta, stats, rounds):
    L = []
    for l in net.layers:
        L.append({'ln1': {'g': r6(l.ln1.weight), 'b': r6(l.ln1.bias)}, 'Wq': r6(l.q.weight), 'Wk': r6(l.k.weight), 'Wv': r6(l.v.weight),
                  'Wo': r6(l.o.weight), 'bo': r6(l.o.bias), 'ln2': {'g': r6(l.ln2.weight), 'b': r6(l.ln2.bias)},
                  'F1': r6(l.f1.weight), 'f1': r6(l.f1.bias), 'F2': r6(l.f2.weight), 'f2': r6(l.f2.bias)})
    extra = {}
    if a.global_:
        extra = {'global': True, 'perClass': a.per_class, **({'cw': r6(net.cw.weight), 'cb': r6(net.cw.bias)} if a.soft else {}),
                 'ctx': {'names': meta['turnNames'], 'W1': r6(net.c1.weight), 'b1': r6(net.c1.bias), 'W2': r6(net.c2.weight), 'b2': r6(net.c2.bias)}}
    else:
        lin1, lin2 = turn[0], turn[2]
        extra = {'turn': {'names': meta['turnNames'], 'classes': meta['classes'], 'W1': r6(lin1.weight), 'b1': r6(lin1.bias),
                          'W2': r6(lin2.weight / a.turn_temp), 'b2': r6(lin2.bias / a.turn_temp)}}
    return {
        'kind': 'recommend-attn',
        'names': meta['names'],
        'mean': np.asarray(mean, dtype=np.float64).round(6).tolist(),
        'std': np.asarray(std, dtype=np.float64).round(6).tolist(),
        'E1': r6(net.E1.weight), 'e1': r6(net.E1.bias),
        'pw': r6(net.pre.weight[0]), 'pb': float(round(float(net.pre.bias[0]), 6)),
        'TW': r6(net.TW.weight), 'tb': r6(net.TW.bias), 'tu': r6(net.tu),
        'layers': L,
        'lnf': {'g': r6(net.lnf.weight), 'b': r6(net.lnf.bias)},
        'ow': r6(net.out.weight[0]), 'ob': float(round(float(net.out.bias[0]), 6)),
        'heads': a.heads, 'k': a.k,
        **extra,
        'meta': {'trained': True, 'date': time.strftime('%Y-%m-%d'), 'teacher': f'behavior cloning — 판마다 채점 신경망 {os.path.basename(a.teacher)} (attnPolicy.ts 의 netPick) · DAgger' if a.teacher else 'behavior cloning — 예전 규칙 · 프로그램 점수 (recommendSim.ts 의 programPick) · DAgger',
                 'learners': a.learners * a.rounds, 'rounds': rounds, 'cap': a.cap, 'hidden': a.hidden, 'dim': a.dim, 'layers': a.layers, 'ff': a.ff,
                 **({'perClass': a.per_class} if a.global_ else {'turnTemp': a.turn_temp})},
    }


dirs = []
model_path = None
rounds = []
for rnd in range(a.rounds):
    print(f'\n{rnd + 1}차 — 가상 운전자 {a.learners}명을 {"예전 프로그램" if model_path is None else "어텐션 신경망"}이 가르치며 전문가의 정답을 모은다 (일꾼 {a.jobs})', flush=True)
    dirs.append(rollout(rnd, model_path))
    data, meta = load(dirs)
    net, mean, std, stats = train(data, meta)
    turn = None if a.global_ else train_turn(data, meta)
    rounds.append({'round': rnd + 1, 'decisions': int(len(data['n'])), **stats})
    model = export(net, mean, std, turn, meta, stats, rounds)
    model_path = os.path.join(a.work, f'model-{rnd + 1}.json')
    json.dump(model, open(model_path, 'w'))
json.dump(model, open(a.out, 'w'))
print(f'\n저장: {a.out} · {secs()}', flush=True)
