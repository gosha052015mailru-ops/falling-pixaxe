import { B, blockDef } from './blocks';
import {
  BIOMES,
  CORE_REWARD,
  ENCHANTS,
  MAX_TIER,
  PHYS,
  RUN,
  TIERS,
  biomeAt,
  type EnchantId,
} from './config';
import type { RunStats } from './economy';
import { Rng } from './rng';
import { World, blockHp } from './world';

export type ChestLoot = 'coins' | 'gems' | 'dynamite' | 'durability';
export type BreakCause = 'pick' | 'blast';

export type GameEvent =
  | { t: 'hit'; x: number; y: number; id: B; dmg: number; crit: boolean; frac: number; speed: number }
  | { t: 'break'; x: number; y: number; id: B; coins: number; combo: number; cause: BreakCause; crit: boolean }
  | { t: 'bounce'; x: number; y: number; wall: boolean; speed: number }
  | { t: 'explode'; x: number; y: number; r: number; chain: number }
  | { t: 'tierUp'; tier: number; maxed: boolean }
  | { t: 'heal'; amount: number }
  | { t: 'chest'; loot: ChestLoot; amount: number; x: number; y: number }
  | { t: 'furnace' }
  | { t: 'enchant'; id: EnchantId }
  | { t: 'gem'; amount: number; x: number; y: number }
  | { t: 'slime'; x: number; y: number }
  | { t: 'lava'; x: number; y: number }
  | { t: 'milestone'; biome: number; coins: number; gems: number }
  | { t: 'totem' }
  | { t: 'shatter'; x: number; y: number }
  | { t: 'core' }
  | { t: 'nudge'; dir: number }
  | { t: 'dynamite' }
  | { t: 'combo'; n: number }
  | { t: 'fever' }
  | { t: 'revive' }
  | { t: 'stuck' };

export interface RunInit {
  seed: number;
  stats: RunStats;
  /** Best depth before this run (new meters pay more). */
  bestDepth: number;
  /** Biome indices whose milestone was already paid. */
  milestones: number[];
  /** Scripted first run: guaranteed specials and wait for the first tap. */
  tutorial?: boolean;
}

export interface RunResult {
  depth: number;
  oreCoins: number;
  depthCoins: number;
  bonusCoins: number;
  totalCoins: number;
  gems: number;
  blocks: number;
  bestCombo: number;
  tier: number;
  newRecord: boolean;
  newMilestones: number[];
  dynamiteUsed: number;
  totemsUsed: number;
  dynamiteFound: number;
  core: boolean;
  discovered: string[];
  time: number;
  tnt: number;
  chests: number;
  tierUps: number;
  ores: number;
  fevers: number;
}

interface PendingBlast {
  x: number;
  y: number;
  r: number;
  t: number;
  chain: number;
}

export class Run {
  readonly world: World;
  readonly rng: Rng;
  readonly stats: RunStats;

  x: number;
  y: number;
  vx = 0;
  vy = 0;
  angle = 0;
  angVel = 6;

  tier: number;
  maxDur = 0;
  durability = 0;

  nudges: number;
  nudgeTimer = 0;
  dynamite: number;
  totems: number;

  combo = 0;
  comboTimer = 0;
  bestCombo = 0;
  furnaceTimer = 0;
  enchants: Record<EnchantId, number> = { efficiency: 0, fortune: 0, unbreaking: 0, fireproof: 0, explosive: 0, heavy: 0 };

  oreCoins = 0;
  depthCoins = 0;
  bonusCoins = 0;
  gems = 0;
  blocks = 0;
  maxDepth: number;
  time = 0;
  timeScale = 1;
  slowTimer = 0;
  hitstop = 0;
  lavaTimer = 0;
  inLava = false;

  dynamiteUsed = 0;
  totemsUsed = 0;
  dynamiteFound = 0;
  newMilestones: number[] = [];
  discovered = new Set<string>();
  over = false;
  core = false;
  /** Frozen until the player's first tap (tutorial). */
  hold = false;
  feverTimer = 0;
  revives = 0;

  tntCount = 0;
  chestCount = 0;
  tierUps = 0;
  oreCount = 0;
  fevers = 0;
  private bouncesSinceBreak = 0;

  events: GameEvent[] = [];
  private blasts: PendingBlast[] = [];
  private heals = 0;
  private focusCell = '';
  private focus = 0;
  private pickBreaks = 0;

