/**
 * 効果音。Web Audio で合成するので音声ファイルは持たない。
 *
 * ブラウザは「ユーザー操作の中で」でないと AudioContext を鳴らせないため、
 * init() は開店ボタンや最初のポインタ操作から呼ぶ。それまでは無音のまま。
 */
class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sizzleGain: GainNode | null = null;
  private muted = false;

  /** ユーザー操作の中で呼ぶ。2回目以降は何もしない。 */
  init(): void {
    if (this.ctx) return;
    const Ctor = window.AudioContext;
    if (!Ctor) return;

    const ctx = new Ctor();
    const master = ctx.createGain();
    master.gain.value = this.muted ? 0 : 0.8;
    master.connect(ctx.destination);

    // 焼ける音はホワイトノイズをフィルタに通して作る。
    // ときどき大きな値を混ぜて脂がはぜる音にしている。
    const length = ctx.sampleRate * 2;
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      const crackle = Math.random() < 0.0008 ? (Math.random() * 2 - 1) * 4 : 0;
      data[i] = (Math.random() * 2 - 1) * 0.5 + crackle;
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;

    const highpass = ctx.createBiquadFilter();
    highpass.type = "highpass";
    highpass.frequency.value = 1800;
    const bandpass = ctx.createBiquadFilter();
    bandpass.type = "bandpass";
    bandpass.frequency.value = 4200;
    bandpass.Q.value = 0.6;

    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(highpass).connect(bandpass).connect(gain).connect(master);
    src.start();

    this.ctx = ctx;
    this.master = master;
    this.sizzleGain = gain;
  }

  /** 焼けている串の本数に応じてジュージュー音の大きさを変える。 */
  setSizzle(intensity: number): void {
    if (!this.ctx || !this.sizzleGain) return;
    const target = Math.min(0.35, intensity * 0.07);
    this.sizzleGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.15);
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.ctx && this.master) {
      this.master.gain.setTargetAtTime(muted ? 0 : 0.8, this.ctx.currentTime, 0.05);
    }
  }

  isMuted(): boolean {
    return this.muted;
  }

  /** 成功音 */
  chime(): void {
    this.tone([880, 1318], 0.09, "sine", 0.18);
  }

  /** 失敗音（型エラーのとき） */
  buzz(): void {
    this.tone([140, 120], 0.12, "square", 0.06);
  }

  /** ひっくり返した音 */
  flip(): void {
    this.tone([520], 0.05, "triangle", 0.08);
  }

  private tone(freqs: readonly number[], step: number, type: OscillatorType, volume: number): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;
    freqs.forEach((f, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.value = f;
      const at = ctx.currentTime + i * step;
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(volume, at + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + step * 2.2);
      osc.connect(gain).connect(master);
      osc.start(at);
      osc.stop(at + step * 2.5);
    });
  }
}

export { Sound };
