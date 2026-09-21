/**
 * 계기판 — 3D 실내에 붙는 계기판 패널.
 *
 * 화면 오버레이로 그리면 시점을 돌릴 때 계기판만 제자리에 남아 실내와 따로 논다.
 * 그래서 **대시보드 위 실제 자리에 놓인 3D 판**으로 만들고, 그 위에 캔버스로 게이지를 그린다.
 * 시점을 어디로 돌리든 핸들·대시보드와 한 덩어리로 움직인다.
 *
 * 조명을 받지 않는 재질(MeshBasicMaterial)을 쓴다 — 실제 계기판도 자체 발광이라
 * 밤이든 그늘이든 같은 밝기로 읽혀야 한다.
 */


export interface ClusterState {
  speedKmh: number;
  /** 우측 방향지시등 점등 (점멸 주기 반영된 값) */
  blinkerOn: boolean;
  /** 완전정지 유지 시간 (초) */
  stopHold: number;
  /** 일시정지가 인정됐는가 */
  stopDone: boolean;
  /** 지금 멈춰야 하는 상황인가 */
  stopRequired: boolean;
  /**
   * 서는 까닭이 **일시정지 의무가 아니라 신호**인가 — 신호기 있는 진입로 보호구역 횡단보도의 적색.
   *
   * 그때는 가운데 글자가 '일시정지' 가 아니라 '신호 대기' 다. 잠깐 섰다 가는 자리가 아니라
   * 녹색이 될 때까지 기다리는 자리라서다 (ui/Hud.ts 의 `zoneSignalHold` 와 같은 구분).
   */
  signalWait: boolean;
}

/** 속도계 눈금 최대 (km/h). 실차처럼 200 까지 그리면 이 게임 구간(0~40)에서 바늘이 안 움직인다. */
const SPEED_MAX = 60;

/** 일시정지 인정 기준 시간 (초) — lawRules.STOP_HOLD_SECONDS 와 같은 값 */
const STOP_HOLD_SECONDS = 0.5;

const DIAL_START = Math.PI * 0.75;
const DIAL_SWEEP = Math.PI * 1.5;

/** 캔버스 해상도. 화면에서 300px 남짓으로 보이므로 이 정도면 눈금이 또렷하다. */
const TEX = { w: 1024, h: 340 };

/**
 * 계기판이 **멈춰야 할 때를 알려 주는가** (호박색 게이지 · 가운데 '일시정지') — 난이도 5(어려움)는 끈다
 * (challenge.ts 의 hints). 끄면 서야 하는 곳을 신호와 보행자를 보고 스스로 알아야 한다.
 */
let stopCueEnabled = true;
export function setClusterStopCue(on: boolean): void {
  stopCueEnabled = on;
}

export class ClusterPanel {
  /** 화면 위에 올리는 캔버스 — HUD 의 #cluster 자리에 들어간다 */
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  constructor() {
    this.canvas = document.getElementById('cluster') as HTMLCanvasElement;
    this.canvas.width = TEX.w;
    this.canvas.height = TEX.h;
    this.ctx = this.canvas.getContext('2d')!;
  }

  /** 주행 중에만 띄운다 */
  setVisible(on: boolean): void {
    this.canvas.classList.toggle('on', on);
  }

  /** 매 프레임 갱신 — 캔버스를 다시 그리고 텍스처를 올린다 */
  update(s: ClusterState): void {
    const { ctx } = this;
    ctx.clearRect(0, 0, TEX.w, TEX.h);

    const r = TEX.h * 0.34;
    const cx = TEX.w / 2;
    const cy = TEX.h * 0.5;

    this.drawBinnacle(cx, cy, TEX.w * 0.98, TEX.h * 0.96);
    this.drawGauges(s, cx, cy, r);
  }

  dispose(): void {
    this.setVisible(false);
  }

