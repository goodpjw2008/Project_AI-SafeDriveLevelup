"""
다음 판 추천 신경망 — PPO 강화학습 (GPU).

행동 복제(scripts/train-recommend.ts)로 배운 두 신경망(차례 신경망 · 추천 신경망)을 가상 운전자를 60판 가르친 결과로 다듬는다.
목표는 예전 프로그램보다 **진짜로 더 잘 가르치는** 정책이다 (사용자가 정했다, 2026-11-01: "ai기반 기술로 학습한것이 프로그램보다
성능이 높은 모델을 만드는거야").

한 차례:
  1. 일꾼(scripts/ppo-rollout.ts, CPU 여러 개)이 지금 정책으로 새 가상 운전자들을 가르치며 판마다 고른 것 · 보상을 적는다.
  2. 가치 신경망(비평가 — 학습자 쪽 특징 · 남은 판 → 앞으로 오를 값)으로 GAE 이점을 셈한다. 같은 사람을 여러 번 가르쳐 견주던
     REINFORCE(scripts/finetune-recommend.ts)보다 잡음이 훨씬 적다.
  3. PPO(잘린 비율 목적)로 두 신경망을 몇 번 되풀이해 고친다 — 모은 자료를 여러 번 쓴다. 행동 복제 정책에서 너무 멀어지지 않게
     KL 벌점을 건다 (사용자가 정한 다양성 약속을 행동 복제가 지켰다).
  4. 고친 가중치를 브라우저와 같은 JSON(src/ai/models/recommend.json 꼴)으로 쓴다.

브라우저의 계산과 같아야 한다 — 추천 신경망: z = (x − mean) / std, h = tanh(W1 z + b1), 점수 = w2 · h + b2, 후보끼리 소프트맥스.
차례 신경망: h = tanh(W1 x + b1), 로짓 = W2 h + b2, 탈 수 있는 갈래끼리 소프트맥스 (src/ai/recommendNet.ts).

  python3 scripts/ppo_train.py --bin <ppo-rollout.mjs> --init src/ai/models/recommend.json --work .train-recommend/ppo --iters 60
"""
import argparse
import json
import os
import subprocess
import time

import numpy as np
import torch
import torch.nn.functional as F

p = argparse.ArgumentParser()
p.add_argument('--bin', required=True, help='묶은 일꾼 (vite build --ssr 로 scripts/ppo-rollout.ts 를 묶은 것)')
p.add_argument('--init', required=True, help='시작 모델 (행동 복제)')
p.add_argument('--ref', default=None, help='KL 기준 모델 (기본: --init)')
p.add_argument('--work', required=True)
p.add_argument('--iters', type=int, default=60)
p.add_argument('--episodes', type=int, default=1000, help='한 차례에 가르치는 가상 운전자 수')
p.add_argument('--pool', type=int, default=64)
p.add_argument('--jobs', type=int, default=os.cpu_count())
p.add_argument('--epochs', type=int, default=4)
p.add_argument('--batch', type=int, default=4096)
p.add_argument('--lr', type=float, default=3e-4)
p.add_argument('--vlr', type=float, default=1e-3)
p.add_argument('--clip', type=float, default=0.2)
p.add_argument('--kl_ref', type=float, default=0.02, help='행동 복제 정책과의 KL 벌점')
p.add_argument('--ent', type=float, default=0.0)
p.add_argument('--target_kl', type=float, default=0.03, help='한 차례에 이보다 멀리 가면 되풀이를 멈춘다')
p.add_argument('--gamma', type=float, default=1.0)
p.add_argument('--lam', type=float, default=0.95)
p.add_argument('--resume', type=int, default=0, help='이 차례의 모델 · 비평가에서 이어 간다')
p.add_argument('--mode', default='pick', help="pick — 신경망 단독(한 판) · set — LLM 과 짝을 이루는 후보 신경망(후보 k 판, 마지막은 LLM 을 대신하는 규칙)")
p.add_argument('--k', type=int, default=10)
p.add_argument('--priv', type=int, default=1, help='1 — 가치 신경망이 가상 운전자의 속(아는 개념 · 기억의 세기 · 익히는 빠르기)까지 본다 (비대칭 행위자-비평가)')
p.add_argument('--critic_epochs', type=int, default=10)
a = p.parse_args()

dev = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
os.makedirs(a.work, exist_ok=True)
t0 = time.time()
secs = lambda: f'{time.time() - t0:.0f}초'


def load_model(path):
    with open(path) as f:
        return json.load(f)


def T(x):
    return torch.tensor(x, dtype=torch.float32, device=dev)


