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
      this.master.gain.value = 0.42;
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
    this.tone(f, 0.06, 'triangle', 0.08, f * 0.6);
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
      this.tone(110 + Math.min(combo, 30) * 8, 0.07, 'triangle', 0.05);
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
    [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone(f, 0.18, 'triangle', 0.09, undefined, i * 0.07));
    this.tone(1047, 0.6, 'triangle', 0.08, 2093, 0.35);
  }

  anvil(): void {
    if (!this.gate('anvil', 0.1)) return;
    this.tone(880, 0.5, 'triangle', 0.12);
    this.tone(1320, 0.4, 'sine', 0.08);
    this.tone(660, 0.3, 'triangle', 0.03);
  }

  chest(): void {
    if (!this.gate('chest', 0.1)) return;
    [784, 988, 1175, 1568].forEach((f, i) => this.tone(f, 0.15, 'triangle', 0.1, undefined, i * 0.05));
  }

  coin(): void {
    if (!this.gate('coin', 0.05)) return;
    this.tone(988, 0.06, 'triangle', 0.06);
    this.tone(1319, 0.15, 'triangle', 0.06, undefined, 0.06);
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

  /** Breakthrough dash: a rising whoosh, bigger with power. */
  dash(power: number): void {
    if (!this.gate('dash', 0.05)) return;
    this.noise(0.18 + 0.2 * power, 0.12 + 0.18 * power, 500, 'bandpass', 2600 + 2400 * power);
    this.tone(160, 0.12 + 0.1 * power, 'sine', 0.12 + 0.12 * power, 60);
  }

  shatter(): void {
    if (!this.gate('shatter', 0.2)) return;
    this.noise(0.5, 0.35, 5000, 'highpass', 800);
    [440, 330, 220, 147].forEach((f, i) => this.tone(f, 0.2, 'triangle', 0.07, f * 0.8, i * 0.09));
  }

  fanfare(): void {
    if (!this.gate('fanfare', 0.3)) return;
    [392, 523, 659, 784, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.2, 'triangle', 0.08, undefined, i * 0.1));
  }

  /** Pleasant chime for valuable ores (gold, ruby, sapphire…). */
  rare(): void {
    if (!this.gate('rare', 0.25)) return;
    [1319, 1760, 2637].forEach((f, i) => this.tone(f, 0.5, 'sine', 0.07, undefined, i * 0.06));
  }

  /**
   * "Oh yes!" for the best ores (diamond, emerald, amethyst, star ore): a tiny formant
   * voice (vowel filters over a buzzy source) followed by a sparkle. Rate-limited.
   */
  ohYes(): void {
    if (!this.gate('ohyes', 3)) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime + 0.02;
    // source: sawtooth with a sung pitch contour "oh" ↘, "yes" ↗↘
    const src = ctx.createOscillator();
    src.type = 'sawtooth';
    src.frequency.setValueAtTime(230, t);
    src.frequency.linearRampToValueAtTime(190, t + 0.3);
    src.frequency.setValueAtTime(240, t + 0.36);
    src.frequency.linearRampToValueAtTime(300, t + 0.5);
    src.frequency.linearRampToValueAtTime(250, t + 0.72);
    const vib = ctx.createOscillator();
    const vibAmt = ctx.createGain();
    vib.frequency.value = 6;
    vibAmt.gain.value = 5;
    vib.connect(vibAmt).connect(src.frequency);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(0.5, t + 0.04);
    env.gain.setValueAtTime(0.5, t + 0.26);
    env.gain.exponentialRampToValueAtTime(0.08, t + 0.33);
    env.gain.exponentialRampToValueAtTime(0.55, t + 0.4);
    env.gain.setValueAtTime(0.5, t + 0.62);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 0.78);
    // formants: "o" → "y(i)" → "e"
    const formants: [number, number, number, number, number][] = [
      // [o, i, e, Q, gain]
      [450, 300, 530, 7, 1],
      [800, 2250, 1850, 9, 0.6],
      [2700, 3000, 2600, 10, 0.25],
    ];
    const mix = ctx.createGain();
    mix.gain.value = 1.4;
    for (const [fo, fi, fe, q, g] of formants) {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = q;
      bp.frequency.setValueAtTime(fo, t);
      bp.frequency.setValueAtTime(fo, t + 0.3);
      bp.frequency.linearRampToValueAtTime(fi, t + 0.38);
      bp.frequency.linearRampToValueAtTime(fe, t + 0.5);
      const a = ctx.createGain();
      a.gain.value = g;
      env.connect(bp).connect(a).connect(mix);
    }
    src.connect(env);
    mix.connect(this.master!);
    src.start(t);
    vib.start(t);
    src.stop(t + 0.8);
    vib.stop(t + 0.8);
    // the "s"
    this.noise(0.14, 0.07, 6000, 'highpass', undefined, 0.68);
    // sparkle
    [1568, 2093, 2637, 3136].forEach((f, i) => this.tone(f, 0.6, 'sine', 0.05, undefined, 0.75 + i * 0.07));
  }

  click(): void {
    if (!this.gate('click', 0.03)) return;
    this.tone(660, 0.04, 'triangle', 0.06);
  }

  buy(): void {
    if (!this.gate('buy', 0.05)) return;
    this.tone(523, 0.08, 'triangle', 0.07);
    this.tone(1047, 0.12, 'triangle', 0.07, undefined, 0.06);
  }

  error(): void {
    if (!this.gate('error', 0.1)) return;
    this.tone(150, 0.15, 'triangle', 0.08, 100);
  }
}

export const sfx = new Sfx();
