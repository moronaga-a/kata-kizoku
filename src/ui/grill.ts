/**
 * 焼き台の炭火と煙。canvas 2D でループ描画する。
 *
 * ここはドメインに一切触らない純粋な見た目の処理。
 * 煙は「焼いている串が何本あるか」だけを外から受け取る。
 */

const SLOT_COUNT = 8;
const COAL_COUNT = 170;

type Coal = { x: number; y: number; r: number; phase: number };
type Puff = { x: number; y: number; vx: number; vy: number; life: number; size: number };

/**
 * 焼き台の左右の位置（0〜1）から火力を出す。真ん中が一番強い。
 *
 * ゲーム性のための数値だが、描画と tick() の両方で同じ曲線を使いたいので
 * ここに置いて main から参照している。
 */
function heatAtFraction(f: number): number {
  return 0.3 + 0.7 * Math.pow(1 - Math.abs(f - 0.5) * 2, 1.3);
}

/** スロット番号（0〜7）の火力 */
function heatOfSlot(slot: number): number {
  return heatAtFraction((slot + 0.5) / SLOT_COUNT);
}

class GrillCanvas {
  private coalCtx: CanvasRenderingContext2D | null = null;
  private smokeCtx: CanvasRenderingContext2D | null = null;
  private readonly coals: Coal[] = [];
  private puffs: Puff[] = [];
  /** 今焼けている串の本数。煙の量に使う */
  private sizzling = 0;

  constructor(
    private readonly coalCanvas: HTMLCanvasElement,
    private readonly smokeCanvas: HTMLCanvasElement,
  ) {
    for (let i = 0; i < COAL_COUNT; i++) {
      this.coals.push({
        x: Math.random(),
        y: 0.08 + Math.random() * 0.84,
        r: 0.55 + Math.random() * 0.7,
        phase: Math.random() * Math.PI * 2,
      });
    }
  }

  /** 画面サイズが変わったときに呼ぶ。devicePixelRatio を見て解像度を合わせる */
  resize(): void {
    this.coalCtx = setupCanvas(this.coalCanvas);
    this.smokeCtx = setupCanvas(this.smokeCanvas);
  }

  setSizzling(count: number): void {
    this.sizzling = count;
  }

  draw(timeMs: number, deltaSeconds: number): void {
    this.drawCoals(timeMs);
    this.drawSmoke(deltaSeconds);
  }

  private drawCoals(timeMs: number): void {
    const ctx = this.coalCtx;
    if (!ctx) return;
    const w = this.coalCanvas.clientWidth;
    const h = this.coalCanvas.clientHeight;
    ctx.clearRect(0, 0, w, h);

    // 中央が明るい下地
    const glow = ctx.createLinearGradient(0, 0, w, 0);
    glow.addColorStop(0, "rgba(90,25,8,0.25)");
    glow.addColorStop(0.5, "rgba(230,90,30,0.45)");
    glow.addColorStop(1, "rgba(90,25,8,0.25)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);

    // 炭の粒。位置ごとの火力でゆらぎの強さを変える
    const t = timeMs / 1000;
    for (const coal of this.coals) {
      const heat = heatAtFraction(coal.x);
      const flicker = 0.55 + 0.45 * Math.sin(t * 2.4 + coal.phase);
      const alpha = 0.25 + heat * flicker * 0.75;
      const radius = coal.r * (1 + heat * 1.6);
      ctx.beginPath();
      ctx.arc(coal.x * w, coal.y * h, radius, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${Math.round(200 + heat * 55)},${Math.round(70 + heat * 90)},30,${alpha})`;
      ctx.fill();
    }
  }

  private drawSmoke(deltaSeconds: number): void {
    const ctx = this.smokeCtx;
    if (!ctx) return;
    const w = this.smokeCanvas.clientWidth;
    const h = this.smokeCanvas.clientHeight;
    ctx.clearRect(0, 0, w, h);

    // 焼いている本数に応じて煙を足す
    const spawn = Math.min(3, this.sizzling) * deltaSeconds * 6;
    if (Math.random() < spawn) {
      this.puffs.push({
        x: w * (0.2 + Math.random() * 0.6),
        y: h * 0.86,
        vx: (Math.random() - 0.5) * 10,
        vy: -16 - Math.random() * 14,
        life: 1,
        size: 6 + Math.random() * 10,
      });
    }

    const next: Puff[] = [];
    for (const p of this.puffs) {
      p.x += p.vx * deltaSeconds;
      p.y += p.vy * deltaSeconds;
      p.vx += (Math.random() - 0.5) * 6 * deltaSeconds;
      p.life -= deltaSeconds * 0.55;
      if (p.life <= 0) continue;
      const r = p.size * (1.6 - p.life);
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(226,218,205,${p.life * 0.14})`;
      ctx.fill();
      next.push(p);
    }
    // 上限を設けないと、長く遊んだときに描画が重くなる
    this.puffs = next.slice(-120);
  }
}

function setupCanvas(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.max(1, Math.round(rect.width * dpr));
  canvas.height = Math.max(1, Math.round(rect.height * dpr));
  const ctx = canvas.getContext("2d");
  ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

export { GrillCanvas, heatOfSlot, heatAtFraction, SLOT_COUNT };
