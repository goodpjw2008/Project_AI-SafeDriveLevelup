/**
 * 사운드 에셋 굽기 — CC0 원본 → 게임이 쓰는 작은 mp3.
 *
 *   npm run sounds
 *
 * 원본은 `assets/sounds-src/` 에 둔다 (저장소에는 넣지 않는다 — .gitignore).
 * 어디서 받는지는 README 의 '사운드' 절에 적어 두었다.
 *
 * ## 왜 스크립트로 두는가
 *
 * 결과물(src/assets/sounds/*.mp3)은 커밋한다 — 130KB 남짓이라 저장소에 두는 편이 낫고,
 * 받는 사람이 ffmpeg 을 깔지 않아도 게임이 돌아야 한다. 그래도 스크립트가 필요한 이유는
 * **어떻게 가공했는지가 결과 파일에 남지 않기 때문**이다. 루프 이음매를 어떻게 없앴는지,
 * 왜 모노인지, 왜 이 음량인지가 여기 적혀 있지 않으면 다음에 음원을 갈아 끼울 때
 * 처음부터 다시 알아내야 한다. (scripts/optimize-models.mjs 와 같은 이유다)
 *
 * ## 왜 mp3 인가
 *
 * 원본은 ogg 인데 mp3 로 다시 굽는다. Safari 는 오랫동안 Ogg Vorbis 를 지원하지 않았고,
 * 이 게임은 **행사장 노트북·태블릿에서 열리는 것을 전제**로 한다 — 한 대에서 소리가
 * 안 나는 것보다 한 세대 더 손실을 감수하는 쪽이 낫다. 원본이 이미 휴대폰 녹음
 * 64kbps 라 이 재인코딩이 품질의 한계를 정하지도 않는다.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = join(ROOT, 'assets/sounds-src');
const OUT = join(ROOT, 'src/assets/sounds');

/** 엔진 루프의 겹침 길이(초) — 끝과 처음을 이만큼 겹쳐 이음매를 없앤다 */
const CROSSFADE = 0.25;

/**
 * 깜빡이 클릭을 잘라 낼 길이(초).
 *
 * 원본의 클릭은 포락선이 20~58ms 만에 −26dB 로 죽는다. 90ms 면 여유 있게 담기고,
 * 클릭 간격(320ms)의 3분의 1이라 다음 클릭을 물지도 않는다.
 */
const CLICK_LEN = 0.09;

/** 목표 피크 (dBFS). 0 에 붙이면 mp3 로 굽는 과정에서 넘칠 수 있어 조금 남겨 둔다 */
const PEAK_TARGET_DB = -1.5;

/** 시동음의 목표 피크 — 엔진 루프와 나란히 들리도록 조금 낮게 */
const START_PEAK_DB = -6;

const run = (args) => execFileSync('ffmpeg', ['-v', 'error', '-y', ...args], { stdio: 'inherit' });

/**
 * 이 구간을 목표 피크까지 올리려면 몇 dB 를 더해야 하는가.
 *
 * **깜빡이에는 `loudnorm` 을 쓰지 않는다.** 그것은 프로그램 소재용 라우드니스 정규화라
 * **순간음의 어택을 뭉갠다** — 딸깍의 첫머리가 눌려 "딱" 이 아니라 "특" 이 된다.
 * 클릭은 파형을 그대로 두고 크기만 맞춰야 하므로 재고(1패스) 곱한다(2패스).
 */
function peakGainDb(args, target = PEAK_TARGET_DB) {
  // volumedetect 는 **stderr** 로 적는다 — execFileSync 는 stdout 만 돌려준다
  const r = spawnSync('ffmpeg', ['-v', 'info', ...args, '-af', 'volumedetect', '-f', 'null', '-']);
  const m = String(r.stderr).match(/max_volume:\s*(-?[\d.]+) dB/);
  return m ? (target - Number(m[1])).toFixed(2) : 0;
}

const duration = (file) =>
  Number(
    execFileSync('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=nw=1:nk=1',
      file,
    ]).toString().trim(),
  );

/**
 * 없으면 무엇을 깔아야 하는지까지 알려 주고 끝낸다 — "spawn ENOENT" 는 아무 도움이 안 된다.
 *
 * 버전을 묻는 방법이 도구마다 다르다 (ffmpeg 은 `-version`, ffprobe 도 마찬가지).
 */
