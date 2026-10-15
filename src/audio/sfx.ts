/**
 * Tiny WebAudio synthesizer — every sound is generated, no audio assets.
 */
export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private lastPlay = new Map<string, number>();
  enabled = true;

  /** Shared audio context (null until the first user gesture). */
  get context(): AudioContext | null {
    return this.ctx;
  }

  get noiseBuffer(): AudioBuffer | null {
    return this.noiseBuf;
  }

  /** Must be called from a user gesture (autoplay policy). */
  unlock(): void {
    if (!this.ctx) {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate * 0.5;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  /** Rate-limit identical sounds so chains don't turn into noise. */
  private gate(key: string, minGap: number): boolean {
    if (!this.enabled || !this.ctx) return false;
    const now = this.ctx.currentTime;
    const last = this.lastPlay.get(key) ?? -1;
    if (now - last < minGap) return false;
    this.lastPlay.set(key, now);
    return true;
  }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, slideTo?: number, delay = 0): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master!);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private noise(dur: number, vol: number, filter: number, type: BiquadFilterType = 'lowpass', sweepTo?: number, delay = 0): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(filter, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(this.master!);
    src.start(t, Math.random() * 0.3);
    src.stop(t + dur + 0.02);
  }

  hit(hardness: number): void {
    if (!this.gate('hit', 0.04)) return;
    const f = 180 + Math.min(600, hardness * 6);
    this.tone(f, 0.06, 'square', 0.08, f * 0.6);
    this.noise(0.05, 0.12, 2500, 'bandpass');
  }

  break(combo: number, ore: boolean): void {
    if (!this.gate('break', 0.03)) return;
    this.noise(0.09, 0.22, 1200, 'lowpass', 300);
    if (ore) {
      const step = Math.min(combo, 24);
      const f = 520 * Math.pow(2, step / 12);
      this.tone(f, 0.12, 'triangle', 0.12);
      this.tone(f * 1.5, 0.1, 'sine', 0.06, undefined, 0.04);
    } else {
      this.tone(110 + Math.min(combo, 30) * 8, 0.07, 'square', 0.05);
    }
  }

  bounce(): void {
    if (!this.gate('bounce', 0.08)) return;
    this.tone(140, 0.05, 'sine', 0.06, 90);
  }

  explode(): void {
    if (!this.gate('explode', 0.05)) return;
    this.noise(0.6, 0.5, 2000, 'lowpass', 80);
    this.tone(70, 0.4, 'sine', 0.35, 30);
  }

  tierUp(): void {
    if (!this.gate('tier', 0.2)) return;
    [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone(f, 0.18, 'square', 0.09, undefined, i * 0.07));
    this.tone(1047, 0.6, 'triangle', 0.08, 2093, 0.35);
  }

  anvil(): void {
    if (!this.gate('anvil', 0.1)) return;
    this.tone(880, 0.5, 'triangle', 0.12);
    this.tone(1320, 0.4, 'sine', 0.08);
    this.tone(660, 0.3, 'square', 0.03);
  }

  chest(): void {
    if (!this.gate('chest', 0.1)) return;
    [784, 988, 1175, 1568].forEach((f, i) => this.tone(f, 0.15, 'triangle', 0.1, undefined, i * 0.05));
  }

  coin(): void {
    if (!this.gate('coin', 0.05)) return;
    this.tone(988, 0.06, 'square', 0.06);
    this.tone(1319, 0.15, 'square', 0.06, undefined, 0.06);
  }

  magic(): void {
    if (!this.gate('magic', 0.1)) return;
    for (let i = 0; i < 6; i++) this.tone(600 + i * 180, 0.25, 'sine', 0.06, 1200 + i * 200, i * 0.04);
  }

  slime(): void {
    if (!this.gate('slime', 0.08)) return;
    this.tone(200, 0.25, 'sine', 0.2, 600);
  }

  sizzle(): void {
    if (!this.gate('sizzle', 0.15)) return;
    this.noise(0.25, 0.15, 4000, 'highpass');
  }

  nudge(): void {
    if (!this.gate('nudge', 0.05)) return;
    this.noise(0.12, 0.12, 800, 'bandpass', 2400);
  }

  shatter(): void {
    if (!this.gate('shatter', 0.2)) return;
    this.noise(0.5, 0.35, 5000, 'highpass', 800);
    [440, 330, 220, 147].forEach((f, i) => this.tone(f, 0.2, 'square', 0.07, f * 0.8, i * 0.09));
  }

  fanfare(): void {
    if (!this.gate('fanfare', 0.3)) return;
    [392, 523, 659, 784, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.2, 'square', 0.08, undefined, i * 0.1));
  }

  click(): void {
    if (!this.gate('click', 0.03)) return;
    this.tone(660, 0.04, 'square', 0.06);
  }

  buy(): void {
    if (!this.gate('buy', 0.05)) return;
    this.tone(523, 0.08, 'square', 0.07);
    this.tone(1047, 0.12, 'square', 0.07, undefined, 0.06);
  }

  error(): void {
    if (!this.gate('error', 0.1)) return;
    this.tone(150, 0.15, 'square', 0.08, 100);
  }
}

export const sfx = new Sfx();
