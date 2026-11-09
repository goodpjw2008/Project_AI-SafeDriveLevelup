# 어텐션 추천 신경망 (torch) — src/ai/recommendAttention.ts 와 한 줄씩 같은 계산. 행동 복제(train-recommend-attn.py)와
# 강화학습(ppo_attn.py)이 함께 쓴다. 브라우저 JSON 으로 읽고 쓴다.
import math

import numpy as np
import torch
import torch.nn.functional as F


class Attn(torch.nn.Module):
    def __init__(self, nf, hidden=64, dim=32, heads=4, ff=64, layers=2, nctx=0, classes=0):
        super().__init__()
        self.heads = heads
        self.E1 = torch.nn.Linear(nf, hidden)
        self.pre = torch.nn.Linear(hidden, 1)
        self.TW = torch.nn.Linear(hidden, dim)
        self.tu = torch.nn.Parameter(torch.zeros(dim))
        self.layers = torch.nn.ModuleList()
        for _ in range(layers):
            L = torch.nn.Module()
            L.ln1 = torch.nn.LayerNorm(dim)
            L.q = torch.nn.Linear(dim, dim, bias=False)
            L.k = torch.nn.Linear(dim, dim, bias=False)
            L.v = torch.nn.Linear(dim, dim, bias=False)
            L.o = torch.nn.Linear(dim, dim)
            L.ln2 = torch.nn.LayerNorm(dim)
            L.f1 = torch.nn.Linear(dim, ff)
            L.f2 = torch.nn.Linear(ff, dim)
            self.layers.append(L)
        self.lnf = torch.nn.LayerNorm(dim)
        self.out = torch.nn.Linear(dim, 1)
        if nctx:
            # 상황 토큰 — 차례 신경망이 보던 입력 + 탈 수 있는 갈래 일곱 → 은닉 32 (tanh) → 토큰
            self.c1 = torch.nn.Linear(nctx, 32)
            self.c2 = torch.nn.Linear(32, dim)
        if classes:
            self.cw = torch.nn.Linear(dim, classes)

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
        # h [B,K,H] · base [B,K] · keymask [B,K] (True = 판 있음) · ctx [B, 입력] (맨 뒤 토큰, 점수는 받지 않는다)
        t = self.TW(h) + base[..., None] * self.tu
        K0 = t.shape[1]
        if ctx is not None:
            t = torch.cat([t, self.c2(torch.tanh(self.c1(ctx)))[:, None, :]], 1)
            keymask = torch.cat([keymask, torch.ones_like(keymask[:, :1])], 1)
        B, K, D = t.shape
        nh, dh = self.heads, D // self.heads
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
        off = self.class_offset(t[:, K0], base, keymask[:, :K0], cls) if hasattr(self, 'cw') else 0
        return base + off + self.out(self.lnf(t[:, :K0])).squeeze(-1)

    def scores(self, z, keymask, ctx=None, cls=None):
        """추린 판들(z — 표준화한 입력)의 마지막 점수 — 강화학습은 고른 묶음을 고정하고 이것만 다시 센다"""
        h, base = self.base(z)
        return self.final(h, base, keymask, ctx, cls).masked_fill(~keymask, -1e9)


def from_json(m, dev):
    """브라우저 JSON → torch 모듈 (+ 표준화 평균 · 표준편차)"""
    t = lambda x: torch.tensor(np.asarray(x, dtype=np.float32))
    nctx = len(m['ctx']['W1'][0]) if m.get('global') else 0
    net = Attn(len(m['names']), hidden=len(m['e1']), dim=len(m['tb']), heads=m['heads'], ff=len(m['layers'][0]['f1']), layers=len(m['layers']), nctx=nctx,
               classes=len(m.get('cb', [])))
    with torch.no_grad():
        net.E1.weight.copy_(t(m['E1'])); net.E1.bias.copy_(t(m['e1']))
        net.pre.weight.copy_(t([m['pw']])); net.pre.bias.copy_(t([m['pb']]))
        net.TW.weight.copy_(t(m['TW'])); net.TW.bias.copy_(t(m['tb'])); net.tu.copy_(t(m['tu']))
        for L, j in zip(net.layers, m['layers']):
            L.ln1.weight.copy_(t(j['ln1']['g'])); L.ln1.bias.copy_(t(j['ln1']['b']))
            L.q.weight.copy_(t(j['Wq'])); L.k.weight.copy_(t(j['Wk'])); L.v.weight.copy_(t(j['Wv']))
            L.o.weight.copy_(t(j['Wo'])); L.o.bias.copy_(t(j['bo']))
            L.ln2.weight.copy_(t(j['ln2']['g'])); L.ln2.bias.copy_(t(j['ln2']['b']))
            L.f1.weight.copy_(t(j['F1'])); L.f1.bias.copy_(t(j['f1'])); L.f2.weight.copy_(t(j['F2'])); L.f2.bias.copy_(t(j['f2']))
        net.lnf.weight.copy_(t(m['lnf']['g'])); net.lnf.bias.copy_(t(m['lnf']['b']))
        net.out.weight.copy_(t([m['ow']])); net.out.bias.copy_(t([m['ob']]))
        if nctx:
            net.c1.weight.copy_(t(m['ctx']['W1'])); net.c1.bias.copy_(t(m['ctx']['b1']))
            net.c2.weight.copy_(t(m['ctx']['W2'])); net.c2.bias.copy_(t(m['ctx']['b2']))
        if m.get('cb'):
            net.cw.weight.copy_(t(m['cw'])); net.cw.bias.copy_(t(m['cb']))
    return net.to(dev), torch.tensor(m['mean'], device=dev, dtype=torch.float32), torch.tensor(m['std'], device=dev, dtype=torch.float32)


def to_json(net, base):
    """torch 모듈 → 브라우저 JSON (base 의 이름 · 표준화 · 설정은 그대로)"""
    r6 = lambda x: np.asarray(x.detach().cpu().double().numpy()).round(6).tolist()
    out = dict(base)
    out.update({'E1': r6(net.E1.weight), 'e1': r6(net.E1.bias), 'pw': r6(net.pre.weight[0]), 'pb': float(round(float(net.pre.bias[0].detach()), 6)),
                'TW': r6(net.TW.weight), 'tb': r6(net.TW.bias), 'tu': r6(net.tu),
                'layers': [{'ln1': {'g': r6(l.ln1.weight), 'b': r6(l.ln1.bias)}, 'Wq': r6(l.q.weight), 'Wk': r6(l.k.weight), 'Wv': r6(l.v.weight),
                            'Wo': r6(l.o.weight), 'bo': r6(l.o.bias), 'ln2': {'g': r6(l.ln2.weight), 'b': r6(l.ln2.bias)},
                            'F1': r6(l.f1.weight), 'f1': r6(l.f1.bias), 'F2': r6(l.f2.weight), 'f2': r6(l.f2.bias)} for l in net.layers],
                'lnf': {'g': r6(net.lnf.weight), 'b': r6(net.lnf.bias)}, 'ow': r6(net.out.weight[0]), 'ob': float(round(float(net.out.bias[0].detach()), 6))})
    if hasattr(net, 'c1'):
        out['ctx'] = dict(base['ctx'], W1=r6(net.c1.weight), b1=r6(net.c1.bias), W2=r6(net.c2.weight), b2=r6(net.c2.bias))
    if hasattr(net, 'cw'):
        out.update({'cw': r6(net.cw.weight), 'cb': r6(net.cw.bias)})
    return out