function need(cmd, flag, how) {
  try {
    execFileSync(cmd, [flag], { stdio: 'ignore' });
  } catch {
    console.error(`${cmd} 이 필요합니다 — ${how}`);
    process.exit(1);
  }
}

need('ffmpeg', '-version', 'brew install ffmpeg');
need('ffprobe', '-version', 'brew install ffmpeg');

if (!existsSync(SRC)) {
  console.error(`원본이 없습니다: ${SRC}\nREADME 의 '사운드' 절을 보고 받아 주세요.`);
  process.exit(1);
}

mkdirSync(OUT, { recursive: true });

{
  /*
    원본은 **전부 Freesound 한 곳**에서 온다. 한때 크락션만 BigSoundBank 였는데,
    받는 곳이 둘이면 크레딧도 두 벌이고 원본 폴더도 두 개다. 소리가 일곱 개뿐인
    프로젝트에서 그럴 이유가 없다.
  */
  const fs = (name) => join(SRC, 'freesound', name);

  /**
   * 원본의 한 구간을 잘라 **이음매 없는 루프**로 만든다.
   *
   * 그냥 잘라 쓰면 끝과 처음이 안 맞아 루프마다 딱 소리가 난다. 그렇다고
   * `acrossfade` 로 두 입력을 이어 붙이면 길이만 두 배가 되고 루프 지점은 그대로다.
   *
   * **회전시켜 겹친다.**
   *
   *     자른 구간을 [0, D] 와 [D, L] 로 나누고 → [D, L] 뒤에 [0, D] 를 겹쳐 붙인다
   *
   * 결과의 처음과 끝이 원본의 **같은 지점(D)** 이라 이어 붙는 자리가 들리지 않는다.
   * 길이는 L - D 다. 그래서 원본에서는 (루프길이 + 겹침) 만큼 잘라 온다.
   */
  function engineLoop(src, at, len, out) {
    const raw = len + CROSSFADE;
    run([
      '-ss', String(at), '-t', String(raw), '-i', src,
      '-filter_complex',
      `[0:a]atrim=start=${CROSSFADE},asetpts=PTS-STARTPTS,aformat=channel_layouts=mono[y];` +
        `[0:a]atrim=end=${CROSSFADE},asetpts=PTS-STARTPTS,aformat=channel_layouts=mono[x];` +
        `[y][x]acrossfade=d=${CROSSFADE}[c];` +
        // 엔진은 배경음이다 — 경적보다 한참 낮게 깔아 둔다
        `[c]loudnorm=I=-20:TP=-3[o]`,
      '-map', '[o]', '-c:a', 'libmp3lame', '-b:a', '64k',
      out,
    ]);
  }

  // ── 주행음 — 상태 세 벌 ──────────────────────────────────────────────────
  /*
    **이 게임에 있는 속도는 셋뿐이라 녹음도 셋이다.** 정지 · 출발(서행) · 순항.
    시나리오가 어떻게 흘러도 이 셋을 오갈 뿐이다 — 순항으로 들어와 정지선에 서고,
    서행으로 교차로를 돌고, 다시 서고, 횡단보도를 빠져나오며 순항으로 돌아간다
    (Vehicle.ts 의 SLOW_KMH · CRUISE_KMH).

    ## 왜 한 벌을 밀어 올리지 않는가

    예전에는 주행 루프 하나를 재생 속도와 저역통과 필터로 밀어 올렸다. 아무리 다듬어도
    **테이프를 빨리 감는 소리**를 벗어나지 못했는데, 원본(andrewfordham 848361,
    닛산 캐시카이 실내)을 재 보고 이유를 알았다.

      - 기본파는 공회전 28.3Hz(약 850rpm) → 순항 33Hz(약 990rpm). **1.17배**뿐이다.
        CVT 라 속도가 붙어도 회전수를 붙들어 둔다. 재생 속도를 0.78~1.52 로 벌리던 것은
        이 차에 **없는 변화를 지어내는** 것이었다.
      - 반면 80Hz 위 에너지는 **+20.9dB** 오른다. 전 대역이 함께 오르고 무게중심은
        471 → 429Hz 로 오히려 내려간다. 실내에서 속도로 들리는 것은 타이어와 바람이고,
        그것은 음높이가 아니라 **크기**로 나타난다. 속도에 따라 저역통과를 여는 것도
        이 재료에서는 거꾸로였다.

    그래서 상태마다 **그 상태를 실제로 녹음한 것**을 쓴다. 속도로 만들어 내지 않는다.

    ## 컷 지점

    손으로 고른 값이 아니다. 256ms 창으로 RMS 를 재서 가장 평탄한 자리를 찾았다.

        정지   6.37초부터 5.0초   -30.3dB   흔들림 0.68dB
        출발   1.98초부터 3.0초   -22.8dB   흔들림 1.45dB
        순항   5.22초부터 5.0초   -13.4dB   흔들림 1.59dB

    **출발은 8초까지만 쓴다.** drive2 는 정지에서 떠나는 구간이라 뒤로 갈수록 커진다
    (8초 -18.6 → 11초 -16.6dB). 그 뒤를 물면 루프를 돌 때마다 가속이 되풀이된다.

    길이가 3~5초로 긴 이유는 **광대역 잡음이라서**다. 짧게 돌리면 잡음의 무늬가 주기적으로
    되풀이되어 웅웅거리는 맥놀이로 들린다.

    ## 세 벌을 각각 같은 크기로 맞춘다

    `loudnorm` 이 셋을 같은 라우드니스로 올리므로, 여기서 나온 파일만으로는 어느 것이
    빠른 상태인지 알 수 없다. **상태 사이의 크기 차이는 Audio.ts 의 표가 정한다** —
    한자리에 모아 두어야 듣고 고칠 수 있기 때문이다. 원본에서 잰 차이(+7.5 / +9.4dB)는
    그 표에 적어 두었다.
  */
  const STATES = [
    { out: 'drive-stop', src: 'drive1.WAV', at: 6.37, len: 5.0 },
    { out: 'drive-slow', src: 'drive2.WAV', at: 1.98, len: 3.0 },
    { out: 'drive-cruise', src: 'drive3.WAV', at: 5.22, len: 5.0 },
  ];

  for (const s of STATES) engineLoop(fs(s.src), s.at, s.len, join(OUT, `${s.out}.mp3`));

  // ── 경적 ────────────────────────────────────────────────────────────────
  /*
    **한 녹음에서 두 벌이 나온다** (boedie 의 알파로메오 MiTo, 6.79초). 이 파일에는
    경적이 네 번 들어 있는데, 앞의 하나는 **단발**이고 뒤의 셋은 0.1초 간격으로 붙은
    **연타**다. 게임에서 뒷차가 재촉하는 방식이 그 둘이므로 갈라서 굽는다.

    ## 진짜 듀얼톤이다

    재 보면 **402 + 502Hz** 가 함께 울린다 (장3도, 비율 1.25). 그 위로 801(=2×400) ·
    1000(=2×500) · 1500(=3×500) 이 얹힌다 — 서로 정수배가 아닌 **독립된 두 기본음**이다.

    예전에 쓰던 소리(BigSoundBank 3506)는 394 · 787 · 1180 · 1573 으로 394 의 정확한
    정수배, 즉 **단일 톤**이었다. 실제 승용차 크락션은 경적이 두 개 달려 화음으로
    울리므로, 듀얼톤 쪽이 실차에 가깝다.

    ## 컷 지점

    포락선을 10ms 로 훑어 잡았다. 앞은 어택이 잘리지 않게 **타점보다 조금 앞**에서
    자르고, 뒤는 잦아든 자리까지 남긴다 — 경적은 울리다 끊기는 것이 아니라 여운이 있다.

        단발  1.16초 타점 → 1.14 부터 0.48초 (여운 -30dB 까지)
        연타  4.32초 타점 → 4.30 부터 0.68초 (셋을 다 담고 여운까지)
  */
  const HORNS = [
    { out: 'horn-single', at: 1.14, len: 0.48, fade: 0.06 },
    { out: 'horn-triple', at: 4.3, len: 0.68, fade: 0.08 },
  ];

  for (const h of HORNS) {
    run([
      '-ss', String(h.at), '-t', String(h.len), '-i', fs('horn.wav'),
      '-ac', '1',
      // 자른 끝을 재운다 — 경적이 뚝 끊기면 그 자리에서 딱 소리가 난다
      '-af', `loudnorm=I=-16:TP=-1.5,afade=t=out:st=${h.len - h.fade}:d=${h.fade}`,
      '-c:a', 'libmp3lame', '-b:a', '64k',
      join(OUT, `${h.out}.mp3`),
    ]);
  }

  // ── 시동음 ──────────────────────────────────────────────────────────────
  /*
    판을 시작할 때 한 번 나는 소리다 — 엔진음과 달리 고를 것이 없다.

    원본이 이미 시동 구간만 잘려 있어(3.07초) 그대로 쓰되, **끝 0.4초를 재운다** —
    그 사이에 엔진 루프가 올라오며 이어진다.

    **loudnorm 이 아니라 피크로 맞춘다.** 시동음은 크랭킹이 세고 걸린 뒤가 잦아드는
    소리라, 라우드니스 정규화를 걸면 그 기울기가 눌려 '털털털' 이 평평해진다.
  */
  {
    const src = fs('start.WAV');
    const input = ['-i', src];
    run([
      ...input, '-ac', '1',
      '-af', `volume=${peakGainDb(input, START_PEAK_DB)}dB,afade=t=out:st=2.65:d=0.4`,
      '-c:a', 'libmp3lame', '-b:a', '64k',
      join(OUT, 'engine-start.mp3'),
    ]);
  }

  // ── 방향지시등 ──────────────────────────────────────────────────────────
  /*
    **켤 때와 끌 때가 다른 소리다.** 실제 릴레이가 그렇고, 이 게임은 깜빡이를 켜는 것을
    가르치므로 그 소리를 한 판에 서른 번쯤 듣게 된다 — 같은 소리를 두 번 내면 몇 초 만에
    기계음으로 들린다.

    원본(The_Cri 의 BMW Indicator)은 깜빡이가 **47초 동안 도는** 녹음이라 클릭이 113개
    들어 있다. 짝수 번째가 켤 때, 홀수 번째가 끌 때다 — 측정해 보면 짝수는 1896Hz 로
    낮고 크며, 홀수는 2469Hz 로 높고 작다.

    아래 `at` 은 그중 **둘 다 세고 서로 균형이 맞는** 쌍의 시각이다. 손으로 고른 것이
    아니라 113개를 전부 재서 점수를 매긴 결과다.

    ## 한 벌만 굽는다

    한때 셋(33.13 / 44.65 / 38.89초)을 구워 놓고 골랐다. 들어 보고 **가장 둔탁한 것**을
    남겼다 — 이 소리는 한 판에 서른 번쯤 나므로 또렷한 쪽은 몇 초 만에 기계음이 된다.
    번호가 1 인 것은 고르던 때의 이름을 그대로 두었기 때문이다.

    ## 왼쪽 채널만 쓴다

    이 파일은 좌우 상관이 0.16 밖에 안 된다. 모노로 합치면 서로 다른 소리가 섞여
    피크가 0.25 → 0.16 으로 깎인다. L 이 R 보다 크므로 그쪽을 쓴다.
  */
  const BLINKERS = [{ out: 'blinker-1', on: 33.13, off: 33.45 }];

  const PRE = 0.004; // 타점보다 조금 앞에서 자른다 — 위에서 자르면 첫머리가 잘린다
  for (const b of BLINKERS) {
    for (const side of ['on', 'off']) {
      const at = Math.max(0, b[side] - PRE);
      // 왼쪽 채널만 꺼내는 것까지 포함해 두 번(측정·인코딩) 같은 입력을 만든다
      const input = ['-ss', String(at), '-t', String(CLICK_LEN), '-i', fs('indicator.WAV'),
                     '-af', 'pan=mono|c0=c0'];
      run([
        ...input.slice(0, -2),
        '-af',
        `pan=mono|c0=c0,volume=${peakGainDb(input)}dB,` +
          // 자른 끝을 짧게 재운다 — 안 그러면 잘린 자리에서 딱 소리가 난다
          `afade=t=out:st=${CLICK_LEN - 0.015}:d=0.015`,
        '-c:a', 'libmp3lame', '-b:a', '96k',
        join(OUT, `${b.out}-${side}.mp3`),
      ]);
    }
  }

  // ── 확인 ────────────────────────────────────────────────────────────────
  console.log('\n구운 결과:');
  const made = [
    ...STATES.map((s) => s.out),
    'engine-start',
    ...HORNS.map((h) => h.out),
    ...BLINKERS.flatMap((b) => [`${b.out}-on`, `${b.out}-off`]),
  ];
  for (const f of made) {
    const p = join(OUT, `${f}.mp3`);
    console.log(`  ${f.padEnd(16)} ${duration(p).toFixed(2)}초`);
  }
  console.log(`\n${made.length}개 → ${OUT}`);
}