  /** 게이지 배경 — 실내와 같은 검정이라야 대시보드에 원래 있던 계기판처럼 읽힌다. */
  private drawBinnacle(cx: number, cy: number, bw: number, bh: number): void {
    const { ctx } = this;
    const x = cx - bw / 2;
    const y = cy - bh * 0.5;
    const r = bh * 0.42;

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x, y + bh);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.lineTo(x + bw - r, y);
    ctx.quadraticCurveTo(x + bw, y, x + bw, y + r);
    ctx.lineTo(x + bw, y + bh);
    ctx.closePath();
    /*
      색은 **차량 실내에 맞춘다.**

      전에 쓰던 값(#20242d → #07090d)은 푸른 기가 도는 회색이라, 따뜻한 검정인 모델
      대시보드 위에 놓으니 딴 물건을 얹은 것처럼 떴다. 실내 플라스틱과 같은 계열의
      따뜻한 검정으로 바꾼다.

      값이 실내보다 조금 어두운 것은 의도다 — 이 판은 톤매핑을 받지 않아(toneMapped:false)
      같은 수치라도 톤매핑을 거치는 주변보다 밝게 나온다.

      테두리(흰색 14% 선)도 뺐다. 통을 또렷하게 하려던 선인데, 모델 계기판 후드 안에
      들어앉은 지금은 그 선 하나 때문에 판의 경계가 드러나 붙인 티가 난다.
    */
    const g = ctx.createLinearGradient(0, y, 0, y + bh);
    g.addColorStop(0, '#1a1714');
    g.addColorStop(0.25, '#0d0b09');
    g.addColorStop(1, '#070605');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.restore();
  }

  /** 게이지 두 개(일시정지 · 속도)와 가운데 표시, 그리고 방향지시등 */
  private drawGauges(s: ClusterState, cx: number, cy: number, r: number): void {
    const gap = r * 1.5;
    // 난이도 5 는 "지금 서야 한다" 를 알려 주지 않는다 (아래 setClusterStopCue). 멈춘 시간과 완료는 그대로 보인다
    const stopRequired = stopCueEnabled && s.stopRequired;

    // 왼쪽 — 일시정지 게이지. 이 게임의 채점 기준이라 속도계와 같은 크기로 둔다.
    const holdRatio = Math.min(1, s.stopHold / STOP_HOLD_SECONDS);
    const holdColor = s.stopDone ? '#2ee06a' : stopRequired ? '#ffb020' : '#4c8dff';
    this.dial(cx - gap, cy, r, holdRatio, holdColor);
    this.dialText(
      cx - gap,
      cy,
      r,
      s.stopDone ? '완료' : holdRatio > 0.02 ? s.stopHold.toFixed(1) : '—',
      '일시정지',
      s.stopDone ? '#5ef193' : '#e8ecf2',
    );

    // 오른쪽 — 속도계
    this.dial(cx + gap, cy, r, Math.min(1, s.speedKmh / SPEED_MAX), '#4c8dff');
    this.ticks(cx + gap, cy, r);
    this.dialText(cx + gap, cy, r, String(Math.round(s.speedKmh)), 'KM/H', '#e8ecf2');

    /*
      가운데 — 멈춰야 하는 상황에서만 한 단어. 늘 띄우면 좁은 자리가 더 복잡해진다.

      **'정지' 가 아니라 '일시정지' 다.** 바로 왼쪽 게이지의 이름이 '일시정지' 인데
      가운데만 '정지' 라고 부르면 한 패널이 같은 것을 두 이름으로 말한다.
      글자가 둘에서 넷으로 늘어나므로 글자 수에 맞춰 크기를 줄인다 — 두 게이지
      사이의 빈 폭은 r 하나뿐이라, 0.24r 로 네 글자를 쓰면 게이지에 닿는다.
    */
    if (stopRequired || s.stopDone) {
      const ctx = this.ctx;
      // 신호를 기다리는 자리에는 '완료' 가 없다 — 멈춘 것으로 끝나지 않는다 (위 signalWait)
      const text = s.signalWait ? '신호 대기' : s.stopDone ? '완료' : '일시정지';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = !s.signalWait && s.stopDone ? '#5ef193' : '#ffcb5c';
      ctx.font = `800 ${Math.round(r * (text.length > 2 ? 0.15 : 0.24))}px system-ui, -apple-system, sans-serif`;
      ctx.fillText(text, cx, cy + r * 0.05);
    }

    // 방향지시등은 게이지 **바깥쪽**에 크게 — 가운데에 끼워 넣으면 핸들 살에 가려 안 보인다
    const arrowX = gap + r * 2.0;
    this.arrow(cx - arrowX, cy, r * 0.5, -1, false);
    this.arrow(cx + arrowX, cy, r * 0.5, 1, s.blinkerOn);
  }

  private dial(cx: number, cy: number, r: number, ratio: number, color: string): void {
    const { ctx } = this;

    // 게이지 판과 크롬 링 — 실제 계기판처럼 링이 있어야 '계기' 로 읽힌다
    ctx.beginPath();
    ctx.arc(cx, cy, r * 1.14, 0, Math.PI * 2);
    ctx.fillStyle = '#0b0e13';
    ctx.fill();
    const ring = ctx.createLinearGradient(cx, cy - r, cx, cy + r);
    ring.addColorStop(0, '#9aa3b4');
    ring.addColorStop(0.5, '#5a6172');
    ring.addColorStop(1, '#2e3440');
    ctx.strokeStyle = ring;
    ctx.lineWidth = Math.max(2, r * 0.1);
    ctx.stroke();

    ctx.lineCap = 'butt';
    ctx.strokeStyle = 'rgba(120,140,170,0.28)';
    ctx.lineWidth = Math.max(3, r * 0.1);
    ctx.beginPath();
    ctx.arc(cx, cy, r, DIAL_START, DIAL_START + DIAL_SWEEP);
    ctx.stroke();

    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.arc(cx, cy, r, DIAL_START, DIAL_START + DIAL_SWEEP * Math.max(0.001, ratio));
    ctx.stroke();

    // 바늘
    const a = DIAL_START + DIAL_SWEEP * ratio;
    ctx.strokeStyle = '#e0473a';
    ctx.lineWidth = Math.max(2, r * 0.075);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - Math.cos(a) * r * 0.16, cy - Math.sin(a) * r * 0.16);
    ctx.lineTo(cx + Math.cos(a) * r * 0.82, cy + Math.sin(a) * r * 0.82);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.13, 0, Math.PI * 2);
    ctx.fillStyle = '#39414f';
    ctx.fill();
  }

  /** 속도계 눈금 (20·40 만 숫자) */
  private ticks(cx: number, cy: number, r: number): void {
    const { ctx } = this;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let v = 0; v <= SPEED_MAX; v += 10) {
      const a = DIAL_START + DIAL_SWEEP * (v / SPEED_MAX);
      const major = v % 20 === 0;
      ctx.strokeStyle = major ? 'rgba(232,236,242,0.8)' : 'rgba(151,162,181,0.45)';
      ctx.lineWidth = major ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r * 0.86, cy + Math.sin(a) * r * 0.86);
      ctx.lineTo(cx + Math.cos(a) * r * (major ? 0.7 : 0.76), cy + Math.sin(a) * r * (major ? 0.7 : 0.76));
      ctx.stroke();
      if (major && v !== 0 && v !== SPEED_MAX) {
        ctx.fillStyle = '#97a2b5';
        ctx.font = `700 ${Math.round(r * 0.2)}px system-ui, -apple-system, sans-serif`;
        ctx.fillText(String(v), cx + Math.cos(a) * r * 0.55, cy + Math.sin(a) * r * 0.55);
      }
    }
  }

  private dialText(
    cx: number,
    cy: number,
    r: number,
    value: string,
    unit: string,
    color: string,
  ): void {
    const { ctx } = this;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = color;
    ctx.font = `800 ${Math.round(r * 0.5)}px system-ui, -apple-system, sans-serif`;
    ctx.fillText(value, cx, cy + r * 0.42);
    ctx.fillStyle = '#6b7a92';
    ctx.font = `700 ${Math.round(r * 0.2)}px system-ui, -apple-system, sans-serif`;
    ctx.fillText(unit, cx, cy + r * 0.72);
  }

  /** 방향지시등 화살표 */
  private arrow(cx: number, cy: number, size: number, dir: -1 | 1, on: boolean): void {
    const { ctx } = this;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(dir, 1);
    ctx.beginPath();
    ctx.moveTo(-size, -size * 0.34);
    ctx.lineTo(size * 0.1, -size * 0.34);
    ctx.lineTo(size * 0.1, -size * 0.72);
    ctx.lineTo(size, 0);
    ctx.lineTo(size * 0.1, size * 0.72);
    ctx.lineTo(size * 0.1, size * 0.34);
    ctx.lineTo(-size, size * 0.34);
    ctx.closePath();
    if (on) {
      ctx.fillStyle = '#ffe23a';
      ctx.shadowColor = 'rgba(255,226,58,0.9)';
      ctx.shadowBlur = size * 0.9;
    } else {
      ctx.fillStyle = '#232936';
      ctx.shadowBlur = 0;
    }
    ctx.fill();
    ctx.restore();
  }

}
