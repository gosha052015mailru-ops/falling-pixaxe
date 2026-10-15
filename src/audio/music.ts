/**
 * Calm generative soundtrack in the spirit of ambient sandbox-game music:
 * soft piano-like tones with long decay, quiet pads, a synthetic reverb,
 * slow tempo, and — just as important — silence between pieces.
 * Every piece is composed on the fly (key, chords, melody), so the music
 * never loops the same phrase. No audio files, no licensing.
 */
import { Rng } from '../game/rng';
import { sfx } from './sfx';

export type ThemeId = 'menu' | 'meadow' | 'caves' | 'depths' | 'lava' | 'grotto' | 'abyss';
export const BIOME_THEMES: ThemeId[] = ['meadow', 'caves', 'depths', 'lava', 'grotto', 'abyss'];

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const LYDIAN = [0, 2, 4, 6, 7, 9, 11];
const DORIAN = [0, 2, 3, 5, 7, 9, 10];
const MINOR = [0, 2, 3, 5, 7, 8, 10];
const PHRYGIAN = [0, 1, 3, 5, 7, 8, 10];

interface Mood {
  roots: number[];
  scale: number[];
  /** Chord degrees to choose from (weighted by repetition). */
  chords: number[];
  /** Seconds per beat. */
  beat: [number, number];
  /** Octave offset of the melody. */
  register: number;
  /** Probability of a melody note on a beat. */
  density: number;
  pad: number;
  bells: number;
  /** Silence between pieces, seconds. */
  rest: [number, number];
  /** Low-pass cutoff of the whole mix. */
  tone: number;
}

const MOODS: Record<ThemeId, Mood> = {
  menu: { roots: [60, 65, 62], scale: MAJOR, chords: [0, 0, 3, 3, 5, 4, 1], beat: [0.8, 0.95], register: 0, density: 0.42, pad: 0.7, bells: 0.05, rest: [6, 14], tone: 4200 },
  meadow: { roots: [62, 67, 60], scale: MAJOR, chords: [0, 0, 3, 4, 5, 1], beat: [0.75, 0.9], register: 0, density: 0.45, pad: 0.6, bells: 0.05, rest: [12, 28], tone: 4500 },
  caves: { roots: [57, 62, 59], scale: DORIAN, chords: [0, 0, 3, 6, 2, 4], beat: [0.85, 1.0], register: -1, density: 0.38, pad: 0.7, bells: 0.03, rest: [14, 32], tone: 3200 },
  depths: { roots: [52, 57, 55], scale: MINOR, chords: [0, 0, 5, 3, 6, 4], beat: [0.9, 1.1], register: -1, density: 0.33, pad: 0.8, bells: 0.02, rest: [16, 34], tone: 2600 },
  lava: { roots: [52, 50, 53], scale: PHRYGIAN, chords: [0, 0, 1, 6, 5], beat: [0.95, 1.15], register: -1, density: 0.3, pad: 0.85, bells: 0, rest: [16, 34], tone: 2000 },
  grotto: { roots: [65, 64, 67], scale: LYDIAN, chords: [0, 0, 1, 4, 5, 2], beat: [0.8, 0.95], register: 1, density: 0.4, pad: 0.6, bells: 0.25, rest: [12, 26], tone: 5200 },
  abyss: { roots: [47, 50, 52], scale: MINOR, chords: [0, 0, 5, 3, 6], beat: [1.05, 1.3], register: 0, density: 0.24, pad: 0.9, bells: 0.08, rest: [18, 40], tone: 1800 },
};

type Ev =
  | { k: 'piano'; t: number; m: number; v: number }
  | { k: 'pad'; t: number; ms: number[]; d: number }
  | { k: 'bell'; t: number; m: number; v: number };

function hz(m: number): number {
  return 440 * Math.pow(2, (m - 69) / 12);
}

