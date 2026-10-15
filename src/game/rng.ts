/** Deterministic PRNG (mulberry32). Same seed → same mine. */
export class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0;
  }
  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }
  int(min: number, maxInclusive: number): number {
    return Math.floor(this.range(min, maxInclusive + 1));
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  sign(): number {
    return this.next() < 0.5 ? -1 : 1;
  }
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }
  weighted<T>(items: readonly { item: T; w: number }[]): T {
    let total = 0;
    for (const it of items) total += it.w;
    let r = this.next() * total;
    for (const it of items) {
      r -= it.w;
      if (r <= 0) return it.item;
    }
    return items[items.length - 1].item;
  }
}

/** Integer hash → [0,1). Stateless, used for noise lattice. */
export function hash2(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/** 2D value noise in [0,1). */
export function valueNoise(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = smooth(x - x0);
  const fy = smooth(y - y0);
  const a = hash2(x0, y0, seed);
  const b = hash2(x0 + 1, y0, seed);
  const c = hash2(x0, y0 + 1, seed);
  const d = hash2(x0 + 1, y0 + 1, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
