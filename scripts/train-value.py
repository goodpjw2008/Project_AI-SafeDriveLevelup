# **가치 신경망 학습 — 앞을 내다보는 교사의 눈** (scripts/recommendValue.ts 가 읽는다 · 게임에서는 쓰지 않는다)
#
#   npx vite build --ssr scripts/value-rollout.ts ...  (scratch 에 value-rollout.mjs 로 묶는다)
#   python3 scripts/train-value.py --bin value-rollout.mjs --learners 20000 --out .train-value/value.json
#
# 1. 예전 프로그램이 가상 운전자 `--learners` 명을 60판씩 가르치는 자료를 일꾼(node)들이 모은다 (scripts/value-rollout.ts).
# 2. 상태마다 '여기서 끝까지 프로그램이 이어 가르치면 더 알게 될 개념 수 · 더 나아갈 레벨' (남은 보상의 합)을 GPU 로 배운다.
#    머리 둘 · 은닉 256 × 3 · ReLU. 운전자 단위로 10% 를 떼어 검증하고 가장 잘 맞힌 차례를 남긴다.
#
# **잡음** — 같은 상태에서도 운(익힐지 · 잊을지 · 쉬는 길이)이 끝의 아는 개념 수를 2 개념쯤 흔들어, 가장 좋은 가치 신경망도 남은 보상의
# 흔들림을 30% 쯤만 설명한다(레벨은 65%). 기댓값을 맞히는 데는 그것으로 충분하다 — 나머지는 맞힐 수 없는 운이다.
# **겹쳐 배우기(과적합)** — 운전자마다 개념별 익히는 빠르기가 달라 신경망이 운전자를 외워 그 사람의 운까지 맞히려 들었다(검증 설명이
# 다섯 번째 차례부터 떨어졌다). 드롭아웃 0.2 · 가중치 감쇠 0.01 · 학습률 5e-4 로 막는다.
# **늘 같은 입력** — 프로그램의 후보가 묻지 않는 개념은 학습 자료에서 늘 0 이라, 그 값으로 나누면 다른 판 뒤의 상태에서 가치가 터졌다.
# 표준편차를 0.05 아래로 두지 않고 ±6 에서 자른다 (recommendValue.ts 의 valueOf 도 같게).
import argparse, copy, json, os, subprocess, time
import numpy as np
import torch
import torch.nn.functional as F

p = argparse.ArgumentParser()
p.add_argument('--bin', required=True, help='묶은 일꾼 (scripts/value-rollout.ts 를 vite build --ssr 로 묶은 것)')
p.add_argument('--learners', type=int, default=20000)
p.add_argument('--jobs', type=int, default=os.cpu_count())
p.add_argument('--work', default='.train-value')
p.add_argument('--out', default='.train-value/value.json')
p.add_argument('--epochs', type=int, default=12)
p.add_argument('--hidden', type=int, default=256)
p.add_argument('--drop', type=float, default=0.2)
p.add_argument('--wd', type=float, default=1e-2)
p.add_argument('--lr', type=float, default=5e-4)
p.add_argument('--reuse', type=int, default=0, help='1 — 모아 둔 자료를 다시 쓴다')
a = p.parse_args()
dev = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
t0 = time.time()
os.makedirs(a.work, exist_ok=True)

if not a.reuse:
    per = (a.learners + a.jobs - 1) // a.jobs
    procs = [subprocess.Popen(['node', '--max-old-space-size=8000', a.bin, '--from', str(k * per), '--n', str(min(per, a.learners - k * per)),
                               '--out', os.path.join(a.work, f'w{k}')], stdout=subprocess.DEVNULL) for k in range(a.jobs) if k * per < a.learners]
    for pr in procs:
        if pr.wait() != 0:
            raise RuntimeError('일꾼 실패')
    print(f'자료: 가상 운전자 {a.learners}명 · {time.time() - t0:.0f}초', flush=True)

