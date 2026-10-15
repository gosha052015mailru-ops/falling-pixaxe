import { B, blockDef } from './blocks';
import {
  BOOST_FX,
  BOOSTS,
  type BoostId,
  CAMPAIGN_DEPTH,
  MINE_EVENTS,
  type MineEventId,
  ENCHANTS,
  MAX_TIER,
  PHYS,
  RIFT,
  RUN,
  RUNES,
  TIERS,
  WORLDS,
  biomeAt,
  biomesOf,
  type EnchantId,
  type RuneId,
} from './config';
import type { RunStats } from './economy';
import { Rng } from './rng';
import { World } from './world';

export type ChestLoot = 'coins' | 'gems' | 'dynamite' | 'durability';
export type BreakCause = 'pick' | 'blast' | 'twin' | 'magnet';

/** A ghost pickaxe split off by the Twin power-up: mines on its own, never wears. */
export interface Twin {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  life: number;
}

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
  | { t: 'dash'; dir: number; power: number; blocks: number }
  | { t: 'dashEnd'; broken: number }
  | { t: 'dynamite' }
  | { t: 'combo'; n: number }
  | { t: 'fever' }
  | { t: 'revive' }
  | { t: 'stuck' }
  | { t: 'event'; id: MineEventId }
  | { t: 'boost'; id: BoostId; x: number; y: number }
  | { t: 'teleport'; x0: number; y0: number; x: number; y: number; dist: number }
  | { t: 'boostEnd'; id: BoostId }
  | { t: 'twinPoof'; x: number; y: number }
  | { t: 'rift'; x: number; y: number }
  | { t: 'rune'; id: RuneId; x: number; y: number }
  | { t: 'magnet'; x0: number; y0: number; x: number; y: number }
  | { t: 'skid'; x: number; y: number; dir: number };

export interface RunInit {
  seed: number;
  stats: RunStats;
  /** Best depth before this run (new meters pay more). */
  bestDepth: number;
  /** Biome indices whose milestone was already paid. */
  milestones: number[];
  /** Scripted first run: guaranteed specials and wait for the first tap. */
  tutorial?: boolean;
  /** Average blocks per mine event (0/undefined = mine events still locked). */
  eventGoal?: number;
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
  events: number;
  /** Mission metrics. */
  dashes: number;
  dashBlocks: number;
  bestDash: number;
  heals: number;
  enchantsGot: number;
  slimes: number;
  crits: number;
  rifts: number;
  runes: number;
  oreCounts: Record<string, number>;
  boostsUsed: Partial<Record<BoostId, number>>;
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
  dashes = 0;
  dashBlocks = 0;
  bestDash = 0;
  healCount = 0;
  enchantsGot = 0;
  slimes = 0;
  crits = 0;
  rifts = 0;
  runes = 0;
  oreCounts: Record<string, number> = {};