class Policy(torch.nn.Module):
    def __init__(self, m):
        super().__init__()
        self.mean = T(m['mean'])
        std = T(m['std'])
        self.std = torch.where(std == 0, torch.ones_like(std), std)
        self.W1 = torch.nn.Parameter(T(m['W1']))
        self.b1 = torch.nn.Parameter(T(m['b1']))
        self.w2 = torch.nn.Parameter(T(m['w2']))
        self.b2 = torch.nn.Parameter(T([m['b2']]))
        t = m['turn']
        self.tW1 = torch.nn.Parameter(T(t['W1']))
        self.tb1 = torch.nn.Parameter(T(t['b1']))
        self.tW2 = torch.nn.Parameter(T(t['W2']))
        self.tb2 = torch.nn.Parameter(T(t['b2']))

    def course_scores(self, rows, mask):
        """rows (B, P, F) · mask (B, P) → 후보마다 점수 (없는 자리는 −1e9)"""
        z = (rows - self.mean) / self.std
        h = torch.tanh(z @ self.W1.T + self.b1)
        s = h @ self.w2 + self.b2
        return s.masked_fill(~mask, -1e9)

    def course_logp(self, rows, mask):
        """후보끼리 로그 소프트맥스 (B, P)"""
        return F.log_softmax(self.course_scores(rows, mask), dim=-1)

    def turn_logp(self, x, avail):
        h = torch.tanh(x @ self.tW1.T + self.tb1)
        lo = h @ self.tW2.T + self.tb2
        lo = lo.masked_fill(~avail, -1e9)
        return F.log_softmax(lo, dim=-1)

    def export(self, base):
        out = dict(base)
        r6 = lambda v: [round(float(x), 6) for x in v]
        out['W1'] = [r6(r) for r in self.W1.detach().cpu().numpy()]
        out['b1'] = r6(self.b1.detach().cpu().numpy())
        out['w2'] = r6(self.w2.detach().cpu().numpy())
        out['b2'] = round(float(self.b2.item()), 6)
        t = dict(base['turn'])
        t['W1'] = [r6(r) for r in self.tW1.detach().cpu().numpy()]
        t['b1'] = r6(self.tb1.detach().cpu().numpy())
        t['W2'] = [r6(r) for r in self.tW2.detach().cpu().numpy()]
        t['b2'] = r6(self.tb2.detach().cpu().numpy())
        out['turn'] = t
        return out


def set_logp(scores, mask, sets):
    """점수에 비례해 차례로 뽑은 후보 k 판(플래킷-루스)의 로그 확률 — 뽑은 판은 다음 차례의 후보에서 뺀다"""
    B = scores.shape[0]
    left = mask.clone()
    total = torch.zeros(B, device=scores.device)
    rows_i = torch.arange(B, device=scores.device)
    for j in range(sets.shape[1]):
        idx = sets[:, j]
        valid = idx >= 0
        safe = idx.clamp(min=0)
        s = scores.masked_fill(~left, -1e9)
        lp = s.gather(1, safe[:, None]).squeeze(1) - torch.logsumexp(s, dim=1)
        total = total + torch.where(valid, lp, torch.zeros_like(lp))
        left = left.clone()
        left[rows_i[valid], safe[valid]] = False
    return total


class Critic(torch.nn.Module):
    def __init__(self, d):
        super().__init__()
        self.net = torch.nn.Sequential(torch.nn.Linear(d, 256), torch.nn.Tanh(), torch.nn.Linear(256, 256), torch.nn.Tanh(), torch.nn.Linear(256, 1))

    def forward(self, x):
        return self.net(x).squeeze(-1)


def rollout(model_path, it):
    out = os.path.join(a.work, f'roll-{it}')
    os.makedirs(out, exist_ok=True)
    procs = [subprocess.Popen(['node', '--max-old-space-size=8000', a.bin, '--model', model_path, '--iter', str(it), '--worker', str(k), '--jobs', str(a.jobs),
                               '--episodes', str(a.episodes), '--pool', str(a.pool), '--mode', a.mode, '--k', str(a.k), '--out', out]) for k in range(a.jobs)]
    for pr in procs:
        if pr.wait() != 0:
            raise RuntimeError('일꾼 실패')
    parts = {k: [] for k in ['turn', 'avail', 'a1', 'lp1', 'rows', 'nrows', 'a2', 'lp2', 'crit', 'priv', 'reward', 'done', 'set']}
    eps = []
    epi = []
    off = 0
    for k in range(a.jobs):
        meta = json.load(open(os.path.join(out, f'w{k}.json')))
        n = meta['decisions']
        if n == 0:
            continue
        rd = lambda f: np.fromfile(os.path.join(out, f'w{k}-{f}.f32'), dtype=np.float32)
        parts['turn'].append(rd('turn').reshape(n, -1))
        parts['avail'].append(rd('avail').reshape(n, -1))
        parts['rows'].append(rd('rows').reshape(n, a.pool, -1))
        parts['crit'].append(rd('crit').reshape(n, -1))
        parts['priv'].append(rd('priv').reshape(n, -1))
        for f in ['a1', 'lp1', 'nrows', 'a2', 'lp2', 'reward', 'done']:
            parts[f].append(rd(f))
        if a.mode == 'set':
            parts['set'].append(rd('set').reshape(n, -1))
        epi.append(rd('ep') + off)
        off += len(meta['episodes'])
        eps += meta['episodes']
    data = {k: np.concatenate(v) for k, v in parts.items() if v}
    data['ep'] = np.concatenate(epi)
    # 다 읽었으면 지운다 — 한 차례가 1GB 남짓
    for f in os.listdir(out):
        os.remove(os.path.join(out, f))
    os.rmdir(out)
    return data, eps


