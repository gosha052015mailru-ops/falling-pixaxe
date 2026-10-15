import { B, blockDef } from './blocks';
import {
  BIOMES,
  CAMPAIGN_DEPTH,
  RUN,
  SPECIAL_BASE,
  SPECIAL_BLOCK,
  WORLD_W,
  biomeIndex,
  type SpecialSpawn,
} from './config';
import { Rng, valueNoise } from './rng';

/** Effective HP of a block at a depth. Special blocks are never scaled. */
export function blockHp(id: B, y: number): number {
  const def = blockDef(id);
  if (def.special || !Number.isFinite(def.hp)) return def.hp;
  return def.hp * Math.pow(1 + Math.max(0, y) / RUN.hpDepthDiv, RUN.hpDepthPow);
}

const SPECIAL_KEYS = Object.keys(SPECIAL_BASE) as SpecialSpawn[];

/**
 * Vertical mine shaft, WORLD_W cells wide. Rows are generated lazily and
 * deterministically (sequentially, because veins look at the previous row).
 */
export class World {
  readonly width = WORLD_W;
  private rows = new Map<number, Uint8Array>();
  private hp = new Map<number, Float32Array>();
  private generatedTo: number;
  private rng: Rng;

  constructor(
    readonly seed: number,
    readonly startDepth = 0,
    readonly luckMult = 1,
    readonly endDepth = CAMPAIGN_DEPTH,
  ) {
    this.rng = new Rng(seed ^ 0x9e3779b9);
    this.generatedTo = startDepth - 1;
  }

  /** Block id at cell. Outside the shaft → bedrock wall. */
  get(x: number, y: number): B {
    if (x < 0 || x >= this.width) return B.BEDROCK;
    if (y < this.startDepth) return B.AIR;
    return this.row(y)[x];
  }

  isWall(x: number): boolean {
    return x < 0 || x >= this.width;
  }

  hpAt(x: number, y: number): number {
    if (this.isWall(x) || y < this.startDepth) return Infinity;
    this.row(y);
    return this.hp.get(y)![x];
  }

  /** Apply damage, returns true if the block should break. */
  damage(x: number, y: number, amount: number): boolean {
    if (this.isWall(x) || y < this.startDepth) return false;
    const h = this.hp.get(y) ?? (this.row(y), this.hp.get(y)!);
    h[x] -= amount;
    return h[x] <= 0;
  }

  set(x: number, y: number, id: B): void {
    if (this.isWall(x) || y < this.startDepth) return;
    this.row(y)[x] = id;
    this.hp.get(y)![x] = blockHp(id, y);
  }

  /** Drop rows far above the camera to cap memory in long runs. */
  forgetAbove(y: number): void {
    for (const k of this.rows.keys()) {
      if (k < y) {
        this.rows.delete(k);
        this.hp.delete(k);
      }
    }
  }

  private row(y: number): Uint8Array {
    let r = this.rows.get(y);
    if (r) return r;
    if (y <= this.generatedTo) {
      // Forgotten row: treat as cleared air (it is far above the action).
      r = new Uint8Array(this.width);
      this.rows.set(y, r);
      this.hp.set(y, new Float32Array(this.width));
      return r;
    }
    while (this.generatedTo < y) this.generateRow(++this.generatedTo);
    return this.rows.get(y)!;
  }

  private generateRow(y: number): void {
    const row = new Uint8Array(this.width);
    const hp = new Float32Array(this.width);
    const rng = this.rng;

    if (y === this.endDepth) {
      row.fill(B.CORE);
    } else if (y > this.endDepth) {
      row.fill(B.BEDROCK);
    } else {
      const bi = biomeIndex(y);
      const biome = BIOMES[bi];
      const prevBiome = BIOMES[Math.max(0, bi - 1)];
      const above = this.rows.get(y - 1);
      const rel = y - this.startDepth;
      let bedrockInRow = 0;

      for (let x = 0; x < this.width; x++) {
        // Blend base blocks across a biome boundary.
        const blend = y - biome.from < 4 && rng.chance((4 - (y - biome.from)) / 5);
        const src = blend ? prevBiome : biome;
        let id: B = rng.weighted(src.base);

        if (y === 0) id = B.GRASS;

        // Caves: two octaves of value noise. No caves in the first rows of a run.
        const n =
          valueNoise(x * 0.35, y * 0.22, this.seed) * 0.65 +
          valueNoise(x * 0.8, y * 0.6, this.seed + 7) * 0.35;
        const cave = rel > 3 && n > biome.cave;

        if (cave) {
          id = B.AIR;
          if (biome.lavaInCaves && valueNoise(x * 0.5, y * 0.4, this.seed + 99) < biome.lavaInCaves) {
            id = B.LAVA;
          }
        } else if (rel > 2) {
          let placed = false;
          for (const k of SPECIAL_KEYS) {
            const mult = biome.special[k] ?? (k === 'slime' ? 0 : 1);
            const p = SPECIAL_BASE[k] * mult * (k === 'tnt' || k === 'slime' ? 1 : this.luckMult);
            if (p > 0 && rng.chance(p)) {
              id = SPECIAL_BLOCK[k];
              placed = true;
              break;
            }
          }
          if (!placed) {
            const aboveId = above?.[x];
            const leftId = x > 0 ? row[x - 1] : undefined;
            const veinSrc = [aboveId, leftId].find((v) => v !== undefined && blockDef(v).ore);
            if (veinSrc !== undefined && rng.chance(0.3)) {
              id = veinSrc;
            } else if (rng.chance(biome.oreChance)) {
              id = rng.weighted(biome.ores);
            } else if (biome.bedrockChance && bedrockInRow < 3 && rng.chance(biome.bedrockChance)) {
              id = B.BEDROCK;
              bedrockInRow++;
            }
          }
        }
        row[x] = id;
        hp[x] = blockHp(id, y);
      }
    }
    this.rows.set(y, row);
    this.hp.set(y, hp);
  }
}
