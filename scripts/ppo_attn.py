"""
어텐션 추천 신경망 — PPO 강화학습 (GPU). 행동 복제(train-recommend-attn.py --global 1)로 프로그램을 따라 배운 신경망을, 가상
운전자를 60판 가르친 결과로 다듬어 **프로그램보다 잘 가르치게** 한다 (사용자가 정했다, 2026-11-01: "ai기반 기술로 학습한것이
프로그램보다 성능이 높은 모델").

한 차례:
  1. 일꾼(scripts/ppo-attn-rollout.ts)이 지금 정책으로 새 가상 운전자를 가르치며, 판마다 어텐션이 견준 판들 · 고른 판 · 보상을 적는다.
  2. 가치 신경망(비평가)은 가상 운전자의 **속**(아는 개념 · 기억의 세기 · 익히는 빠르기 — recommendValue.ts 의 valueState)과 상황을
     본다 (비대칭 행위자-비평가). 판마다 채점하는 신경망의 강화학습에서 속을 모르는 비평가는 남은 보상의 흔들림을 9% 만 설명했고,
     속을 보게 하자 55% 였다 — 한 판의 고르기가 끝의 아는 개념을 0.05 바꾸는데 운이 2 개념 흔들어, 비평가가 이점의 잡음을 줄여야 한다.
  3. PPO(잘린 비율) — 견준 판들은 그대로 두고 마지막 점수만 다시 센다. 행동 복제 정책과의 KL 벌점으로 너무 멀리 가지 않게 한다.
  4. **사용자가 정한 약속을 벌점으로 지킨다** (2026-11-04). 보상만 좇은 100차례 뒤 무신호 보호구역의 바닥(세 판째 없으면 그 판)을
     62% 만 지켰고(행동 복제도 82% — 프로그램 · 로컬 신경망은 100%), 레벨마다 무신호 보호구역 비율도 고르지 않아 다양성 테스트에
     걸렸다. 그래서 ① 바닥 차례인 판에서 그 차례를 채우는 판들의 확률 합의 −log (`--floor_w`) ② 어텐션이 갈래마다 준 확률의 합과
     로컬 신경망의 차례 신경망(테스트를 통과한 갈래 비율)의 KL (`--class_kl`) 을 더한다. 바닥과 갈래 비율도 규칙이 아니라 신경망이
     배운다 — 갈래 안에서 어느 판인가는 보상이 정한다.

  python3 scripts/ppo_attn.py --bin ppo-attn-rollout.mjs --init recommend-attn.json --work .train-recommend-attn/ppo --iters 100
"""
import argparse, copy, json, os, subprocess, sys, time

import numpy as np
import torch
import torch.nn.functional as F

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from attn_model import from_json, to_json  # noqa: E402

p = argparse.ArgumentParser()
p.add_argument('--bin', required=True)
p.add_argument('--init', required=True)
p.add_argument('--work', required=True)
p.add_argument('--iters', type=int, default=100)
p.add_argument('--episodes', type=int, default=1000)
p.add_argument('--pool', type=int, default=500)
p.add_argument('--jobs', type=int, default=os.cpu_count())
p.add_argument('--epochs', type=int, default=4)
p.add_argument('--batch', type=int, default=1024)
p.add_argument('--lr', type=float, default=1e-4)
p.add_argument('--vlr', type=float, default=1e-3)
p.add_argument('--clip', type=float, default=0.2)
p.add_argument('--kl_ref', type=float, default=0.02)
p.add_argument('--target_kl', type=float, default=0.02)
p.add_argument('--lam', type=float, default=0.9)
p.add_argument('--levelW', type=float, default=0.05)
p.add_argument('--critic_epochs', type=int, default=15)
p.add_argument('--floor_w', type=float, default=0.0, help='바닥 차례를 채우는 판들의 확률 합 −log 의 무게')
p.add_argument('--class_kl', type=float, default=0.0, help='갈래 확률 합과 차례 신경망의 KL(차례 신경망 ‖ 어텐션) 무게')
p.add_argument('--class_ce', type=float, default=0.0,
               help='같은 자리에서 프로그램이 고른 갈래의 −log(어텐션의 갈래 확률 합) 무게 — 프로그램의 갈래 비율을 따라 배운다(표본 하나)')
