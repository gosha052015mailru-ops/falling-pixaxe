/**
 * Procedural chiptune music: no audio files, no licensing, tiny build.
 * A look-ahead scheduler (setInterval + AudioContext clock) queues notes
 * ~120 ms ahead, so timing stays tight even when the main thread hiccups.
 * Each theme is generated from a seed: chords, bass, arpeggio, lead, drums.
 */
import { Rng } from '../game/rng';
import { sfx } from './sfx';

interface Theme {
  bpm: number;
  /** MIDI note of the tonic. */
  root: number;
  scale: number[];
  /** Scale degrees, one chord per bar (4 bars loop). */
  chords: number[];
  lead: OscillatorType;
  drums: 0 | 1 | 2;
  /** Master low-pass cutoff — darker biomes sound murkier. */
  tone: number;
  seed: number;
}

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MINOR = [0, 2, 3, 5, 7, 8, 10];
const DORIAN = [0, 2, 3, 5, 7, 9, 10];
const PHRYGIAN = [0, 1, 3, 5, 7, 8, 10];
const LYDIAN = [0, 2, 4, 6, 7, 9, 11];

export type ThemeId = 'menu' | 'meadow' | 'caves' | 'depths' | 'lava' | 'grotto' | 'abyss';

const THEMES: Record<ThemeId, Theme> = {
  menu: { bpm: 96, root: 60, scale: MAJOR, chords: [0, 5, 3, 4], lead: 'triangle', drums: 1, tone: 5200, seed: 11 },
  meadow: { bpm: 116, root: 62, scale: MAJOR, chords: [0, 3, 4, 0], lead: 'square', drums: 2, tone: 6500, seed: 21 },
  caves: { bpm: 120, root: 57, scale: MINOR, chords: [0, 5, 2, 6], lead: 'square', drums: 2, tone: 5200, seed: 31 },
  depths: { bpm: 124, root: 62, scale: DORIAN, chords: [0, 3, 0, 6], lead: 'sawtooth', drums: 2, tone: 3800, seed: 41 },
  lava: { bpm: 134, root: 52, scale: PHRYGIAN, chords: [0, 1, 0, 6], lead: 'sawtooth', drums: 2, tone: 3400, seed: 51 },
  grotto: { bpm: 108, root: 65, scale: LYDIAN, chords: [0, 1, 4, 3], lead: 'triangle', drums: 1, tone: 7000, seed: 61 },
  abyss: { bpm: 126, root: 59, scale: MINOR, chords: [0, 5, 6, 4], lead: 'square', drums: 2, tone: 2600, seed: 71 },
};

export const BIOME_THEMES: ThemeId[] = ['meadow', 'caves', 'depths', 'lava', 'grotto', 'abyss'];

const STEPS = 16;
const BARS = 4;
const LOOKAHEAD = 0.12;

interface Pattern {
  lead: (number | null)[];
  bassAlt: boolean[];
}

function midiHz(m: number): number {
  return 440 * Math.pow(2, (m - 69) / 12);
}

function makePattern(th: Theme): Pattern {
  const rng = new Rng(th.seed);
  const lead: (number | null)[] = [];
  let deg = 4;
  // a 2-bar motif repeated with a variation → catchy but not monotonous
  const motif: (number | null)[] = [];
  for (let i = 0; i < STEPS * 2; i++) {
    const strong = i % 4 === 0;
    if (rng.chance(strong ? 0.75 : 0.35)) {
      deg = Math.max(0, Math.min(11, deg + rng.pick([-2, -1, -1, 1, 1, 2, 0])));
      motif.push(deg);
    } else motif.push(null);
  }
  for (let i = 0; i < STEPS * BARS; i++) {
    const m = motif[i % (STEPS * 2)];
    lead.push(i >= STEPS * 3 && m !== null && i % 8 === 6 ? m + 2 : m);
  }
  const bassAlt = Array.from({ length: STEPS }, (_, i) => i % 8 === 6 && rng.chance(0.6));
  return { lead, bassAlt };
}

export class Music {
  enabled = true;
  private theme: ThemeId = 'menu';
  private pending: ThemeId | null = null;
  private pattern: Pattern = makePattern(THEMES.menu);
  private step = 0;
  private nextTime = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private out: GainNode | null = null;
  private filter: BiquadFilterNode | null = null;
  private fever = false;
  private ducked = false;
  private readonly volume = 0.2;

  private get ctx(): AudioContext | null {
    return sfx.context;
  }

  private ensureGraph(): boolean {
    const ctx = this.ctx;
    if (!ctx) return false;
    if (!this.out) {
      this.filter = ctx.createBiquadFilter();
      this.filter.type = 'lowpass';
      this.filter.frequency.value = THEMES[this.theme].tone;
      this.out = ctx.createGain();
      this.out.gain.value = 0;
      this.out.connect(this.filter).connect(ctx.destination);
    }
    return true;
  }