/** Composes one piece (~40–80 s): chords held by a pad, a sparse piano melody and bass. */
function compose(mood: Mood, rng: Rng): { events: Ev[]; length: number } {
  const root = rng.pick(mood.roots);
  const sc = mood.scale;
  const note = (deg: number, oct: number) => {
    const o = Math.floor(deg / 7);
    return root + (oct + o) * 12 + sc[((deg % 7) + 7) % 7];
  };
  const beat = rng.range(mood.beat[0], mood.beat[1]);
  const nChords = rng.int(6, 9);
  const usePad = rng.chance(mood.pad);
  const events: Ev[] = [];
  let t = 0;
  let mel = rng.int(2, 6);
  let prev = 0;
  for (let c = 0; c < nChords; c++) {
    const deg = c === 0 || c === nChords - 1 ? 0 : rng.pick(mood.chords.filter((d) => d !== prev));
    prev = deg;
    const beats = 8;
    const triad = [deg, deg + 2, deg + 4];
    if (usePad) events.push({ k: 'pad', t, ms: triad.map((d) => note(d, -1)), d: beats * beat + 1.5 });
    // bass on the downbeat, sometimes the fifth halfway
    if (rng.chance(0.85)) events.push({ k: 'piano', t, m: note(deg, -2), v: 0.55 });
    if (rng.chance(0.35)) events.push({ k: 'piano', t: t + 4 * beat, m: note(deg + 4, -2), v: 0.4 });
    // melody: random walk on the scale, chord tones on strong beats, whole bars of rest sometimes
    const restBar = rng.chance(0.2) ? rng.int(0, 1) : -1;
    for (let b = 0; b < beats; b++) {
      if (Math.floor(b / 4) === restBar) continue;
      if (!rng.chance(b % 4 === 0 ? mood.density + 0.2 : mood.density)) continue;
      if (b % 4 === 0) {
        const target = rng.pick(triad) + 7;
        mel = Math.abs(target - mel) <= 3 ? target : mel + Math.sign(target - mel) * 2;
      } else mel += rng.pick([-2, -1, -1, 1, 1, 2]);
      mel = Math.max(0, Math.min(13, mel));
      events.push({ k: 'piano', t: t + b * beat, m: note(mel, mood.register), v: rng.range(0.45, 0.8) });
      if (rng.chance(0.12)) events.push({ k: 'piano', t: t + (b + 0.5) * beat, m: note(mel + rng.pick([1, -1, 2]), mood.register), v: 0.4 });
      if (rng.chance(mood.bells)) events.push({ k: 'bell', t: t + b * beat, m: note(mel + 7, mood.register + 1), v: 0.35 });
    }
    t += beats * beat;
  }
  // a final soft chord to close the phrase
  events.push({ k: 'piano', t, m: note(0, -1), v: 0.5 });
  events.push({ k: 'piano', t: t + 0.04, m: note(4, -1), v: 0.4 });
  events.push({ k: 'piano', t: t + 0.08, m: note(7, mood.register), v: 0.45 });
  return { events: events.sort((a, b) => a.t - b.t), length: t + 4 };
}

export class Music {
  enabled = true;
  private theme: ThemeId = 'menu';
  private out: GainNode | null = null;
  private filter: BiquadFilterNode | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private rng = new Rng((Math.random() * 1e9) | 0);
  private queue: Ev[] = [];
  private pieceStart = 0;
  private nextPieceAt = 0;
  private fever = false;
  private feverNext = 0;
  private ducked = false;
  private readonly volume = 0.21;

  private get ctx(): AudioContext | null {
    return sfx.context;
  }

