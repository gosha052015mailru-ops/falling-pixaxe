/**
 * Two generative soundtracks (no audio files, no licensing):
 *  - "groove" (default): upbeat but easy-on-the-ears casual-game music — soft drums,
 *    bouncy bass, electric-piano chords, a catchy motif-based melody, pop progressions;
 *  - "calm": ambient sandbox-game style (below).
 *
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

export type MusicStyle = 'groove' | 'calm';

type Ev =
  | { k: 'piano'; t: number; m: number; v: number }
  | { k: 'pad'; t: number; ms: number[]; d: number }
  | { k: 'bell'; t: number; m: number; v: number }
  | { k: 'bass'; t: number; m: number; v: number; d: number }
  | { k: 'keys'; t: number; ms: number[]; v: number; d: number }
  | { k: 'lead'; t: number; m: number; v: number; d: number }
  | { k: 'kick'; t: number; v: number }
  | { k: 'snare'; t: number; v: number }
  | { k: 'hat'; t: number; v: number };

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


// ───────────────────────── groove (default) ─────────────────────────

interface GrooveMood {
  roots: number[];
  scale: number[];
  bpm: [number, number];
  progressions: number[][];
  /** 0 = brushes only, 1 = light kit, 2 = full kit. */
  drums: 0 | 1 | 2;
  tone: number;
  /** Chance of glassy bell arpeggios in the B section. */
  bells: number;
}

const POP_MAJOR = [
  [0, 4, 5, 3],
  [0, 5, 3, 4],
  [5, 3, 0, 4],
  [3, 4, 0, 5],
  [1, 4, 0, 0],
  [0, 3, 1, 4],
];
const POP_MINOR = [
  [0, 5, 2, 6],
  [0, 3, 6, 2],
  [5, 6, 0, 0],
  [0, 6, 5, 4],
];

const GROOVES: Record<ThemeId, GrooveMood> = {
  menu: { roots: [60, 65, 62, 67], scale: MAJOR, bpm: [96, 104], progressions: POP_MAJOR, drums: 1, tone: 6000, bells: 0.3 },
  meadow: { roots: [62, 67, 60], scale: MAJOR, bpm: [104, 112], progressions: POP_MAJOR, drums: 2, tone: 6500, bells: 0.2 },
  caves: { roots: [57, 62, 55], scale: DORIAN, bpm: [100, 108], progressions: POP_MINOR, drums: 2, tone: 5200, bells: 0.15 },
  depths: { roots: [55, 57, 52], scale: MINOR, bpm: [98, 104], progressions: POP_MINOR, drums: 2, tone: 4600, bells: 0.15 },
  lava: { roots: [52, 55, 50], scale: MINOR, bpm: [108, 116], progressions: POP_MINOR, drums: 2, tone: 4200, bells: 0.05 },
  grotto: { roots: [65, 64, 67], scale: LYDIAN, bpm: [92, 100], progressions: POP_MAJOR, drums: 1, tone: 7000, bells: 0.6 },
  abyss: { roots: [50, 52, 47], scale: MINOR, bpm: [88, 96], progressions: POP_MINOR, drums: 1, tone: 3800, bells: 0.25 },
};

/**
 * One ~16-bar song (A A' B A''): pop progression, bouncy bass, offbeat e-piano,
 * a 2-bar melodic motif that repeats (catchy) and re-targets to each chord, soft drums.
 */