  /** Start (or switch to) a theme; switches land on the next bar line. */
  play(id: ThemeId): void {
    if (!this.enabled || !this.ensureGraph()) {
      this.theme = id;
      return;
    }
    if (this.timer && id === this.theme && !this.pending) return;
    if (this.timer) {
      this.pending = id;
      return;
    }
    this.theme = id;
    this.pattern = makePattern(THEMES[id]);
    this.step = 0;
    this.nextTime = this.ctx!.currentTime + 0.05;
    this.applyMix(0.8);
    this.timer = setInterval(() => this.schedule(), 25);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.pending = null;
    if (this.out && this.ctx) this.out.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1);
  }

  setEnabled(on: boolean, current: ThemeId): void {
    this.enabled = on;
    if (on) this.play(current);
    else this.stop();
  }

  setFever(on: boolean): void {
    this.fever = on;
  }

  /** Muffled and quieter on pause / modals. */
  duck(on: boolean): void {
    if (this.ducked === on) return;
    this.ducked = on;
    this.applyMix(0.25);
  }

  private applyMix(time: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.out || !this.filter) return;
    const t = ctx.currentTime;
    this.out.gain.setTargetAtTime(this.enabled ? this.volume * (this.ducked ? 0.45 : 1) : 0, t, time / 3);
    this.filter.frequency.setTargetAtTime(this.ducked ? 700 : THEMES[this.theme].tone, t, time / 3);
  }

  private schedule(): void {
    const ctx = this.ctx;
    if (!ctx || !this.out) return;
    if (ctx.state !== 'running') {
      this.nextTime = ctx.currentTime + 0.05;
      return;
    }
    const th = THEMES[this.theme];
    const stepDur = 60 / th.bpm / 4;
    while (this.nextTime < ctx.currentTime + LOOKAHEAD) {
      if (this.pending && this.step % STEPS === 0) {
        this.theme = this.pending;
        this.pending = null;
        this.pattern = makePattern(THEMES[this.theme]);
        this.applyMix(1.5);
        return this.schedule();
      }
      this.playStep(this.step, this.nextTime, th, stepDur);
      this.step = (this.step + 1) % (STEPS * BARS);
      this.nextTime += stepDur;
    }
  }

  private degree(th: Theme, deg: number, octave: number): number {
    const n = th.scale.length;
    const o = Math.floor(deg / n);
    return th.root + octave * 12 + o * 12 + th.scale[((deg % n) + n) % n];
  }

  private playStep(step: number, t: number, th: Theme, sd: number): void {
    const bar = Math.floor(step / STEPS);
    const s = step % STEPS;
    const chord = th.chords[bar];

    // bass: root on quarters, fifth on some offbeats
    if (s % 4 === 0) this.voice(t, this.degree(th, chord, -2), sd * 3, 'triangle', 0.55);
    else if (this.pattern.bassAlt[s]) this.voice(t, this.degree(th, chord + 4, -2), sd * 1.5, 'triangle', 0.4);

    // arpeggio on 8ths (16ths during fever)
    if (s % 2 === 0 || this.fever) {
      const tones = [0, 2, 4, 7];
      const idx = this.fever ? s % 4 : (s / 2) % 4;
      this.voice(t, this.degree(th, chord + tones[idx], this.fever ? 1 : 0), sd * 0.9, 'square', this.fever ? 0.12 : 0.09);
    }

    // lead melody
    const ld = this.pattern.lead[step];
    if (ld !== null && ld !== undefined) this.voice(t, this.degree(th, ld, 0), sd * 1.8, th.lead, 0.16);

    // drums
    if (th.drums >= 1) {
      if (s === 0 || s === 8 || (th.drums === 2 && s === 10)) this.kick(t);
      if (s === 4 || s === 12) this.snare(t, th.drums === 2 ? 0.35 : 0.18);
    }
    if (th.drums === 2 || this.fever) {
      if (s % 2 === 0) this.hat(t, s % 4 === 2 ? 0.12 : 0.07);
      if (this.fever && s % 2 === 1) this.hat(t, 0.05);
    }
  }

  private voice(t: number, midi: number, dur: number, type: OscillatorType, vol: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(midiHz(midi), t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(vol * 0.5, t + dur * 0.4);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.out!);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private kick(t: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.12);
    g.gain.setValueAtTime(0.9, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    o.connect(g).connect(this.out!);
    o.start(t);
    o.stop(t + 0.2);
  }

  private noiseHit(t: number, vol: number, dur: number, type: BiquadFilterType, freq: number): void {
    const ctx = this.ctx!;
    const buf = sfx.noiseBuffer;
    if (!buf) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(this.out!);
    src.start(t, Math.random() * 0.3);
    src.stop(t + dur + 0.02);
  }

  private snare(t: number, vol: number): void {
    this.noiseHit(t, vol, 0.14, 'bandpass', 1800);
  }

  private hat(t: number, vol: number): void {
    this.noiseHit(t, vol, 0.04, 'highpass', 7000);
  }
}

export const music = new Music();