  constructor(readonly init: RunInit) {
    this.stats = init.stats;
    this.rng = new Rng(init.seed);
    this.world = new World(init.seed, init.stats.startDepth, init.stats.luckMult, undefined, init.stats.hpMult);
    this.x = this.world.width / 2;
    this.y = init.stats.startDepth - 3;
    this.vx = this.rng.range(-1.5, 1.5);
    this.maxDepth = init.stats.startDepth;
    this.tier = init.stats.startTier;
    this.maxDur = this.computeMaxDur(this.tier);
    this.durability = this.maxDur;
    this.nudges = init.stats.nudgeCharges;
    this.dynamite = init.stats.dynamite;
    this.totems = init.stats.totems;
    if (init.tutorial) this.setupTutorial();
  }

  /** First run: every key "wow" event happens in the first ~30 m. */
  private setupTutorial(): void {
    const w = this.world;
    const cx = Math.floor(this.x);
    const place: [number, number, B][] = [
      // one guaranteed upgrade (three cells wide so it can't be missed; the run cap allows only one)
      [cx - 1, 8, B.WORKBENCH],
      [cx, 8, B.WORKBENCH],
      [cx + 1, 8, B.WORKBENCH],
      [cx, 16, B.CHEST],
      [cx, 24, B.TNT],
    ];
    // plain dirt above the workbench: the first seconds teach the chop rhythm
    for (let y = 1; y < 8; y++) for (let x = cx - 1; x <= cx + 1; x++) w.set(x, y, B.DIRT);
    for (const [x, y, id] of place) w.set(x, y, id);
    this.hold = true;
  }

  /** Highest tier workbenches can reach in this run. */
  get workbenchCap(): number {
    const st = this.stats.startTier;
    return Math.min(MAX_TIER, st + RUN.workbenchTierCap + Math.floor(st / 3));
  }

  get fever(): boolean {
    return this.feverTimer > 0;
  }

  /** "Second chance": continue a broken run once (rewarded ad). */
  revive(): boolean {
    if (!this.over || this.core || this.durability > 0) return false;
    this.over = false;
    this.revives++;
    this.durability = Math.round(this.maxDur * 0.5);
    this.vy = -8;
    this.slow(0.8, 0.3);
    this.emit({ t: 'revive' });
    return true;
  }

  get depth(): number {
    return Math.max(0, Math.floor(this.y));
  }

  get comboMult(): number {
    return 1 + RUN.comboStep * Math.min(this.combo, RUN.comboCap);
  }

  get runCoins(): number {
    return Math.round(this.oreCoins + this.depthCoins + this.bonusCoins);
  }

  get maxFall(): number {
    return PHYS.maxFall * this.stats.maxFallMult * (1 + 0.3 * this.enchants.heavy);
  }

  get damagePerHit(): number {
    return TIERS[this.tier].dmg * this.stats.powerMult * (1 + 0.4 * this.enchants.efficiency) * (this.fever ? RUN.feverDamage : 1);
  }

  private computeMaxDur(tier: number): number {
    return Math.round(this.stats.maxDurBase * TIERS[tier].dur);
  }

  /** Multiplier for the next heal; each heal makes the following ones weaker. */
  private healFactor(): number {
    return Math.pow(RUN.healDecay, this.heals++);
  }

  private emit(e: GameEvent): void {
    this.events.push(e);
  }

  // ───────────────────────── input ─────────────────────────

  nudge(dir: -1 | 1): boolean {
    if (this.hold) {
      this.hold = false;
      // gentle first push so the scripted workbench right below is never missed
      this.vx = dir * 1;
      this.emit({ t: 'nudge', dir });
      return true;
    }
    if (this.over || this.nudges <= 0) return false;
    this.nudges--;
    this.vx = dir * PHYS.nudgeImpulse + this.vx * 0.3;
    this.angVel += dir * 8;
    this.emit({ t: 'nudge', dir });
    return true;
  }

  useDynamite(): boolean {
    if (this.over || this.hold || this.dynamite <= 0) return false;
    this.dynamite--;
    this.dynamiteUsed++;
    this.emit({ t: 'dynamite' });
    this.explode(this.x, this.y + 0.9, this.stats.blastRadius, 0);
    return true;
  }

  // ───────────────────────── simulation ─────────────────────────