function composeGroove(mood: GrooveMood, rng: Rng): { events: Ev[]; length: number } {
  const root = rng.pick(mood.roots);
  const sc = mood.scale;
  const note = (deg: number, oct: number) => {
    const o = Math.floor(deg / 7);
    return root + (oct + o) * 12 + sc[((deg % 7) + 7) % 7];
  };
  const bpm = rng.range(mood.bpm[0], mood.bpm[1]);
  const step = 60 / bpm / 4; // 16th note
  const bar = step * 16;
  const progA = rng.pick(mood.progressions);
  let progB = rng.pick(mood.progressions);
  if (progB === progA) progB = mood.progressions[(mood.progressions.indexOf(progA) + 1) % mood.progressions.length];

  // motif: rhythm on a 16th grid over 2 bars, pitches as scale steps relative to the chord root
  const makeMotif = () => {
    const m: { s: number; deg: number; len: number }[] = [];
    let deg = rng.pick([2, 4, 7]);
    for (let s = 0; s < 32; s += 2) {
      const strong = s % 8 === 0;
      if (!rng.chance(strong ? 0.75 : 0.45)) continue;
      deg = strong ? rng.pick([0, 2, 4, 7]) : Math.max(-1, Math.min(9, deg + rng.pick([-1, 1, 1, 2, -2])));
      const len = rng.pick([2, 2, 4]);
      m.push({ s, deg, len });
      if (rng.chance(0.15) && s % 4 === 2) m.push({ s: s + 1, deg: deg + 1, len: 1 });
    }
    return m;
  };
  const motifA = makeMotif();
  const motifB = makeMotif();

  const events: Ev[] = [];
  const sections: { prog: number[]; motif: typeof motifA; kind: 'A' | 'B'; fill: boolean; vary: boolean }[] = [
    { prog: progA, motif: motifA, kind: 'A', fill: false, vary: false },
    { prog: progA, motif: motifA, kind: 'A', fill: true, vary: true },
    { prog: progB, motif: motifB, kind: 'B', fill: true, vary: false },
    { prog: progA, motif: motifA, kind: 'A', fill: false, vary: true },
  ];
  let t = 0;
  sections.forEach((sec, si) => {
    for (let b = 0; b < 4; b++) {
      const deg = sec.prog[b];
      const nextDeg = sec.prog[(b + 1) % 4];
      const t0 = t + b * bar;
      const last = si === sections.length - 1 && b === 3;
      // ── drums
      if (mood.drums >= 1) {
        events.push({ k: 'kick', t: t0, v: 1 });
        if (mood.drums === 2) {
          events.push({ k: 'kick', t: t0 + 8 * step, v: 0.9 });
          if (rng.chance(0.4)) events.push({ k: 'kick', t: t0 + 10 * step, v: 0.6 });
        } else events.push({ k: 'kick', t: t0 + 8 * step, v: 0.6 });
        events.push({ k: 'snare', t: t0 + 4 * step, v: mood.drums === 2 ? 0.9 : 0.55 });
        if (!(sec.fill && b === 3)) events.push({ k: 'snare', t: t0 + 12 * step, v: mood.drums === 2 ? 0.9 : 0.55 });
      }
      for (let st = 0; st < 16; st += sec.kind === 'B' ? 1 : 2) {
        const off = st % 4 === 2;
        events.push({ k: 'hat', t: t0 + st * step, v: st % 2 ? 0.3 : off ? 0.75 : 0.45 });
      }
      if (sec.fill && b === 3) for (const st of [12, 13, 14, 15]) events.push({ k: 'snare', t: t0 + st * step, v: 0.35 + (st - 12) * 0.12 });
      // ── bass: root, octave bounce, fifth, approach to the next chord
      const r = note(deg, -2);
      events.push({ k: 'bass', t: t0, m: r, v: 1, d: step * 3 });
      events.push({ k: 'bass', t: t0 + 3 * step, m: r, v: 0.6, d: step * 1.5 });
      events.push({ k: 'bass', t: t0 + 6 * step, m: r + 12, v: 0.7, d: step * 1.5 });
      events.push({ k: 'bass', t: t0 + 8 * step, m: note(deg + 4, -2), v: 0.85, d: step * 3 });
      events.push({ k: 'bass', t: t0 + 14 * step, m: note(nextDeg, -2) + (rng.chance(0.5) ? -1 : 2), v: 0.55, d: step * 1.5 });
      // ── keys: offbeat stabs in A, sustained chords in B
      const chord = [deg, deg + 2, deg + 4, ...(rng.chance(0.4) ? [deg + 6] : [])].map((d) => note(d, -1));
      if (last) events.push({ k: 'keys', t: t0, ms: chord, v: 0.9, d: bar * 1.5 });
      else if (sec.kind === 'A') for (const st of [2, 6, 10, 14]) events.push({ k: 'keys', t: t0 + st * step, ms: chord, v: st === 2 ? 0.8 : 0.6, d: step * 1.6 });
      else events.push({ k: 'keys', t: t0, ms: chord, v: 0.7, d: bar * 0.95 });
      // ── melody: the motif repeats every 2 bars and follows the chord
      const half = b % 2;
      for (const n of sec.motif) {
        if (Math.floor(n.s / 16) !== half) continue;
        let d = n.deg + deg;
        if (sec.vary && b === 3 && n.s >= 24) d += rng.pick([1, 2, -1]);
        events.push({ k: 'lead', t: t0 + (n.s % 16) * step, m: note(d, 1), v: n.s % 8 === 0 ? 0.9 : 0.7, d: n.len * step });
      }
      // ── sparkle arps in the B section
      if (sec.kind === 'B' && rng.chance(mood.bells)) {
        for (let i = 0; i < 4; i++) events.push({ k: 'bell', t: t0 + (8 + i * 2) * step, m: note(deg + [0, 2, 4, 7][i], 2), v: 0.4 });
      }
    }
    t += 4 * bar;
  });
  return { events: events.sort((a, b) => a.t - b.t), length: t + bar * 0.5 };
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
  /** The upbeat mix is sparser in the mids, so it sits a little louder. */
  private get volume(): number {
    return this.style === 'groove' ? 0.3 : 0.21;
  }
  style: MusicStyle = 'groove';
  private wet: GainNode | null = null;

  private get ctx(): AudioContext | null {
    return sfx.context;
  }

  private ensureGraph(): boolean {
    const ctx = this.ctx;
    if (!ctx) return false;
    if (this.out) return true;
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = this.toneFor(this.theme);
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
    wet.gain.value = this.style === 'groove' ? 0.22 : 0.55;
    this.wet = wet;
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
    if (changed) this.filter!.frequency.setTargetAtTime(this.ducked ? 600 : this.toneFor(id), ctx.currentTime, 1.5);
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

  /** Switch between the upbeat and the calm soundtrack (fades over). */
  setStyle(style: MusicStyle): void {
    if (style === this.style) return;
    this.style = style;
    const ctx = this.ctx;
    if (!ctx || !this.out) return;
    this.wet?.gain.setTargetAtTime(style === 'groove' ? 0.22 : 0.55, ctx.currentTime, 0.5);
    if (this.timer) {
      this.out.gain.setTargetAtTime(0, ctx.currentTime, 0.3);
      this.queue = [];
      this.nextPieceAt = ctx.currentTime + 1.2;
      setTimeout(() => this.applyMix(0.8), 1000);
    }
  }

  private toneFor(id: ThemeId): number {
    return this.style === 'groove' ? GROOVES[id].tone : MOODS[id].tone;
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
    this.filter.frequency.setTargetAtTime(this.ducked ? 600 : this.toneFor(this.theme), t, time / 3);
  }

  private tick(): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    if (!this.queue.length && now >= this.nextPieceAt) {
      this.pieceStart = now + 0.1;
      if (this.style === 'groove') {
        // songs follow each other with just a breath in between
        const piece = composeGroove(GROOVES[this.theme], this.rng);
        this.queue = piece.events;
        this.nextPieceAt = this.pieceStart + piece.length;
      } else {
        const mood = MOODS[this.theme];
        const piece = compose(mood, this.rng);
        this.queue = piece.events;
        this.nextPieceAt = this.pieceStart + piece.length + this.rng.range(mood.rest[0], mood.rest[1]);
      }
    }
    const horizon = now + 0.4;
    while (this.queue.length && this.pieceStart + this.queue[0].t < horizon) {
      const e = this.queue.shift()!;
      const at = Math.max(now, this.pieceStart + e.t);
      switch (e.k) {
        case 'piano':
          this.piano(at, e.m, e.v);
          break;
        case 'pad':
          this.pad(at, e.ms, e.d);
          break;
        case 'bell':
          this.bell(at, e.m, e.v);
          break;
        case 'bass':
          this.bass(at, e.m, e.v, e.d);
          break;
        case 'keys':
          this.keys(at, e.ms, e.v, e.d);
          break;
        case 'lead':
          this.lead(at, e.m, e.v, e.d);
          break;
        case 'kick':
          this.kick(at, e.v);
          break;
        case 'snare':
          this.snare(at, e.v);
          break;
        case 'hat':
          this.hat(at, e.v);
          break;
      }
    }
    // fever: a soft shimmer of high bells on top, no drums
    if (this.fever && now >= this.feverNext) {
      if (this.style === 'groove') {
        const g = GROOVES[this.theme];
        this.bell(now + 0.05, g.roots[0] + 24 + g.scale[this.rng.int(0, 6)], 0.35);
        this.hat(now + 0.05, 0.5);
        this.feverNext = now + this.rng.range(0.14, 0.28);
      } else {
        const mood = MOODS[this.theme];
        const root = mood.roots[0] + 24;
        this.bell(now + 0.05, root + mood.scale[this.rng.int(0, 6)], 0.3);
        this.feverNext = now + this.rng.range(0.25, 0.5);
      }
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

  // ───────────────────────── groove instruments ─────────────────────────

  private env(t: number, peak: number, attack: number, decay: number): GainNode {
    const g = this.ctx!.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    return g;
  }

  private osc(t: number, f: number, type: OscillatorType, dur: number, dest: AudioNode, amp = 1): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = f;
    if (amp === 1) o.connect(dest);
    else {
      const a = ctx.createGain();
      a.gain.value = amp;
      o.connect(a).connect(dest);
    }
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  /** Round, bouncy bass: triangle + sine sub through a low-pass. */
  private bass(t: number, m: number, v: number, d: number): void {
    const ctx = this.ctx!;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 650;
    const g = this.env(t, 0.24 * v, 0.006, Math.max(0.18, d));
    g.connect(lp).connect(this.out!);
    this.osc(t, hz(m), 'triangle', d + 0.3, g);
    this.osc(t, hz(m), 'sine', d + 0.3, g, 0.5);
  }

  /** Electric-piano chord: sine + soft bell partial, quick attack. */
  private keys(t: number, ms: number[], v: number, d: number): void {
    const g = this.env(t, 0.075 * v, 0.006, Math.max(0.2, d));
    g.connect(this.out!);
    for (const m of ms) {
      this.osc(t, hz(m), 'sine', d + 0.3, g);
      this.osc(t, hz(m) * 2, 'sine', d * 0.5 + 0.2, g, 0.22);
    }
  }

  /** Marimba-like pluck for the melody. */
  private lead(t: number, m: number, v: number, d: number): void {
    const decay = Math.max(0.28, Math.min(0.7, d * 2));
    const g = this.env(t, 0.22 * v, 0.004, decay);
    g.connect(this.out!);
    this.osc(t, hz(m), 'sine', decay, g);
    this.osc(t, hz(m) * 4, 'sine', 0.08, g, 0.18);
    this.osc(t, hz(m), 'triangle', decay, g, 0.25);
  }

  private kick(t: number, v: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(115, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    const g = this.env(t, 0.32 * v, 0.003, 0.2);
    o.connect(g).connect(this.out!);
    o.start(t);
    o.stop(t + 0.3);
  }

  private noiseHit(t: number, vol: number, dur: number, type: BiquadFilterType, freq: number, q = 0.8): void {
    const buf = sfx.noiseBuffer;
    if (!buf) return;
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = this.env(t, vol, 0.002, dur);
    src.connect(f).connect(g).connect(this.out!);
    src.start(t, Math.random() * 0.3);
    src.stop(t + dur + 0.05);
  }

  /** Soft snare: filtered noise plus a short body tone (no harsh crack). */
  private snare(t: number, v: number): void {
    this.noiseHit(t, 0.16 * v, 0.13, 'bandpass', 1900);
    const g = this.env(t, 0.08 * v, 0.002, 0.07);
    g.connect(this.out!);
    this.osc(t, 185, 'triangle', 0.1, g);
  }

  private hat(t: number, v: number): void {
    this.noiseHit(t, 0.05 * v, 0.03, 'highpass', 8500, 0.7);
  }
}

export const music = new Music();