  /** Power-ups brought into this run (dynamite lives in `dynamite`). */
  boosts: Partial<Record<BoostId, number>> = {};
  boostsUsed: Partial<Record<BoostId, number>> = {};
  giantTimer = 0;
  shieldTimer = 0;
  twinTimer = 0;
  twins: Twin[] = [];
  magnetTimer = 0;
  meteorTimer = 0;
  /** Rune of Might: extra damage while > 0. */
  mightTimer = 0;
  private magnetTick = 0;
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
    this.world = new World(init.seed, init.stats.startDepth, init.stats.luckMult, undefined, init.tutorial ? 1 : init.stats.hpMult, init.stats.worldWidth, init.stats.world ?? 0);
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
    this.boosts = { ...(init.stats.boosts ?? {}) };
    if (init.tutorial) this.setupTutorial();
    this.eventGoal = this.rollEventGoal();
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
      // repair right after: teaches the anvil and stretches the 27-durability demo to ~15–20 s
      [cx - 1, 11, B.ANVIL],
      [cx, 11, B.ANVIL],
      [cx + 1, 11, B.ANVIL],
      [cx, 14, B.CHEST],
      [cx, 18, B.TNT],
      [cx - 1, 19, B.TNT],
      [cx + 1, 19, B.TNT],
    ];
    // soft dirt column through all the demo events, so every new player sees the same short show
    for (let y = 1; y < 22; y++) for (let x = cx - 2; x <= cx + 2; x++) w.set(x, y, B.DIRT);
    for (const [x, y, id] of place) w.set(x, y, id);
    this.hold = true;
  }

  /** Highest tier workbenches can reach in this run. */
  get workbenchCap(): number {
    const st = this.stats.startTier;
    const cap = Math.min(this.stats.maxTier ?? MAX_TIER, MAX_TIER);
    // past the star pickaxe the new tiers are forged: a workbench gives at most one step
    const bonus = st >= WORLDS[0].maxTier ? RUN.workbenchTierCap : RUN.workbenchTierCap + Math.floor(st / 3);
    return Math.max(st, Math.min(cap, st + bonus));
  }

  /** World index of this run. */
  get worldIdx(): number {
    return this.stats.world ?? 0;
  }

  // ───────────────────────── mine events ─────────────────────────

  /** Blocks needed for the next event (0 = events locked). */
  eventGoal = 0;
  eventProgress = 0;
  eventsFired = 0;
  goldTimer = 0;
  superTimer = 0;

  private rollEventGoal(): number {
    const base = this.init.eventGoal ?? 0;
    return base > 0 ? Math.max(MINE_EVENTS.goalMin, Math.round(base * this.rng.range(0.75, 1.25))) : 0;
  }

  private fireEvent(x: number, y: number): void {
    this.eventProgress = 0;
    this.eventGoal = this.rollEventGoal();
    this.eventsFired++;
    const id = this.rng.weighted((Object.keys(MINE_EVENTS.weights) as MineEventId[]).map((item) => ({ item, w: MINE_EVENTS.weights[item] })));
    const px = Math.floor(this.x);
    const py = Math.max(y, Math.floor(this.y));
    const w = this.world;
    const solidHere = (cx: number, cy: number) => {
      const d = blockDef(w.get(cx, cy));
      return !w.isWall(cx) && d.solid && !d.special && Number.isFinite(d.hp);
    };
    switch (id) {
      case 'goldrush':
        this.goldTimer = MINE_EVENTS.goldTime;
        break;
      case 'superpick':
        this.superTimer = MINE_EVENTS.superTime;
        break;
      case 'oreVein': {
        const biome = biomeAt(py + 3, this.worldIdx);
        const best = [...biome.ores].sort((a, b) => blockDef(b.item).value - blockDef(a.item).value)[0].item;
        let n = 0;
        for (let cy = py + 2; cy <= py + 5 && n < 8; cy++) for (let cx = px - 2; cx <= px + 2 && n < 8; cx++) if (solidHere(cx, cy) && this.rng.chance(0.6)) {
          w.set(cx, cy, best);
          n++;
        }
        break;
      }
      case 'tntRain':
        for (let i = 0, tries = 0; i < 4 && tries < 40; tries++) {
          const cx = px + this.rng.int(-3, 3);
          const cy = py + this.rng.int(3, 7);
          if (solidHere(cx, cy)) {
            w.set(cx, cy, B.TNT);
            i++;
          }
        }
        break;
      case 'repair':
        this.durability = Math.min(this.maxDur, this.durability + Math.round(this.maxDur * MINE_EVENTS.repairShare));
        break;
      case 'treasure':
        for (const dx of [-1, 1]) if (!w.isWall(px + dx)) w.set(px + dx, py + 3, B.CHEST);
        w.set(px, py + 4, B.CHEST);
        break;
    }
    void x;
    this.slow(0.4, 0.5);
    this.emit({ t: 'event', id });
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
    return TIERS[this.tier].dmg * this.stats.powerMult * (1 + 0.4 * this.enchants.efficiency) * (this.fever ? RUN.feverDamage : 1) * (this.superTimer > 0 ? MINE_EVENTS.superDamage : 1) * (this.giantTimer > 0 ? BOOST_FX.giantDamage : 1) * (this.mightTimer > 0 ? RUNES.might : 1);
  }

  /** Collision radius (the Giant power-up makes the pickaxe bigger). */
  get radius(): number {
    return PHYS.radius * (this.giantTimer > 0 ? BOOST_FX.giantRadius : 1);
  }

  private computeMaxDur(tier: number): number {
    // the tutorial is the same short demo on every difficulty
    const base = this.init.tutorial ? RUN.tutorialDurability : this.stats.maxDurBase;
    return Math.round(base * TIERS[tier].dur);
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

  /**
   * Breakthrough dash: power 0..1 (from hold time). Uses one charge, costs no durability.
   * dir 0 = straight down (needs the Forge unlock; reaches up to stats.dashDownBlocks).
   */
  dash(dir: -1 | 0 | 1, power: number): boolean {
    if (this.hold) return this.nudge(dir === 0 ? 1 : dir);
    if (this.over || this.nudges <= 0) return false;
    if (dir === 0 && this.stats.dashDownBlocks <= 0) return false;
    this.nudges--;
    this.dashes++;
    const p = Math.max(0, Math.min(1, power));
    const lerp = (r: [number, number]) => r[0] + (r[1] - r[0]) * p;
    if (dir === 0) {
      const speed = lerp(PHYS.dashDownSpeed);
      this.dashVx = 0;
      this.dashVy = speed;
      this.dashLeft = Math.round(1 + (this.stats.dashDownBlocks - 1) * p);
      this.dashTimer = (this.dashLeft + 1.5) / speed + 0.05;
      // line up with the column so the rush goes straight through it
      this.x = Math.floor(this.x) + 0.5;
    } else {
      const speed = lerp(PHYS.dashSpeed);
      const down = PHYS.dashDown;
      const side = Math.sqrt(1 - down * down);
      this.dashVx = dir * side * speed;
      this.dashVy = down * speed;
      this.dashLeft = Math.round(lerp(PHYS.dashBlocks));
      this.dashTimer = lerp(PHYS.dashTime);
    }
    this.dashDamage = this.damagePerHit * lerp(PHYS.dashDamage);
    this.dashBroken = 0;
    this.vx = this.dashVx;
    this.vy = this.dashVy;
    this.angVel = (dir || 1) * (14 + 16 * p);
    this.emit({ t: 'dash', dir, power: p, blocks: this.dashLeft });
    return true;
  }

  get dashing(): boolean {
    return this.dashTimer > 0;
  }

  private dashTimer = 0;
  private dashLeft = 0;
  private dashVx = 0;
  private dashVy = 0;
  private dashBroken = 0;
  private dashDamage = 0;

  /** A short no-wear window right after a dash, so the follow-up contact is free too. */
  private dashGrace = 0;

  private endDash(): void {
    if (this.dashTimer <= 0) return;
    this.dashTimer = 0;
    this.dashGrace = 0.15;
    this.vx *= 0.35;
    this.vy = Math.max(this.vy * 0.5, 2.5);
    this.dashBlocks += this.dashBroken;
    this.bestDash = Math.max(this.bestDash, this.dashBroken);
    this.emit({ t: 'dashEnd', broken: this.dashBroken });
  }

  boostCount(id: BoostId): number {
    return id === 'dynamite' ? this.dynamite : this.boosts[id] ?? 0;
  }

  /** Is this power-up still running (for the HUD)? */
  boostActive(id: BoostId): number {
    switch (id) {
      case 'giant':
        return this.giantTimer;
      case 'shield':
        return this.shieldTimer;
      case 'twin':
        return this.twinTimer;
      case 'magnet':
        return this.magnetTimer;
      case 'meteor':
        return this.meteorTimer;
      default:
        return 0;
    }
  }

  useBoost(id: BoostId): boolean {
    if (id === 'dynamite') return this.useDynamite();
    if (this.over || this.hold || (this.boosts[id] ?? 0) <= 0 || this.boostActive(id) > 0) return false;
    this.boosts[id]!--;
    this.boostsUsed[id] = (this.boostsUsed[id] ?? 0) + 1;
    const time = BOOSTS[id].time ?? 0;
    this.emit({ t: 'boost', id, x: this.x, y: this.y });
    switch (id) {
      case 'giant':
        this.giantTimer = time;
        this.slow(0.35, 0.4);
        break;
      case 'shield':
        this.shieldTimer = time;
        break;
      case 'twin':
        this.twinTimer = time;
        this.twins = [];
        for (let i = 0; i < BOOST_FX.twinCount; i++) {
          const side = i % 2 === 0 ? -1 : 1;
          this.twins.push({ x: this.x, y: this.y - 0.2, vx: side * this.rng.range(4, 6), vy: -3, angle: this.angle, life: time });
        }
        break;
      case 'teleport':
        this.teleport();
        break;
      case 'magnet':
        this.magnetTimer = time;
        this.magnetTick = 0;
        break;
      case 'meteor':
        this.endDash();
        this.meteorTimer = time;
        this.x = Math.floor(this.x) + 0.5;
        this.slow(0.3, 0.4);
        break;
    }
    return true;
  }

  /** Ice rift: a free straight plunge that smashes everything blastable on the way. */
  private plunge(): void {
    this.dashVx = 0;
    this.dashVy = RIFT.speed;
    this.dashLeft = RIFT.blocks;
    this.dashTimer = (RIFT.blocks + 1.5) / RIFT.speed + 0.05;
    this.dashDamage = 1e12;
    this.dashBroken = 0;
    this.x = Math.floor(this.x) + 0.5;
    this.vx = 0;
    this.vy = RIFT.speed;
    this.angVel = 22;
  }

  /** Magnet: every tick the nearest ore around the pickaxe is pulled out and mined. */
  private updateMagnet(dt: number): void {
    this.magnetTick -= dt;
    if (this.magnetTick > 0) return;
    this.magnetTick = BOOST_FX.magnetEvery;
    const r = BOOST_FX.magnetRadius;
    let best: [number, number] | null = null;
    let bestD = Infinity;
    for (let cy = Math.floor(this.y - r); cy <= Math.floor(this.y + r); cy++) {
      for (let cx = Math.floor(this.x - r); cx <= Math.floor(this.x + r); cx++) {
        if (this.world.isWall(cx)) continue;
        if (!blockDef(this.world.get(cx, cy)).ore) continue;
        const d = Math.hypot(cx + 0.5 - this.x, cy + 0.5 - this.y);
        if (d <= r && d < bestD) {
          bestD = d;
          best = [cx, cy];
        }
      }
    }
    if (!best) return;
    this.emit({ t: 'magnet', x0: this.x, y0: this.y, x: best[0] + 0.5, y: best[1] + 0.5 });
    this.breakBlock(best[0], best[1], 'magnet', false);
  }

  /** Meteor: a burning straight fall that clears a 3-wide shaft; only unblastable rock stops it. */
  private meteorStep(h: number): void {
    this.vx = 0;
    this.vy = BOOST_FX.meteorSpeed;
    const lead = Math.floor(this.y + this.radius + this.vy * h);
    const cx0 = Math.floor(this.x);
    for (let cy = Math.floor(this.y); cy <= lead; cy++) {
      for (let cx = cx0 - BOOST_FX.meteorHalf; cx <= cx0 + BOOST_FX.meteorHalf; cx++) {
        if (this.world.isWall(cx)) continue;
        const def = blockDef(this.world.get(cx, cy));
        if (!def.solid) continue;
        if (def.special || (def.blastable && Number.isFinite(def.hp))) this.breakBlock(cx, cy, 'pick', false);
        else if (cx === cx0) {
          // monolith / bedrock right below: the meteor crashes here
          this.meteorTimer = 0;
          this.vy = 2;
          this.emit({ t: 'boostEnd', id: 'meteor' });
          this.emit({ t: 'explode', x: this.x, y: this.y + 0.6, r: 1.8, chain: 0 });
          return;
        }
        if (this.over) return;
      }
    }
  }

  /** Blink straight down through the rock; the landing spot is carved out. */
  private teleport(): void {
    const x0 = this.x;
    const y0 = this.y;
    const dist = this.rng.int(BOOST_FX.teleportBlocks[0], BOOST_FX.teleportBlocks[1]);
    const ty = Math.min(CAMPAIGN_DEPTH - 3, Math.floor(this.y) + dist);
    const tx = Math.floor(this.x);
    for (let y = ty - 1; y <= ty; y++) {
      const id = this.world.get(tx, y);
      if (id !== B.CORE && !this.world.isWall(tx)) this.world.set(tx, y, B.AIR);
    }
    this.x = tx + 0.5;
    this.y = ty + 0.5;
    this.vx = 0;
    this.vy = 2;
    this.endDash();
    this.slow(0.5, 0.35);
    this.emit({ t: 'teleport', x0, y0, x: this.x, y: this.y, dist: ty - Math.floor(y0) });
  }

  useDynamite(): boolean {
    if (this.over || this.hold || this.dynamite <= 0) return false;
    this.dynamite--;
    this.dynamiteUsed++;
    this.boostsUsed.dynamite = (this.boostsUsed.dynamite ?? 0) + 1;
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
    if (this.dashGrace > 0) this.dashGrace -= dt;
    if (this.goldTimer > 0) this.goldTimer -= dt;
    if (this.superTimer > 0) this.superTimer -= dt;
    if (this.giantTimer > 0 && (this.giantTimer -= dt) <= 0) this.emit({ t: 'boostEnd', id: 'giant' });
    if (this.shieldTimer > 0 && (this.shieldTimer -= dt) <= 0) this.emit({ t: 'boostEnd', id: 'shield' });
    if (this.twinTimer > 0) this.twinTimer -= dt;
    if (this.mightTimer > 0) this.mightTimer -= dt;
    if (this.magnetTimer > 0 && (this.magnetTimer -= dt) <= 0) this.emit({ t: 'boostEnd', id: 'magnet' });
    if (this.meteorTimer > 0 && (this.meteorTimer -= dt) <= 0) {
      this.vy = Math.min(this.vy, 4);
      this.emit({ t: 'boostEnd', id: 'meteor' });
    }
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
    if (this.twins.length) this.updateTwins(dt);
    if (this.magnetTimer > 0 && !this.over) this.updateMagnet(dt);

    this.angle += this.angVel * dt;
    this.angVel *= Math.exp(-0.8 * dt);

    this.updateLava(dt);
    this.updateDepth();
    this.world.forgetAbove(this.depth - 80);
  }

  private substep(h: number): void {
    if (this.meteorTimer > 0) this.meteorStep(h);
    if (this.over) return;
    if (this.meteorTimer > 0) {
      // the meteor ignores gravity, drag and contacts: the shaft below was just cleared
    } else if (this.dashTimer > 0) {
      // the dash ignores gravity and drag: a straight, committed rush
      this.dashTimer -= h;
      this.vx = this.dashVx;
      this.vy = this.dashVy;
      if (this.dashTimer <= 0) {
        this.dashTimer = 1e-9;
        this.endDash();
      }
    } else {
      this.vy = Math.min(this.vy + PHYS.gravity * h, this.maxFall);
      this.vx *= Math.exp(-PHYS.airDragX * h);
    }
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

  private findContact(
    bx = this.x,
    by = this.y,
    r = this.radius,
  ): { cx: number; cy: number; nx: number; ny: number; pen: number } | null {
    let best: { cx: number; cy: number; nx: number; ny: number; pen: number } | null = null;
    const x0 = Math.floor(bx - r);
    const x1 = Math.floor(bx + r);
    const y0 = Math.floor(by - r);
    const y1 = Math.floor(by + r);
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const id = this.world.get(cx, cy);
        if (!blockDef(id).solid) continue;
        const px = Math.max(cx, Math.min(bx, cx + 1));
        const py = Math.max(cy, Math.min(by, cy + 1));
        let dx = bx - px;
        let dy = by - py;
        let dist = Math.hypot(dx, dy);
        if (dist >= r) continue;
        let pen: number;
        if (dist < 1e-6) {
          // centre is inside the block: push out along the shortest axis
          const left = bx - cx;
          const right = cx + 1 - bx;
          const top = by - cy;
          const bottom = cy + 1 - by;
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

    // breakthrough: smash anything breakable in the way, no durability spent
    if (this.dashTimer > 0 && !wall && def.special !== 'slime') {
      if (def.special || (def.blastable && Number.isFinite(def.hp))) {
        if (def.special || this.world.damage(cx, cy, this.dashDamage)) {
          this.breakBlock(cx, cy, 'pick', false);
          this.dashBroken++;
          if (--this.dashLeft <= 0) this.endDash();
          return;
        }
        // too hard to smash through: the dash dents it and stops
        const frac = Math.max(0, this.world.hpAt(cx, cy) / this.world.fullHp(id, cy));
        this.emit({ t: 'hit', x: cx, y: cy, id, dmg: this.dashDamage, crit: false, frac, speed: vn });
      }
      this.endDash(); // obsidian / bedrock / a block too hard stop the dash
    }
    if (wall && this.dashTimer > 0) this.endDash();

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
      this.slimes++;
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
    if (crit) this.crits++;
    const cell = `${cx},${cy}`;
    this.focus = cell === this.focusCell ? Math.min(PHYS.focusMax, this.focus + 1) : 0;
    this.focusCell = cell;
    const focusMult = 1 + PHYS.focusStep * this.focus;
    const dmg = this.damagePerHit * impact * focusMult * (crit ? PHYS.critMult : 1);
    const before = this.world.hpAt(cx, cy);

    // a better pickaxe wears less on softer blocks
    this.spendDurability(def.durCost);

    this.sideSwing(cx, cy, dmg);

    if (Number.isFinite(before) && this.world.damage(cx, cy, dmg)) {
      const keep = dmg >= before * 2 ? PHYS.pierceKeep : PHYS.breakKeep;
      this.vx *= keep;
      this.vy *= keep;
      this.breakBlock(cx, cy, 'pick', crit);
    } else {
      this.x += nx * pen;
      this.y += ny * pen;
      const frac = Number.isFinite(before) ? Math.max(0, this.world.hpAt(cx, cy) / this.world.fullHp(id, cy)) : 1;
      this.emit({ t: 'hit', x: cx, y: cy, id, dmg, crit, frac, speed: vn });
      if (++this.bouncesSinceBreak === 3) this.emit({ t: 'stuck' });
      if (def.slippery && ny < -0.5) {
        // ice: a low hop and a long skid to the side instead of a bounce
        this.reflect(nx, ny, vn, 0.1);
        this.vy = Math.min(this.vy, -PHYS.minBounce * 0.45);
        const dir = this.vx !== 0 ? Math.sign(this.vx) : this.rng.sign();
        this.vx = dir * Math.max(Math.abs(this.vx), this.rng.range(3.5, 5.5));
        this.emit({ t: 'skid', x: this.x, y: this.y + this.radius, dir });
      } else {
        this.reflect(nx, ny, vn, PHYS.restitution);
        if (ny < -0.5) {
          this.vy = Math.min(this.vy, -PHYS.minBounce);
          this.vx += this.rng.sign() * this.rng.range(PHYS.sideKickMin, PHYS.sideKickMax);
        }
      }
      this.angVel = this.rng.sign() * this.rng.range(6, 14);
    }
    if (this.durability <= 0) this.die();
  }

  /** Bigger pickaxe: the same hit also strikes the nearest blocks in this row. */
  private sideSwing(cx: number, cy: number, dmg: number): void {
    const n = this.stats.pickSize + (this.giantTimer > 0 ? BOOST_FX.giantSwing : 0);
    if (n <= 0) return;
    const cells: number[] = [];
    for (let d = 1; d <= n + 1 && cells.length < n; d++) {
      // nearer side first, so a size-1 pickaxe hits the neighbour it overlaps most
      const first = this.x >= cx + 0.5 ? 1 : -1;
      for (const dx of [first * d, -first * d]) if (cells.length < n) cells.push(cx + dx);
    }
    for (const x of cells) {
      if (this.world.isWall(x)) continue;
      const id = this.world.get(x, cy);
      const def = blockDef(id);
      if (!def.solid || !Number.isFinite(def.hp) || def.special) continue;
      if (this.world.damage(x, cy, dmg)) this.breakBlock(x, cy, 'pick', false);
      else this.emit({ t: 'hit', x, y: cy, id, dmg, crit: false, frac: Math.max(0, this.world.hpAt(x, cy) / this.world.fullHp(id, cy)), speed: 0 });
    }
  }

  private reflect(nx: number, ny: number, vn: number, e: number): void {
    // v' = v + (1 + e) * vn * n   (vn is the speed *into* the surface)
    this.vx += (1 + e) * vn * nx;
    this.vy += (1 + e) * vn * ny;
  }

  private spendDurability(cost: number): void {
    if (cost <= 0 || this.dashGrace > 0 || this.shieldTimer > 0 || this.meteorTimer > 0) return;
    const save = Math.min(0.75, 0.25 * this.enchants.unbreaking);
    if (save > 0 && this.rng.chance(save)) return;
    this.durability -= cost * (WORLDS[this.worldIdx]?.wear ?? 1);
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
    let v = def.value * (1 + (Math.max(0, y) + this.world.offset) / RUN.depthValueDiv);
    v *= this.stats.coinMult * (1 + TIERS[this.tier].coinBonus);
    if (def.ore) {
      if (this.furnaceTimer > 0) v *= 2;
      v *= 1 + 0.5 * this.enchants.fortune;
    }
    if (this.fever) v *= RUN.feverCoins;
    if (this.goldTimer > 0) v *= MINE_EVENTS.goldCoins;
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
    if (def.ore) {
      this.oreCount++;
      this.oreCounts[def.key] = (this.oreCounts[def.key] ?? 0) + 1;
    }
    if (this.eventGoal > 0 && ++this.eventProgress >= this.eventGoal) this.fireEvent(x, y);

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
        // in the tutorial the anvil fully repairs: a clear lesson and a 15–20 s demo
        const heal = this.init.tutorial ? this.maxDur : Math.round(this.maxDur * RUN.anvilHeal * this.healFactor());
        const amount = Math.min(this.maxDur - this.durability, heal);
        this.durability += amount;
        this.healCount++;
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
        this.enchantsGot++;
        this.slow(0.4, 0.4);
        this.emit({ t: 'enchant', id });
        break;
      }
      case 'luckgem':
        this.gems++;
        this.emit({ t: 'gem', amount: 1, x, y });
        break;
      case 'rift':
        this.rifts++;
        this.emit({ t: 'rift', x: x + 0.5, y: y + 0.5 });
        if (cause === 'pick' && this.meteorTimer <= 0) this.plunge();
        break;
      case 'rune': {
        this.runes++;
        const id = this.rng.weighted((Object.keys(RUNES.weights) as RuneId[]).map((item) => ({ item, w: RUNES.weights[item] })));
        if (id === 'might') this.mightTimer = RUNES.time;
        else if (id === 'gold') this.goldTimer = Math.max(this.goldTimer, RUNES.time);
        else if (id === 'ward') this.shieldTimer = Math.max(this.shieldTimer, RUNES.time);
        else {
          const amount = Math.min(this.maxDur - this.durability, Math.round(this.maxDur * RUNES.mend));
          this.durability += amount;
          this.emit({ t: 'heal', amount });
        }
        this.slow(0.35, 0.45);
        this.emit({ t: 'rune', id, x: x + 0.5, y: y + 0.5 });
        break;
      }
      case 'core': {
        const reward = WORLDS[this.worldIdx]?.core ?? WORLDS[0].core;
        this.core = true;
        this.bonusCoins += reward.coins;
        this.gems += reward.gems;
        this.over = true;
        this.emit({ t: 'core' });
        break;
      }
      case 'slime':
        break;
    }
  }

  private openChest(x: number, y: number): void {
    const biome = biomeAt(y, this.worldIdx);
    const avgOre =
      biome.ores.reduce((s, o) => s + blockDef(o.item).value * o.w, 0) / biome.ores.reduce((s, o) => s + o.w, 0);
    const roll = this.rng.next();
    let loot: ChestLoot;
    let amount: number;
    if (roll < 0.5) {
      loot = 'coins';
      amount = Math.round(avgOre * this.rng.range(8, 20) * this.stats.coinMult * (1 + (y + this.world.offset) / RUN.depthValueDiv));
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

  // ───────────────────────── twin ghosts ─────────────────────────

  private updateTwins(dt: number): void {
    const r = PHYS.radius;
    for (const g of this.twins) {
      g.life -= dt;
      const steps = Math.max(1, Math.ceil((Math.hypot(g.vx, g.vy) * dt) / PHYS.maxStep));
      const h = dt / steps;
      for (let i = 0; i < steps; i++) {
        g.vy = Math.min(g.vy + PHYS.gravity * h, this.maxFall);
        g.vx *= Math.exp(-PHYS.airDragX * 0.5 * h);
        g.x += g.vx * h;
        g.y += g.vy * h;
        const c = this.findContact(g.x, g.y, r);
        if (!c) continue;
        const vn = -(g.vx * c.nx + g.vy * c.ny);
        const def = blockDef(this.world.get(c.cx, c.cy));
        const breakable = !this.world.isWall(c.cx) && def.special !== 'slime' && (def.special || Number.isFinite(def.hp));
        if (breakable && vn > 0.05 && (def.special || this.world.damage(c.cx, c.cy, this.damagePerHit * 1.2))) {
          this.breakBlock(c.cx, c.cy, 'twin', false);
          g.vx *= PHYS.breakKeep;
          g.vy *= PHYS.breakKeep;
          continue;
        }
        g.x += c.nx * c.pen;
        g.y += c.ny * c.pen;
        if (vn > 0.05) {
          g.vx += (1 + 0.4) * vn * c.nx;
          g.vy += (1 + 0.4) * vn * c.ny;
          if (c.ny < -0.5) {
            g.vy = Math.min(g.vy, -PHYS.minBounce);
            g.vx += this.rng.sign() * this.rng.range(0.5, 2.5);
          }
        }
      }
      g.angle += (g.vx >= 0 ? 1 : -1) * 10 * dt;
      // a ghost that drifts too far from the real pickaxe fades out early
      if (Math.abs(g.y - this.y) > 14) g.life = 0;
    }
    for (const g of this.twins) if (g.life <= 0) this.emit({ t: 'twinPoof', x: g.x, y: g.y });
    this.twins = this.twins.filter((g) => g.life > 0);
    if (!this.twins.length && this.twinTimer > 0) this.twinTimer = 0;
    if (!this.twins.length) this.emit({ t: 'boostEnd', id: 'twin' });
  }

  // ───────────────────────── environment ─────────────────────────

  private updateLava(dt: number): void {
    const id = this.world.get(Math.floor(this.x), Math.floor(this.y));
    this.inLava = id === B.LAVA;
    if (!this.inLava) {
      this.lavaTimer = 0;
      return;
    }
    if (TIERS[this.tier].fireproof || this.enchants.fireproof > 0 || this.shieldTimer > 0) return;
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
      this.depthCoins += (this.maxDepth > this.init.bestDepth ? RUN.depthCoinNew : RUN.depthCoinOld) * (1 + this.world.offset / RUN.depthValueDiv);
      const biomes = biomesOf(this.worldIdx);
      for (let i = 1; i < biomes.length; i++) {
        const b = biomes[i];
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
      events: this.eventsFired,
      dashes: this.dashes,
      dashBlocks: this.dashBlocks,
      bestDash: this.bestDash,
      heals: this.healCount,
      enchantsGot: this.enchantsGot,
      slimes: this.slimes,
      crits: this.crits,
      rifts: this.rifts,
      runes: this.runes,
      oreCounts: { ...this.oreCounts },
      boostsUsed: { ...this.boostsUsed },
    };
  }

  drainEvents(): GameEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }
}