  step(dtReal: number): void {
    if (this.over || this.hold) return;
    if (this.hitstop > 0) {
      this.hitstop -= dtReal;
      return;
    }
    if (this.slowTimer > 0) {
      this.slowTimer -= dtReal;
      if (this.slowTimer <= 0) this.timeScale = 1;
    }
    const dt = Math.min(dtReal, 1 / 20) * this.timeScale;
    this.time += dt;

    // timers
    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) this.combo = 0;
    }
    if (this.furnaceTimer > 0) this.furnaceTimer -= dt;
    if (this.feverTimer > 0) this.feverTimer -= dt;
    if (this.nudges < this.stats.nudgeCharges) {
      this.nudgeTimer += dt;
      if (this.nudgeTimer >= this.stats.nudgeRegen) {
        this.nudgeTimer = 0;
        this.nudges++;
      }
    } else this.nudgeTimer = 0;

    this.updateBlasts(dt);
    if (this.over) return;

    // physics with sub-steps so we never tunnel through a block
    const speed = Math.hypot(this.vx, this.vy) + PHYS.gravity * dt;
    const steps = Math.max(1, Math.ceil((speed * dt) / PHYS.maxStep));
    const h = dt / steps;
    for (let i = 0; i < steps && !this.over; i++) this.substep(h);

    this.angle += this.angVel * dt;
    this.angVel *= Math.exp(-0.8 * dt);

    this.updateLava(dt);
    this.updateDepth();
    this.world.forgetAbove(this.depth - 80);
  }

  private substep(h: number): void {
    this.vy = Math.min(this.vy + PHYS.gravity * h, this.maxFall);
    this.vx *= Math.exp(-PHYS.airDragX * h);
    if (this.inLava) {
      const k = Math.exp(-PHYS.lavaDrag * h);
      this.vx *= k;
      this.vy *= k;
    }
    this.x += this.vx * h;
    this.y += this.vy * h;

    // resolve up to two contacts per sub-step
    for (let pass = 0; pass < 2; pass++) {
      const c = this.findContact();
      if (!c) break;
      this.resolveContact(c.cx, c.cy, c.nx, c.ny, c.pen);
      if (this.over) return;
    }
  }

  private findContact(): { cx: number; cy: number; nx: number; ny: number; pen: number } | null {
    const r = PHYS.radius;
    let best: { cx: number; cy: number; nx: number; ny: number; pen: number } | null = null;
    const x0 = Math.floor(this.x - r);
    const x1 = Math.floor(this.x + r);
    const y0 = Math.floor(this.y - r);
    const y1 = Math.floor(this.y + r);
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const id = this.world.get(cx, cy);
        if (!blockDef(id).solid) continue;
        const px = Math.max(cx, Math.min(this.x, cx + 1));
        const py = Math.max(cy, Math.min(this.y, cy + 1));
        let dx = this.x - px;
        let dy = this.y - py;
        let dist = Math.hypot(dx, dy);
        if (dist >= r) continue;
        let pen: number;
        if (dist < 1e-6) {
          // centre is inside the block: push out along the shortest axis
          const left = this.x - cx;
          const right = cx + 1 - this.x;
          const top = this.y - cy;
          const bottom = cy + 1 - this.y;
          const m = Math.min(left, right, top, bottom);
          if (m === top) [dx, dy] = [0, -1];
          else if (m === bottom) [dx, dy] = [0, 1];
          else if (m === left) [dx, dy] = [-1, 0];
          else [dx, dy] = [1, 0];
          pen = m + r;
          dist = 1;
        } else {
          pen = r - dist;
        }
        if (!best || pen > best.pen) best = { cx, cy, nx: dx / dist, ny: dy / dist, pen };
      }
    }
    return best;
  }

  private resolveContact(cx: number, cy: number, nx: number, ny: number, pen: number): void {
    const vn = -(this.vx * nx + this.vy * ny); // speed into the block
    const wall = this.world.isWall(cx);
    const id = this.world.get(cx, cy);
    const def = blockDef(id);

    if (vn <= 0.05) {
      this.x += nx * pen;
      this.y += ny * pen;
      return;
    }

    if (wall) {
      this.x += nx * pen;
      this.y += ny * pen;
      this.reflect(nx, ny, vn, 0.6);
      this.emit({ t: 'bounce', x: this.x, y: this.y, wall: true, speed: vn });
      return;
    }

    if (def.special === 'slime') {
      this.x += nx * pen;
      this.y += ny * pen;
      this.reflect(nx, ny, vn, 1);
      if (ny < -0.5) this.vy = Math.min(this.vy, -16);
      this.vx += this.rng.sign() * this.rng.range(2, 5);
      this.emit({ t: 'slime', x: cx + 0.5, y: cy + 0.5 });
      if (this.world.damage(cx, cy, 1)) this.breakBlock(cx, cy, 'pick', false);
      return;
    }

    // Special blocks open on any touch.
    if (def.special) {
      this.breakBlock(cx, cy, 'pick', false);
      this.vx *= 0.9;
      this.vy *= 0.9;
      return;
    }

    const impact = Math.max(PHYS.impactMin, Math.min(PHYS.impactMax, PHYS.impactMin + 0.45 * (vn / PHYS.impactRef)));
    const critChance = this.stats.critChance + TIERS[this.tier].critBonus;
    const crit = this.rng.chance(critChance);
    const cell = `${cx},${cy}`;
    this.focus = cell === this.focusCell ? Math.min(PHYS.focusMax, this.focus + 1) : 0;
    this.focusCell = cell;
    const focusMult = 1 + PHYS.focusStep * this.focus;
    const dmg = this.damagePerHit * impact * focusMult * (crit ? PHYS.critMult : 1);
    const before = this.world.hpAt(cx, cy);

    this.spendDurability(def.durCost);

    if (Number.isFinite(before) && this.world.damage(cx, cy, dmg)) {
      const keep = dmg >= before * 2 ? PHYS.pierceKeep : PHYS.breakKeep;
      this.vx *= keep;
      this.vy *= keep;
      this.breakBlock(cx, cy, 'pick', crit);
    } else {
      this.x += nx * pen;
      this.y += ny * pen;
      const frac = Number.isFinite(before) ? Math.max(0, this.world.hpAt(cx, cy) / blockHp(id, cy, this.world.hpMult)) : 1;
      this.emit({ t: 'hit', x: cx, y: cy, id, dmg, crit, frac, speed: vn });
      if (++this.bouncesSinceBreak === 3) this.emit({ t: 'stuck' });
      this.reflect(nx, ny, vn, PHYS.restitution);
      if (ny < -0.5) {
        this.vy = Math.min(this.vy, -PHYS.minBounce);
        this.vx += this.rng.sign() * this.rng.range(PHYS.sideKickMin, PHYS.sideKickMax);
      }
      this.angVel = this.rng.sign() * this.rng.range(6, 14);
    }
    if (this.durability <= 0) this.die();
  }

  private reflect(nx: number, ny: number, vn: number, e: number): void {
    // v' = v + (1 + e) * vn * n   (vn is the speed *into* the surface)
    this.vx += (1 + e) * vn * nx;
    this.vy += (1 + e) * vn * ny;
  }

  private spendDurability(cost: number): void {
    if (cost <= 0) return;
    const save = Math.min(0.75, 0.25 * this.enchants.unbreaking);
    if (save > 0 && this.rng.chance(save)) return;
    this.durability -= cost;
  }

  private die(): void {
    if (this.over) return;
    if (this.totems > 0) {
      this.totems--;
      this.totemsUsed++;
      this.durability = Math.round(this.maxDur * RUN.totemHeal);
      this.vy = -10;
      this.slow(0.8, 0.3);
      this.emit({ t: 'totem' });
      return;
    }
    this.durability = 0;
    this.over = true;
    this.emit({ t: 'shatter', x: this.x, y: this.y });
  }

  private slow(time: number, scale: number): void {
    this.slowTimer = Math.max(this.slowTimer, time);
    this.timeScale = Math.min(this.timeScale, scale);
  }

  // ───────────────────────── blocks ─────────────────────────

  blockValue(id: B, y: number): number {
    const def = blockDef(id);
    let v = def.value * (1 + Math.max(0, y) / RUN.depthValueDiv);
    v *= this.stats.coinMult * (1 + TIERS[this.tier].coinBonus);
    if (def.ore) {
      if (this.furnaceTimer > 0) v *= 2;
      v *= 1 + 0.5 * this.enchants.fortune;
    }
    if (this.fever) v *= RUN.feverCoins;
    return v;
  }

  private breakBlock(x: number, y: number, cause: BreakCause, crit: boolean): void {
    const id = this.world.get(x, y);
    const def = blockDef(id);
    if (id === B.AIR || id === B.LAVA) return;
    this.world.set(x, y, B.AIR);
    this.discovered.add(def.key);
    this.blocks++;

    this.combo++;
    this.comboTimer = RUN.comboWindow;
    if (this.combo > this.bestCombo) this.bestCombo = this.combo;
    if (this.combo % 10 === 0) this.emit({ t: 'combo', n: this.combo });
    if (this.combo % RUN.feverCombo === 0) {
      this.feverTimer = RUN.feverTime;
      this.fevers++;
      this.emit({ t: 'fever' });
    }
    this.bouncesSinceBreak = 0;
    if (def.ore) this.oreCount++;

    const coins = this.blockValue(id, y) * this.comboMult;
    this.oreCoins += coins;
    this.emit({ t: 'break', x, y, id, coins, combo: this.combo, cause, crit });

    if (def.ore && def.value >= 100) this.hitstop = Math.max(this.hitstop, 0.05);

    if (def.special) this.triggerSpecial(def.special, x, y, cause);

    if (cause === 'pick') {
      this.pickBreaks++;
      if (this.enchants.explosive > 0 && this.pickBreaks % RUN.explosiveEvery === 0) {
        this.queueBlast(x + 0.5, y + 0.5, 1.5 + 0.3 * this.enchants.explosive, 0.05, 0);
      }
    }
  }

  private triggerSpecial(kind: NonNullable<ReturnType<typeof blockDef>['special']>, x: number, y: number, cause: BreakCause): void {
    switch (kind) {
      case 'workbench': {
        if (this.tier < this.workbenchCap) {
          const oldMax = this.maxDur;
          this.tier++;
          this.maxDur = this.computeMaxDur(this.tier);
          const heal = (this.maxDur - oldMax) + this.maxDur * RUN.workbenchHeal * this.healFactor();
          this.durability = Math.min(this.maxDur, this.durability + heal);
          this.tierUps++;
          this.emit({ t: 'tierUp', tier: this.tier, maxed: false });
          this.slow(0.6, 0.3);
          this.hitstop = 0.08;
        } else {
          // cap reached for this run: a quiet small bonus, no banner spam
          this.bonusCoins += this.blockValue(B.STONE, y) * 8;
        }
        break;
      }
      case 'anvil': {
        const amount = Math.min(this.maxDur - this.durability, Math.round(this.maxDur * RUN.anvilHeal * this.healFactor()));
        this.durability += amount;
        this.emit({ t: 'heal', amount });
        break;
      }
      case 'tnt':
        this.tntCount++;
        this.queueBlast(x + 0.5, y + 0.5, RUN.tntRadius, cause === 'blast' ? RUN.tntChainFuse : RUN.tntFuse, 0);
        break;
      case 'chest':
        this.chestCount++;
        this.openChest(x, y);
        break;
      case 'furnace':
        this.furnaceTimer = RUN.furnaceTime;
        this.emit({ t: 'furnace' });
        break;
      case 'enchant': {
        const pool = ENCHANTS.filter((e) => !(e === 'fireproof' && (this.enchants.fireproof > 0 || TIERS[this.tier].fireproof)));
        const id = this.rng.pick(pool);
        this.enchants[id]++;
        this.slow(0.4, 0.4);
        this.emit({ t: 'enchant', id });
        break;
      }
      case 'luckgem':
        this.gems++;
        this.emit({ t: 'gem', amount: 1, x, y });
        break;
      case 'core':
        this.core = true;
        this.bonusCoins += CORE_REWARD.coins;
        this.gems += CORE_REWARD.gems;
        this.over = true;
        this.emit({ t: 'core' });
        break;
      case 'slime':
        break;
    }
  }

  private openChest(x: number, y: number): void {
    const biome = biomeAt(y);
    const avgOre =
      biome.ores.reduce((s, o) => s + blockDef(o.item).value * o.w, 0) / biome.ores.reduce((s, o) => s + o.w, 0);
    const roll = this.rng.next();
    let loot: ChestLoot;
    let amount: number;
    if (roll < 0.5) {
      loot = 'coins';
      amount = Math.round(avgOre * this.rng.range(8, 20) * this.stats.coinMult * (1 + y / RUN.depthValueDiv));
      this.bonusCoins += amount;
    } else if (roll < 0.7) {
      loot = 'gems';
      amount = this.rng.int(1, 3);
      this.gems += amount;
    } else if (roll < 0.85) {
      loot = 'dynamite';
      amount = 1;
      this.dynamite++;
      this.dynamiteFound++;
    } else {
      loot = 'durability';
      amount = Math.min(this.maxDur - this.durability, Math.round(this.maxDur * 0.15 * this.healFactor()));
      this.durability += amount;
    }
    this.emit({ t: 'chest', loot, amount, x, y });
  }

  // ───────────────────────── explosions ─────────────────────────

  private queueBlast(x: number, y: number, r: number, fuse: number, chain: number): void {
    this.blasts.push({ x, y, r, t: fuse, chain });
  }

  private updateBlasts(dt: number): void {
    if (this.blasts.length === 0) return;
    const ready: PendingBlast[] = [];
    this.blasts = this.blasts.filter((b) => {
      b.t -= dt;
      if (b.t <= 0) {
        ready.push(b);
        return false;
      }
      return true;
    });
    for (const b of ready) this.explode(b.x, b.y, b.r, b.chain);
  }

  private explode(ex: number, ey: number, r: number, chain: number): void {
    this.emit({ t: 'explode', x: ex, y: ey, r, chain });
    const x0 = Math.floor(ex - r);
    const x1 = Math.floor(ex + r);
    const y0 = Math.floor(ey - r);
    const y1 = Math.floor(ey + r);
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        if (this.world.isWall(cx)) continue;
        if (Math.hypot(cx + 0.5 - ex, cy + 0.5 - ey) > r) continue;
        const def = blockDef(this.world.get(cx, cy));
        if (!def.solid || !def.blastable) continue;
        if (def.special === 'tnt') {
          this.world.set(cx, cy, B.AIR);
          this.blocks++;
          this.tntCount++;
          this.queueBlast(cx + 0.5, cy + 0.5, RUN.tntRadius, RUN.tntChainFuse, chain + 1);
          continue;
        }
        this.breakBlock(cx, cy, 'blast', false);
      }
    }
    // push the pickaxe away from the blast
    const dx = this.x - ex;
    const dy = this.y - ey;
    const d = Math.hypot(dx, dy);
    const reach = r * 1.6;
    if (d < reach) {
      const k = 9 * (1 - d / reach);
      const nx = d > 0.1 ? dx / d : this.rng.range(-0.5, 0.5);
      const ny = d > 0.1 ? dy / d : -1;
      this.vx += nx * k;
      this.vy += ny * k;
      // a blast nudges the pickaxe, it must never fling it across the screen
      this.vx = Math.max(-7, Math.min(7, this.vx));
      this.vy = Math.max(-9, this.vy);
      this.angVel += this.rng.sign() * 15;
    }
    this.hitstop = Math.max(this.hitstop, 0.04);
  }

  // ───────────────────────── environment ─────────────────────────

  private updateLava(dt: number): void {
    const id = this.world.get(Math.floor(this.x), Math.floor(this.y));
    this.inLava = id === B.LAVA;
    if (!this.inLava) {
      this.lavaTimer = 0;
      return;
    }
    if (TIERS[this.tier].fireproof || this.enchants.fireproof > 0) return;
    this.lavaTimer += dt;
    if (this.lavaTimer >= RUN.lavaTick) {
      this.lavaTimer = 0;
      this.durability -= 1;
      this.emit({ t: 'lava', x: this.x, y: this.y });
      if (this.durability <= 0) this.die();
    }
  }

  private updateDepth(): void {
    const d = this.depth;
    while (this.maxDepth < d) {
      this.maxDepth++;
      this.depthCoins += this.maxDepth > this.init.bestDepth ? RUN.depthCoinNew : RUN.depthCoinOld;
      for (let i = 1; i < BIOMES.length; i++) {
        const b = BIOMES[i];
        if (this.maxDepth === b.from && !this.init.milestones.includes(i) && !this.newMilestones.includes(i)) {
          this.newMilestones.push(i);
          const coins = Math.round(b.milestoneCoins * this.stats.coinMult);
          this.bonusCoins += coins;
          this.gems += b.milestoneGems;
          this.emit({ t: 'milestone', biome: i, coins, gems: b.milestoneGems });
        }
      }
    }
  }

  result(): RunResult {
    const totalCoins = this.runCoins;
    return {
      depth: this.maxDepth,
      oreCoins: Math.round(this.oreCoins),
      depthCoins: Math.round(this.depthCoins),
      bonusCoins: Math.round(this.bonusCoins),
      totalCoins,
      gems: this.gems,
      blocks: this.blocks,
      bestCombo: this.bestCombo,
      tier: this.tier,
      newRecord: this.maxDepth > this.init.bestDepth,
      newMilestones: [...this.newMilestones],
      dynamiteUsed: this.dynamiteUsed,
      totemsUsed: this.totemsUsed,
      dynamiteFound: this.dynamiteFound,
      core: this.core,
      discovered: [...this.discovered],
      time: this.time,
      tnt: this.tntCount,
      chests: this.chestCount,
      tierUps: this.tierUps,
      ores: this.oreCount,
      fevers: this.fevers,
    };
  }

  drainEvents(): GameEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }
}