base = load_model(a.init)
ref_m = load_model(a.ref or a.init)
pi = Policy(base).to(dev)
ref = Policy(ref_m).to(dev)
for q in ref.parameters():
    q.requires_grad_(False)
critic = None
opt = torch.optim.Adam(pi.parameters(), lr=a.lr)
vopt = None
hist_path = os.path.join(a.work, 'history.jsonl')
start = 0
if a.resume:
    pi = Policy(load_model(os.path.join(a.work, f'model-{a.resume}.json'))).to(dev)
    opt = torch.optim.Adam(pi.parameters(), lr=a.lr)
    start = a.resume

print(f'PPO ({a.mode}{" · 후보 " + str(a.k) + "판 → LLM 을 대신하는 규칙" if a.mode == "set" else " · 신경망 단독"}) — {a.iters}차례 × 가상 운전자 {a.episodes}명 · 후보 {a.pool} · 일꾼 {a.jobs} · {dev} ({torch.cuda.get_device_name(0) if dev.type == "cuda" else "cpu"})', flush=True)
for it in range(start, a.iters):
    mpath = os.path.join(a.work, f'model-{it}.json')
    with open(mpath, 'w') as f:
        json.dump(pi.export(base), f)
    d, eps = rollout(mpath, it)
    n = len(d['a1'])
    turn = T(d['turn'])
    avail = torch.tensor(d['avail'] > 0.5, device=dev)
    a1 = torch.tensor(d['a1'], dtype=torch.long, device=dev)
    rows = T(d['rows'])
    nrows = torch.tensor(d['nrows'], dtype=torch.long, device=dev)
    mask = torch.arange(a.pool, device=dev)[None, :] < nrows[:, None]
    a2 = torch.tensor(d['a2'], dtype=torch.long, device=dev)
    sets = torch.tensor(d['set'], dtype=torch.long, device=dev) if a.mode == 'set' else None
    old = T(d['lp1'] + d['lp2'])
    crit_x = T(np.concatenate([d['turn'], d['crit']] + ([d['priv']] if a.priv else []), axis=1))
    rew = d['reward'].astype(np.float64)
    done = d['done'] > 0.5
    if critic is None:
        critic = Critic(crit_x.shape[1]).to(dev)
        vopt = torch.optim.Adam(critic.parameters(), lr=a.vlr)
        cpath = os.path.join(a.work, f'critic-{it}.pt')
        if a.resume and os.path.exists(cpath):
            critic.load_state_dict(torch.load(cpath))

    # 가치 신경망을 먼저 맞춘다 — 몬테카를로 남은 보상으로 (처음 몇 차례는 비평가가 서툴러 이점이 흔들리므로)
    with torch.no_grad():
        mc = np.zeros(n)
        acc = 0.0
        for i in range(n - 1, -1, -1):
            if done[i]:
                acc = 0.0
            acc = rew[i] + a.gamma * acc
            mc[i] = acc
    mc_t = T(mc)
    for _ in range(3 * a.critic_epochs if it == start else a.critic_epochs):
        perm = torch.randperm(n, device=dev)
        for s in range(0, n, a.batch):
            idx = perm[s:s + a.batch]
            vl = F.mse_loss(critic(crit_x[idx]), mc_t[idx])
            vopt.zero_grad()
            vl.backward()
            vopt.step()
    with torch.no_grad():
        v = critic(crit_x).cpu().numpy().astype(np.float64)
    # 비평가가 남은 보상의 흔들림을 얼마나 설명하는가 (1 이면 다, 0 이면 평균만큼)
    ev = 1 - np.var(mc - v) / (np.var(mc) + 1e-12)
    # GAE
    adv = np.zeros(n)
    last = 0.0
    for i in range(n - 1, -1, -1):
        nv = 0.0 if done[i] else v[i + 1]
        delta = rew[i] + a.gamma * nv - v[i]
        last = delta + a.gamma * a.lam * (0.0 if done[i] else last)
        adv[i] = last
    ret = adv + v
    adv_t = T((adv - adv.mean()) / (adv.std() + 1e-8))
    ret_t = T(ret)

    # PPO
    stats = {'kl': 0.0, 'clip': 0.0, 'klref': 0.0, 'ent': 0.0, 'epochs': 0, 'ev': float(ev)}
    for e in range(a.epochs):
        perm = torch.randperm(n, device=dev)
        kls = []
        for s in range(0, n, a.batch):
            idx = perm[s:s + a.batch]
            sc = pi.course_scores(rows[idx], mask[idx])
            lpc = F.log_softmax(sc, dim=-1)
            lpt = pi.turn_logp(turn[idx], avail[idx])
            course_new = set_logp(sc, mask[idx], sets[idx]) if a.mode == 'set' else lpc.gather(1, a2[idx, None]).squeeze(1)
            new = lpt.gather(1, a1[idx, None]).squeeze(1) + course_new
            ratio = torch.exp(new - old[idx])
            A = adv_t[idx]
            pg = -torch.min(ratio * A, torch.clamp(ratio, 1 - a.clip, 1 + a.clip) * A).mean()
            with torch.no_grad():
                rc = ref.course_logp(rows[idx], mask[idx])
                rt = ref.turn_logp(turn[idx], avail[idx])
            pc, pt = lpc.exp(), lpt.exp()
            klr = ((pc * (lpc - rc)).masked_fill(~mask[idx], 0).sum(1) + (pt * (lpt - rt)).masked_fill(~avail[idx], 0).sum(1)).mean()
            ent = -((pc * lpc).masked_fill(~mask[idx], 0).sum(1) + (pt * lpt).masked_fill(~avail[idx], 0).sum(1)).mean()
            loss = pg + a.kl_ref * klr - a.ent * ent
            opt.zero_grad()
            loss.backward()
            torch.nn.utils.clip_grad_norm_(pi.parameters(), 0.5)
            opt.step()
            with torch.no_grad():
                kls.append(((ratio - 1) - torch.log(ratio)).mean().item())
                stats['clip'] = ((ratio - 1).abs() > a.clip).float().mean().item()
                stats['klref'] = klr.item()
                stats['ent'] = ent.item()
            # 가치 신경망도 함께
            vl = F.mse_loss(critic(crit_x[idx]), ret_t[idx])
            vopt.zero_grad()
            vl.backward()
            vopt.step()
        stats['kl'] = float(np.mean(kls))
        stats['epochs'] = e + 1
        if stats['kl'] > a.target_kl:
            break
    torch.save(critic.state_dict(), os.path.join(a.work, f'critic-{it + 1}.pt'))
    row = {
        'iter': it,
        'decisions': n,
        'episodes': len(eps),
        'ret': float(np.mean([x['ret'] for x in eps])),
        'known': float(np.mean([x['known'] for x in eps])),
        'level': float(np.mean([x['level'] for x in eps])),
        'frustration': float(np.mean([x['frustration'] for x in eps])),
        **{k: round(v, 4) if isinstance(v, float) else v for k, v in stats.items()},
        'secs': round(time.time() - t0),
    }
    with open(hist_path, 'a') as f:
        f.write(json.dumps(row) + '\n')
    print(f"  {it} · 보상 {row['ret']:.3f} · 익힌 개념 +{row['known']:.2f} · 레벨 {row['level']:.2f} · 연패 {row['frustration']:.1f}"
          f" · 비평가 설명 {row['ev']:.2f} · KL {row['kl']:.4f} · 잘림 {row['clip']:.2f} · 행동 복제와 KL {row['klref']:.3f} · 되풀이 {row['epochs']} · {secs()}", flush=True)

final = os.path.join(a.work, f'model-{a.iters}.json')
out = pi.export(base)
out['meta'] = dict(base.get('meta', {}))
out['meta']['ppo'] = {'mode': a.mode, 'k': a.k, 'iters': a.iters, 'episodes': a.episodes, 'pool': a.pool, 'lr': a.lr, 'clip': a.clip, 'kl_ref': a.kl_ref, 'lam': a.lam, 'priv': a.priv, 'date': time.strftime('%Y-%m-%d')}
with open(final, 'w') as f:
    json.dump(out, f)
print(f'저장: {final} · {secs()}', flush=True)