p.add_argument('--sig_floor', type=float, default=0.0,
               help='바닥 차례가 아닌 판에서 갈래 목표의 신호 있는 보호구역 몫이 이보다 낮으면 이만큼 올린다 — 무신호 비율의 상한(90%)을 표본 운이 아니라 참값으로 지키게')
p.add_argument('--sig_levels', default='', help='--sig_floor 를 걸 레벨 (쉼표, 비우면 모든 레벨)')
p.add_argument('--aug_flows', type=int, default=0,
               help='차례마다 한 레벨에 머무는 운전자 흐름 수 (일꾼의 --augFlows) — 보상 없이 약속 벌점에만 쓴다')
p.add_argument('--aug_runs', type=int, default=120, help='흐름 하나의 판 수')
p.add_argument('--aug_w', type=float, default=1.0, help='머무는 흐름의 약속 벌점 무게 (보통 운전자의 벌점에 곱해 더한다)')
p.add_argument('--project', type=int, default=0,
               help='첫 차례에 보상 없이 약속(바닥 · 갈래 비율)만 맞추는 되풀이 수 — 0 이면 안 한다. 벌점을 PPO 에 처음부터 크게 걸면 '
                    '한 차례 만에 행동 복제와의 KL 이 0.3 → 2.7 로 튀고 익힌 개념이 무너졌다(2026-11-04) — 그래서 먼저 가장 덜 움직여 맞춘다')
p.add_argument('--project_kl', type=float, default=0.3, help='맞추는 동안 맞추기 전 정책과의 KL 무게 — 갈래 안에서 어느 판인가는 그대로 두게')
p.add_argument('--resume', type=int, default=0,
               help='이 차례의 정책(work/model-N.json)에서 이어 간다 — KL 기준은 그대로 --init(행동 복제). 비평가는 저장하지 않으므로 처음부터 다시 맞춘다')
a = p.parse_args()
dev = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
os.makedirs(a.work, exist_ok=True)
t0 = time.time()
secs = lambda: f'{time.time() - t0:.0f}초'

base_json = json.load(open(a.init))
start = a.resume
pi, mean, std = from_json(json.load(open(os.path.join(a.work, f'model-{start}.json'))) if start else base_json, dev)
ref, _, _ = from_json(base_json, dev)
for q in ref.parameters():
    q.requires_grad_(False)
opt = torch.optim.Adam(pi.parameters(), lr=a.lr)
critic = None
vopt = None


def rollout(model_path, it):
    out = os.path.join(a.work, f'roll-{it}')
    os.makedirs(out, exist_ok=True)
    procs = [subprocess.Popen(['node', '--max-old-space-size=8000', a.bin, '--model', model_path, '--iter', str(it), '--worker', str(k), '--jobs', str(a.jobs),
                               '--episodes', str(a.episodes), '--pool', str(a.pool), '--levelW', str(a.levelW), '--out', out,
                               '--augFlows', str(a.aug_flows), '--augRuns', str(a.aug_runs)]) for k in range(a.jobs)]
    for pr in procs:
        if pr.wait() != 0:
            raise RuntimeError('일꾼 실패')
    parts = {k: [] for k in ['rows', 'nsel', 'chosen', 'lp', 'ctx', 'crit', 'reward', 'done', 'tcls', 'tok', 'due', 'prior', 'pcls', 'aug']}
    eps, epi, off, flows = [], [], 0, []
    for k in range(a.jobs):
        meta = json.load(open(os.path.join(out, f'w{k}.json')))
        n = meta['decisions']
        if n == 0:
            continue
        rd = lambda f, dt=np.float32: np.fromfile(os.path.join(out, f'w{k}-{f}'), dtype=dt)
        parts['rows'].append(rd('rows.f16', np.float16).reshape(n, meta['sMax'], meta['features']))
        for f in ['nsel', 'chosen', 'lp', 'reward', 'done', 'due', 'pcls', 'aug']:
            parts[f].append(rd(f + '.f32'))
        parts['tcls'].append(rd('tcls.i8', np.int8).reshape(n, meta['sMax']))
        parts['tok'].append(rd('tok.u8', np.uint8).reshape(n, meta['sMax']))
        parts['prior'].append(rd('prior.f32').reshape(n, -1))
        parts['ctx'].append(rd('ctx.f32').reshape(n, -1))
        parts['crit'].append(rd('crit.f32').reshape(n, -1))
        epi.append(rd('ep.f32') + off)
        off += len(meta['episodes'])
        eps += meta['episodes']
        flows += meta.get('flows', [])
    data = {k: np.concatenate(v) for k, v in parts.items()}
    data['ep'] = np.concatenate(epi)
    for f in os.listdir(out):
        os.remove(os.path.join(out, f))
    os.rmdir(out)
    return data, eps, flows