  private ensureGraph(): boolean {
    const ctx = this.ctx;
    if (!ctx) return false;
    if (this.out) return true;
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = MOODS[this.theme].tone;
    this.filter.connect(ctx.destination);
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    // dry + synthetic reverb (decaying stereo noise impulse response)
    const verb = ctx.createConvolver();
    const len = Math.floor(ctx.sampleRate * 3.2);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        lp = lp * 0.7 + (Math.random() * 2 - 1) * 0.3; // darker tail
        d[i] = lp * Math.pow(1 - i / len, 2.6);
      }
    }
    verb.buffer = ir;
    const wet = ctx.createGain();
    wet.gain.value = 0.55;
    this.out.connect(this.filter);
    this.out.connect(verb).connect(wet).connect(this.filter);
    return true;
  }

  /** Switch mood. Biome changes take effect from the next piece; menu ↔ game fades over. */
  play(id: ThemeId): void {
    const changed = id !== this.theme;
    const bigChange = changed && (id === 'menu' || this.theme === 'menu');
    this.theme = id;
    if (!this.enabled || !this.ensureGraph()) return;
    const ctx = this.ctx!;
    if (!this.timer) {
      this.queue = [];
      this.nextPieceAt = ctx.currentTime + 0.6;
      this.timer = setInterval(() => this.tick(), 50);
      this.applyMix(1.2);
    } else if (bigChange) {
      // fade the current phrase out, start the new mood after a short breath
      this.out!.gain.setTargetAtTime(0, ctx.currentTime, 0.4);
      this.queue = [];
      this.nextPieceAt = ctx.currentTime + 2.2;
      setTimeout(() => this.applyMix(1), 1800);
    }
    if (changed) this.filter!.frequency.setTargetAtTime(this.ducked ? 600 : MOODS[id].tone, ctx.currentTime, 1.5);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.queue = [];
    if (this.out && this.ctx) this.out.gain.setTargetAtTime(0, this.ctx.currentTime, 0.3);
  }

  setEnabled(on: boolean, current: ThemeId): void {
    this.enabled = on;
    if (on) this.play(current);
    else this.stop();
  }

  setFever(on: boolean): void {
    this.fever = on;
  }

  duck(on: boolean): void {
    if (this.ducked === on) return;
    this.ducked = on;
    this.applyMix(0.3);
  }

  private applyMix(time: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.out || !this.filter) return;
    const t = ctx.currentTime;
    this.out.gain.setTargetAtTime(this.enabled ? this.volume * (this.ducked ? 0.5 : 1) : 0, t, time / 3);
    this.filter.frequency.setTargetAtTime(this.ducked ? 600 : MOODS[this.theme].tone, t, time / 3);
  }

  private tick(): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    if (!this.queue.length && now >= this.nextPieceAt) {
      const mood = MOODS[this.theme];
      const piece = compose(mood, this.rng);
      this.queue = piece.events;
      this.pieceStart = now + 0.1;
      this.nextPieceAt = this.pieceStart + piece.length + this.rng.range(mood.rest[0], mood.rest[1]);
    }
    const horizon = now + 0.4;
    while (this.queue.length && this.pieceStart + this.queue[0].t < horizon) {
      const e = this.queue.shift()!;
      const at = Math.max(now, this.pieceStart + e.t);
      if (e.k === 'piano') this.piano(at, e.m, e.v);
      else if (e.k === 'pad') this.pad(at, e.ms, e.d);
      else this.bell(at, e.m, e.v);
    }
    // fever: a soft shimmer of high bells on top, no drums
    if (this.fever && now >= this.feverNext) {
      const mood = MOODS[this.theme];
      const root = mood.roots[0] + 24;
      this.bell(now + 0.05, root + mood.scale[this.rng.int(0, 6)], 0.3);
      this.feverNext = now + this.rng.range(0.25, 0.5);
    }
  }

  /** Soft piano-ish tone: sine + quiet octave, quick attack, long natural decay. */
  private piano(t: number, m: number, v: number): void {
    const ctx = this.ctx!;
    const f = hz(m);
    const g = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = Math.min(4000, f * 6);
    const decay = Math.max(1.6, 3.6 - (m - 48) * 0.03);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.32 * v, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.12 * v, t + 0.35);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    for (const [mult, type, amp] of [
      [1, 'sine', 1],
      [2, 'triangle', 0.18],
      [3, 'sine', 0.06],
    ] as [number, OscillatorType, number][]) {
      const o = ctx.createOscillator();
      const a = ctx.createGain();
      o.type = type;
      o.frequency.value = f * mult;
      o.detune.value = (Math.random() - 0.5) * 6;
      a.gain.value = amp;
      o.connect(a).connect(g);
      o.start(t);
      o.stop(t + decay + 0.05);
    }
    g.connect(lp).connect(this.out!);
  }

  /** Warm pad: detuned sines with slow swell and release. */
  private pad(t: number, ms: number[], d: number): void {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.05, t + 2.2);
    g.gain.setValueAtTime(0.05, t + Math.max(2.3, d - 2.5));
    g.gain.linearRampToValueAtTime(0.0001, t + d);
    for (const m of ms) {
      for (const det of [-5, 5]) {
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.value = hz(m);
        o.detune.value = det;
        o.connect(g);
        o.start(t);
        o.stop(t + d + 0.1);
      }
    }
    g.connect(lp).connect(this.out!);
  }

  /** Glassy bell: a sine plus an inharmonic partial, short decay. */
  private bell(t: number, m: number, v: number): void {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.12 * v, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.8);
    for (const [mult, amp] of [
      [1, 1],
      [2.76, 0.3],
    ]) {
      const o = ctx.createOscillator();
      const a = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = hz(m) * mult;
      a.gain.value = amp;
      o.connect(a).connect(g);
      o.start(t);
      o.stop(t + 1.9);
    }
    g.connect(this.out!);
  }
}

export const music = new Music();