xs, rks, rps, eps = [], [], [], []
for f in sorted(os.listdir(a.work)):
    if not f.endswith('-rk.f32'):
        continue
    b = os.path.join(a.work, f[:-len('-rk.f32')])
    rk = np.fromfile(b + '-rk.f32', dtype=np.float32)
    xs.append(np.fromfile(b + '-x.f32', dtype=np.float32).reshape(len(rk), -1))
    rks.append(rk)
    rps.append(np.fromfile(b + '-rp.f32', dtype=np.float32))
    eps.append(np.fromfile(b + '-ep.f32', dtype=np.float32))
x = np.concatenate(xs)
rk = np.concatenate(rks).astype(np.float64)
rp = np.concatenate(rps).astype(np.float64)
ep = np.concatenate(eps)
n, D = x.shape
# 남은 보상의 합 — 운전자가 바뀌면 끊는다
gk = np.zeros(n)
gp = np.zeros(n)
ak = ap = 0.0
for i in range(n - 1, -1, -1):
    if i == n - 1 or ep[i + 1] != ep[i]:
        ak = ap = 0.0
    ak += rk[i]
    ap += rp[i]
    gk[i] = ak
    gp[i] = ap
y = np.stack([gk, gp], 1).astype(np.float32)
ids = np.unique(ep)
val_ids = set(np.random.default_rng(0).choice(ids, size=len(ids) // 10, replace=False).tolist())
val = np.array([e in val_ids for e in ep])
mean = x[~val].mean(0)
std = np.maximum(x[~val].std(0), 0.05)
X = torch.tensor(np.clip((x - mean) / std, -6, 6), device=dev)
Y = torch.tensor(y, device=dev)
tr = torch.tensor(np.where(~val)[0], device=dev)
va = torch.tensor(np.where(val)[0], device=dev)
H = a.hidden
net = torch.nn.Sequential(torch.nn.Linear(D, H), torch.nn.ReLU(), torch.nn.Dropout(a.drop), torch.nn.Linear(H, H), torch.nn.ReLU(), torch.nn.Dropout(a.drop),
                          torch.nn.Linear(H, H), torch.nn.ReLU(), torch.nn.Dropout(a.drop), torch.nn.Linear(H, 2)).to(dev)
opt = torch.optim.AdamW(net.parameters(), lr=a.lr, weight_decay=a.wd)
sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, a.epochs)


def explained(idx):
    net.eval()
    with torch.no_grad():
        pr, t = net(X[idx]), Y[idx]
        res = [float(1 - ((pr[:, j] - t[:, j]) ** 2).mean() / t[:, j].var()) for j in range(2)]
    net.train()
    return res


print(f'가치 신경망 — 상태 {n} · 입력 {D} · 은닉 {H} × 3 · {dev}', flush=True)
best, best_state = -1e9, None
for e in range(a.epochs):
    perm = tr[torch.randperm(len(tr), device=dev)]
    for s in range(0, len(perm), 8192):
        idx = perm[s:s + 8192]
        loss = F.mse_loss(net(X[idx]), Y[idx])
        opt.zero_grad()
        loss.backward()
        opt.step()
    sched.step()
    ek, el = explained(va)
    if ek + 0.3 * el > best:
        best, best_state = ek + 0.3 * el, copy.deepcopy(net.state_dict())
    print(f'  {e + 1} · 검증 — 남은 보상의 흔들림을 설명: 개념 {ek:.3f} · 레벨 {el:.3f} · {time.time() - t0:.0f}초', flush=True)
net.load_state_dict(best_state)
layers = [m for m in net if isinstance(m, torch.nn.Linear)]
r6 = lambda t: t.detach().cpu().double().numpy().round(6).tolist()
json.dump({'layers': [{'w': r6(L.weight), 'b': r6(L.bias)} for L in layers], 'mean': mean.astype(np.float64).round(6).tolist(),
           'std': std.astype(np.float64).round(6).tolist(),
           'meta': {'states': int(n), 'learners': int(len(ids)), 'inputs': int(D), 'hidden': H, 'explained': explained(va), 'date': time.strftime('%Y-%m-%d')}},
          open(a.out, 'w'))
print(f'저장: {a.out} · {time.time() - t0:.0f}초', flush=True)