def flow_stats(flows):
    """머무는 흐름의 약속 — 바닥을 채운 비율 · 레벨마다 보호구역 판 가운데 무신호 비율의 가장 낮은 값 · 판 가운데 무신호 비율의 폭
    (tests/recommend.test.ts 의 다양성 검사가 재는 셋 — 흐름이 다르니 가늠일 뿐이다)"""
    if not flows:
        return {}
    by = {}
    for f in flows:
        b = by.setdefault(f['level'], [0, 0, 0])
        b[0] += f['runs']; b[1] += f['zone']; b[2] += f['noSig']
    lv = [k for k in by if k >= 2 and by[k][1]]
    of_runs = [by[k][2] / by[k][0] for k in lv]
    return {'augFloor': sum(f['met'] for f in flows) / max(1, sum(f['due'] for f in flows)),
            'augOfZoneMin': min(by[k][2] / by[k][1] for k in lv) if lv else 0.0,
            'augOfZoneMax': max(by[k][2] / by[k][1] for k in lv) if lv else 0.0,
            'augSpread': (max(of_runs) - min(of_runs)) if of_runs else 0.0}


hist = os.path.join(a.work, 'history.jsonl')
print(f'PPO (어텐션 신경망 하나) — {a.iters}차례 × 가상 운전자 {a.episodes}명 · 레벨 무게 {a.levelW} · {dev}', flush=True)
if start:
    print(f'  {start} 차례의 정책에서 이어 간다 (비평가는 새로 맞춘다)', flush=True)
for it in range(start, a.iters):
    mpath = os.path.join(a.work, f'model-{it}.json')
    json.dump(to_json(pi, base_json), open(mpath, 'w'))
    d, eps, flows = rollout(mpath, it)
    n = len(d['chosen'])
    augm = d['aug'] > 0.5
    mi = torch.tensor(np.where(~augm)[0], device=dev)  # 보통 운전자 — PPO · 비평가 · 약속 벌점
    ai = torch.tensor(np.where(augm)[0], device=dev)  # 한 레벨에 머무는 흐름 — 약속 벌점에만
    nm = len(mi)
    rows = torch.tensor(d['rows'], device=dev)  # 반정밀도 그대로 — 배치마다 펼친다
    mask = torch.arange(rows.shape[1], device=dev)[None, :] < torch.tensor(d['nsel'], device=dev)[:, None]
    ctx = torch.tensor(d['ctx'], device=dev)
    ch = torch.tensor(d['chosen'], device=dev, dtype=torch.long)
    old = torch.tensor(d['lp'], device=dev)
    cx = torch.tensor(np.concatenate([d['crit'], d['ctx']], 1), device=dev)
    tcls = torch.tensor(d['tcls'].astype(np.int64), device=dev)
    tvalid = (tcls >= 0).float()
    tcls0 = tcls.clamp(min=0)
    tok = torch.tensor(d['tok'].astype(np.float32), device=dev)
    # 바닥 차례이고 그 차례를 채우는 판이 견준 판에 있을 때만 바닥 벌점을 건다
    duev = torch.tensor(d['due'] > 0.5, device=dev) & (tok.sum(1) > 0)
    prior = torch.tensor(d['prior'], device=dev)
    ncls = prior.shape[1]
    if a.sig_floor:
        # 스승의 갈래 비율은 L6 에서 신호 있는 보호구역이 너무 드물다 — 씨앗 여덟으로 재니 보호구역 판 중 무신호가 스승 90.7% · 어텐션 91.3% 로
        # 다양성 테스트의 상한 90% 위였고, 고정 난수의 표본이 위아래로 흔들려 스승도 운으로 통과했다 (2026-11-05). 그 자리의 목표만 올린다.
        sig = prior[:, 2:4].sum(1, keepdim=True)  # TURN_CLASSES 의 signalZone · signalZoneLead
        on = d['due'] < 0.5
        if a.sig_levels:
            # 모든 레벨에 걸었더니 판의 43% 에 걸려 L2 ~ L5 의 무신호 비율까지 내리고 레벨이 +0.067 → −0.076, L10 이 하한 밑으로 갔다 — 넘친 레벨에만 건다
            on = on & np.isin(np.rint(d['ctx'][:, 0] * 10).astype(int), [int(x) for x in a.sig_levels.split(',')])
        lift = (sig > 0) & (sig < a.sig_floor) & torch.tensor(on, device=dev)[:, None]
        scale = torch.ones_like(prior)
        scale[:, 2:4] = a.sig_floor / sig.clamp(min=1e-12)
        rest = (1 - a.sig_floor) / (1 - sig).clamp(min=1e-6)
        scale[:, :2] = rest
        scale[:, 4:] = rest
        prior = torch.where(lift, prior * scale, prior)
        print(f'  갈래 목표: 신호 있는 보호구역 몫을 {a.sig_floor:.0%} 로 올린 판 {float(lift.float().mean()):.1%}')
    pcls = torch.tensor(d['pcls'].astype(np.int64), device=dev)
    pvalid = pcls >= 0
    pcls0 = pcls.clamp(min=0)
    rew = d['reward'].astype(np.float64)
    done = d['done'] > 0.5
    mnp = mi.cpu().numpy()
    if critic is None:
        critic = torch.nn.Sequential(torch.nn.Linear(cx.shape[1], 256), torch.nn.Tanh(), torch.nn.Linear(256, 256), torch.nn.Tanh(), torch.nn.Linear(256, 1)).to(dev)
        vopt = torch.optim.Adam(critic.parameters(), lr=a.vlr)
    # 비평가 — 남은 보상의 합(몬테카를로)에 맞춘 뒤 GAE (머무는 흐름의 판은 판마다 끝 · 보상 0 이고 쓰지 않는다)
    mc = np.zeros(n)
    acc = 0.0
    for i in range(n - 1, -1, -1):
        if done[i]:
            acc = 0.0
        acc = rew[i] + acc
        mc[i] = acc
    mc_t = torch.tensor(mc, device=dev, dtype=torch.float32)
    for _ in range(a.critic_epochs * (3 if it == start else 1)):
        perm = mi[torch.randperm(nm, device=dev)]
        for s in range(0, nm, 4096):
            idx = perm[s:s + 4096]
            vl = F.mse_loss(critic(cx[idx]).squeeze(-1), mc_t[idx])
            vopt.zero_grad(); vl.backward(); vopt.step()
    with torch.no_grad():
        v = critic(cx).squeeze(-1).cpu().numpy().astype(np.float64)
    ev = 1 - np.var(mc[mnp] - v[mnp]) / (np.var(mc[mnp]) + 1e-12)
    adv = np.zeros(n)
    last = 0.0
    for i in range(n - 1, -1, -1):
        nv = 0.0 if done[i] else v[i + 1]
        delta = rew[i] + nv - v[i]
        last = delta + a.lam * (0.0 if done[i] else last)
        adv[i] = last
    ret_t = torch.tensor(adv + v, device=dev, dtype=torch.float32)
    adv_t = torch.tensor((adv - adv[mnp].mean()) / (adv[mnp].std() + 1e-8), device=dev, dtype=torch.float32)

    def forward(net, idx):
        m = mask[idx]
        z = (rows[idx].float() - mean) / std * m[..., None]
        lpall = F.log_softmax(net.scores(z, m, ctx[idx], tcls[idx]), -1)
        return z, m, lpall, lpall.exp()

    def terms(pp, idx):
        """약속 벌점 셋 (판마다) — 차례 신경망과의 갈래 KL · 프로그램 갈래의 CE · 바닥 차례면 채우는 판들의 확률 합"""
        pc = torch.zeros(len(idx), ncls, device=dev).scatter_add_(1, tcls0[idx], pp * tvalid[idx])
        pr = prior[idx]
        ckl = (pr * (torch.log(pr.clamp(min=1e-8)) - torch.log(pc.clamp(min=1e-8)))).sum(1)
        cce = -torch.log(pc.gather(1, pcls0[idx][:, None]).squeeze(1).clamp(min=1e-6)) * pvalid[idx].float()
        mass = (pp * tok[idx]).sum(1)
        return ckl, cce, mass

    def penalty(pp, idx):
        ckl, cce, mass = terms(pp, idx)
        dv = duev[idx]
        fl = -torch.log(mass.clamp(min=1e-6))[dv].mean() if dv.any() else torch.zeros((), device=dev)
        return a.class_kl * ckl.mean() + a.class_ce * cce.mean() + a.floor_w * fl, ckl.mean(), cce.mean(), fl

    def aug_batch():
        return ai[torch.randint(len(ai), (min(a.batch, len(ai)),), device=dev)] if len(ai) else None

    def measure(snap=None):
        """약속을 얼마나 지키는가 — 보통 운전자(main) · 머무는 흐름(aug) 따로"""
        out = {}
        with torch.no_grad():
            for name, ids in (('main', mi), ('aug', ai)):
                if not len(ids):
                    continue
                fm = ck = ce = ks = kr = 0.0
                nd = 0
                for s0 in range(0, len(ids), 4096):
                    idx = ids[s0:s0 + 4096]
                    z, m, lpall, pp = forward(pi, idx)
                    ckl, cce, mass = terms(pp, idx)
                    dv = duev[idx]
                    fm += float(mass[dv].sum()); nd += int(dv.sum())
                    ck += float(ckl.sum()); ce += float(cce.sum())
                    if snap is not None:
                        sl = F.log_softmax(snap.scores(z, m, ctx[idx], tcls[idx]), -1)
                        ks += float((pp * (lpall - sl)).masked_fill(~m, 0).sum(1).sum())
                    rl = F.log_softmax(ref.scores(z, m, ctx[idx], tcls[idx]), -1)
                    kr += float((pp * (lpall - rl)).masked_fill(~m, 0).sum(1).sum())
                k = len(ids)
                out[name] = {'floorMass': fm / max(1, nd), 'classKl': ck / k, 'classCe': ce / max(1, int(pvalid[ids].sum())), 'klSnap': ks / k, 'klref': kr / k}
        return out

    fs = flow_stats(flows)
    if it == start and a.project:
        # **약속만 맞추기** — 보상은 보지 않고, 바닥 차례에 채우는 판의 확률 · 갈래 비율을 맞추며 맞추기 전 정책에서 가장 덜 움직인다
        snap = copy.deepcopy(pi)
        for q in snap.parameters():
            q.requires_grad_(False)
        popt = torch.optim.Adam(pi.parameters(), lr=a.lr)
        print(f'  약속 맞추기 전: {measure(snap)} · 머무는 흐름(실제로 고른 판) {fs}', flush=True)
        for e in range(a.project):
            perm = torch.randperm(n, device=dev)
            for s0 in range(0, n, a.batch):
                idx = perm[s0:s0 + a.batch]
                z, m, lpall, pp = forward(pi, idx)
                with torch.no_grad():
                    sl = F.log_softmax(snap.scores(z, m, ctx[idx], tcls[idx]), -1)
                kls = (pp * (lpall - sl)).masked_fill(~m, 0).sum(1).mean()
                pen, _, _, _ = penalty(pp, idx)
                loss = pen + a.project_kl * kls
                popt.zero_grad(); loss.backward()
                torch.nn.utils.clip_grad_norm_(pi.parameters(), 0.5)
                popt.step()
            got = measure(snap)
            print(f'  약속 맞추기 {e + 1}/{a.project}: ' + ' / '.join(
                f'{k} 바닥 {g["floorMass"]:.3f} · 갈래 KL {g["classKl"]:.3f} · 프로그램 갈래 CE {g["classCe"]:.3f} · 맞추기 전과 KL {g["klSnap"]:.3f}'
                for k, g in got.items()) + f' · 행동 복제와 KL {got["main"]["klref"]:.3f} · {secs()}', flush=True)
        dues = sum(x.get('due', 0) for x in eps)
        with open(hist, 'a') as f:
            f.write(json.dumps({'iter': it, 'project': a.project, 'known': float(np.mean([x['known'] for x in eps])),
                                'level': float(np.mean([x['level'] for x in eps])), 'floor': sum(x.get('met', 0) for x in eps) / max(1, dues),
                                **fs, 'measure': got, 'secs': round(time.time() - t0)}) + '\n')
        continue  # 맞춘 정책으로 다음 차례가 새로 달린다 (이 묶음의 로그 확률은 맞추기 전 정책의 것이라 PPO 에 쓰지 않는다)

    st = {'kl': 0.0, 'clip': 0.0, 'klref': 0.0, 'floorLoss': 0.0, 'classKl': 0.0, 'classCe': 0.0, 'augFloorLoss': 0.0, 'augClassCe': 0.0, 'epochs': 0}
    for e in range(a.epochs):
        perm = mi[torch.randperm(nm, device=dev)]
        kls = []
        for s in range(0, nm, a.batch):
            idx = perm[s:s + a.batch]
            z, m, lpall, pp = forward(pi, idx)
            new = lpall.gather(1, ch[idx][:, None]).squeeze(1)
            ratio = torch.exp(new - old[idx])
            A = adv_t[idx]
            pg = -torch.min(ratio * A, torch.clamp(ratio, 1 - a.clip, 1 + a.clip) * A).mean()
            with torch.no_grad():
                rl = F.log_softmax(ref.scores(z, m, ctx[idx], tcls[idx]), -1)
            klr = (pp * (lpall - rl)).masked_fill(~m, 0).sum(1).mean()
            pen, ckl, cce, fl = penalty(pp, idx)
            loss = pg + a.kl_ref * klr + pen
            ab = aug_batch()
            if ab is not None:
                _, _, _, app = forward(pi, ab)
                apen, _, acce, afl = penalty(app, ab)
                loss = loss + a.aug_w * apen
            opt.zero_grad(); loss.backward()
            torch.nn.utils.clip_grad_norm_(pi.parameters(), 0.5)
            opt.step()
            with torch.no_grad():
                kls.append(float(((ratio - 1) - torch.log(ratio)).mean()))
                st['clip'] = float(((ratio - 1).abs() > a.clip).float().mean())
                st['klref'] = float(klr)
                st['classKl'] = float(ckl)
                st['classCe'] = float(cce)
                st['floorLoss'] = float(fl)
                if ab is not None:
                    st['augFloorLoss'] = float(afl)
                    st['augClassCe'] = float(acce)
            vl = F.mse_loss(critic(cx[idx]).squeeze(-1), ret_t[idx])
            vopt.zero_grad(); vl.backward(); vopt.step()
        st['kl'] = float(np.mean(kls))
        st['epochs'] = e + 1
        if st['kl'] > a.target_kl:
            break
    dues = sum(x.get('due', 0) for x in eps)
    row = {'iter': it, 'decisions': nm, 'ret': float(np.mean([x['ret'] for x in eps])), 'known': float(np.mean([x['known'] for x in eps])),
           'level': float(np.mean([x['level'] for x in eps])), 'ev': float(ev), 'floor': sum(x.get('met', 0) for x in eps) / max(1, dues), **fs, **st,
           'secs': round(time.time() - t0)}
    with open(hist, 'a') as f:
        f.write(json.dumps(row) + '\n')
    aug_s = (f" · 머무는 흐름 바닥 {fs['augFloor']:.0%} · 무신호/보호구역 {fs['augOfZoneMin']:.0%}~{fs['augOfZoneMax']:.0%} · 폭 {fs['augSpread']:.2f}" if fs else '')
    print(f"  {it} · 보상 {row['ret']:.3f} · 익힌 개념 +{row['known']:.2f} · 레벨 {row['level']:.2f} · 바닥 {row['floor']:.0%}{aug_s} · 비평가 설명 {ev:.2f}"
          f" · KL {st['kl']:.4f} · 잘림 {st['clip']:.2f} · 행동 복제와 KL {st['klref']:.3f} · 프로그램 갈래 CE {st['classCe']:.3f} · 되풀이 {st['epochs']} · {secs()}", flush=True)

final = os.path.join(a.work, f'model-{a.iters}.json')
out = to_json(pi, base_json)
out['meta'] = dict(base_json.get('meta', {}))
out['meta']['ppo'] = {'iters': a.iters, 'episodes': a.episodes, 'pool': a.pool, 'lr': a.lr, 'clip': a.clip, 'kl_ref': a.kl_ref, 'lam': a.lam, 'levelW': a.levelW,
                      'floor_w': a.floor_w, 'class_kl': a.class_kl, 'class_ce': a.class_ce, 'aug_flows': a.aug_flows, 'aug_runs': a.aug_runs, 'aug_w': a.aug_w,
                      'critic': '가상 운전자의 속 + 상황 (비대칭)', 'date': time.strftime('%Y-%m-%d')}
json.dump(out, open(final, 'w'))
print(f'저장: {final} · {secs()}', flush=True)
