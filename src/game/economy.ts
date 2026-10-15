import {
  BOOSTS,
  type BoostId,
  DASH_DOWN,
  DIFFICULTY,
  FORGE_COSTS,
  MEGA,
  WORLD_W,
  type MegaId,
  MAX_TIER,
  PRESTIGE,
  RUN,
  SHOP,
  UPGRADES,
  type UpgradeDef,
  type UpgradeId,
} from './config';
import { freshUpgrades, type SaveData } from './save';

/** Round to 2 significant digits so prices look clean (1 234 → 1 200). */
export function niceRound(n: number): number {
  if (n < 100) return Math.round(n);
  const mag = Math.pow(10, Math.floor(Math.log10(n)) - 1);
  return Math.round(n / mag) * mag;
}

export function upgradeDef(id: UpgradeId): UpgradeDef {
  return UPGRADES.find((u) => u.id === id)!;
}

export function upgradeCost(id: UpgradeId, level: number): number {
  const def = upgradeDef(id);
  return niceRound(def.base * Math.pow(def.growth, level));
}

export function canBuyUpgrade(save: SaveData, id: UpgradeId): boolean {
  const lvl = save.upgrades[id];
  return lvl < upgradeDef(id).max && save.coins >= upgradeCost(id, lvl);
}

export function buyUpgrade(save: SaveData, id: UpgradeId): boolean {
  if (!canBuyUpgrade(save, id)) return false;
  save.coins -= upgradeCost(id, save.upgrades[id]);
  save.upgrades[id]++;
  save.life.upgradesBought++;
  return true;
}

export function forgeCost(save: SaveData): number | null {
  return save.forgeTier >= MAX_TIER ? null : FORGE_COSTS[save.forgeTier];
}

export function buyForge(save: SaveData): boolean {
  const cost = forgeCost(save);
  if (cost === null || save.coins < cost) return false;
  save.coins -= cost;
  save.forgeTier++;
  save.life.upgradesBought++;
  return true;
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function dynamiteCost(save: SaveData): number {
  const n = save.dynamiteDay === today() ? save.dynamiteBoughtToday : 0;
  return niceRound(SHOP.dynamiteBase * Math.pow(SHOP.dynamiteGrowth, n));
}

function megaLevel(save: SaveData, id: MegaId): number {
  return id === 'size' ? save.pickSize : save.shaftWidth;
}

export function megaCost(save: SaveData, id: MegaId): number | null {
  const lvl = megaLevel(save, id);
  return lvl >= MEGA[id].max ? null : MEGA[id].costs[lvl];
}

export function buyMega(save: SaveData, id: MegaId): boolean {
  const cost = megaCost(save, id);
  if (cost === null || save.coins < cost) return false;
  save.coins -= cost;
  if (id === 'size') save.pickSize++;
  else save.shaftWidth++;
  save.life.upgradesBought++;
  return true;
}

/** Coin rewards and item prices scale with progress so they always feel like 1–2 runs of income. */
export function rewardScale(save: SaveData): number {
  return Math.round(60 * Math.pow(1 + save.bestDepth / 15, 1.9));
}

export function dashDownCost(save: SaveData): number | null {
  return save.dashDown >= DASH_DOWN.costs.length ? null : DASH_DOWN.costs[save.dashDown];
}

export function buyDashDown(save: SaveData): boolean {
  const cost = dashDownCost(save);
  if (cost === null || save.coins < cost) return false;
  save.coins -= cost;
  save.dashDown++;
  save.life.upgradesBought++;
  return true;
}

export function boostOwned(save: SaveData, id: BoostId): number {
  return id === 'dynamite' ? save.dynamite : save.boosts[id];
}

export function addBoost(save: SaveData, id: BoostId, n: number): void {
  if (id === 'dynamite') save.dynamite += n;
  else save.boosts[id] += n;
}

export function boostCost(save: SaveData, id: BoostId): number {
  return id === 'dynamite' ? dynamiteCost(save) : niceRound(Math.max(40, rewardScale(save) * BOOSTS[id].price));
}

export function buyBoost(save: SaveData, id: BoostId): boolean {
  if (id === 'dynamite') return buyDynamite(save);
  const cost = boostCost(save, id);
  if (save.coins < cost) return false;
  save.coins -= cost;
  save.boosts[id]++;
  return true;
}

/** Toggle a power-up in the run loadout (max LOADOUT_SIZE). Returns false when full. */
export function toggleLoadout(save: SaveData, id: BoostId, max: number): boolean {
  const i = save.loadout.indexOf(id);
  if (i >= 0) {
    save.loadout.splice(i, 1);
    return true;
  }
  if (save.loadout.length >= max) return false;
  save.loadout.push(id);
  return true;
}

export function buyDynamite(save: SaveData): boolean {
  const cost = dynamiteCost(save);
  if (save.coins < cost) return false;
  if (save.dynamiteDay !== today()) {
    save.dynamiteDay = today();
    save.dynamiteBoughtToday = 0;
  }
  save.coins -= cost;
  save.dynamite++;
  save.dynamiteBoughtToday++;
  return true;
}

export function buyTotem(save: SaveData): boolean {
  if (save.gems < SHOP.totemGems) return false;
  save.gems -= SHOP.totemGems;
  save.totems++;
  return true;
}

export function prestigeShards(save: SaveData): number {
  return Math.floor(Math.sqrt(save.cycleCoins / PRESTIGE.divisor));
}

export function canPrestige(save: SaveData): boolean {
  return save.bestDepth >= PRESTIGE.unlockDepth && prestigeShards(save) > 0;
}

export function doPrestige(save: SaveData): number {
  if (!canPrestige(save)) return 0;
  const gained = prestigeShards(save);
  save.shards += gained;
  save.prestiges++;
  save.coins = 0;
  save.cycleCoins = 0;
  save.upgrades = freshUpgrades();
  save.forgeTier = 0;
  save.startDepth = 0;
  return gained;
}

export function addCoins(save: SaveData, n: number): void {
  save.coins += n;
  save.cycleCoins += n;
  save.totalCoins += n;
}

/** Everything a run needs, derived from permanent progress. */
export interface RunStats {
  maxDurBase: number;
  /** Block HP multiplier from difficulty. */
  hpMult: number;
  /** Extra blocks struck per hit (mega upgrade). */
  pickSize: number;
  /** Shaft width in columns. */
  worldWidth: number;
  powerMult: number;
  coinMult: number;
  luckMult: number;
  critChance: number;
  nudgeCharges: number;
  nudgeRegen: number;
  blastRadius: number;
  maxFallMult: number;
  startTier: number;
  dynamite: number;
  totems: number;
  startDepth: number;
  /** Max blocks of a straight-down breakthrough (0 = not bought). */
  dashDownBlocks: number;
  /** Power-ups brought into the run (dynamite is `dynamite`). */
  boosts: Partial<Record<Exclude<BoostId, 'dynamite'>, number>>;
}

export function deriveStats(save: SaveData): RunStats {
  const diff = DIFFICULTY[save.difficulty || 'normal'];
  const u = save.upgrades;
  const shardCoin = 1 + save.shards * PRESTIGE.coinPerShard;
  const shardDmg = 1 + save.shards * PRESTIGE.dmgPerShard;
  return {
    maxDurBase: Math.round((RUN.baseDurability + RUN.durPerLevel * u.durability) * diff.dur),
    hpMult: diff.hp,
    pickSize: save.pickSize,
    worldWidth: WORLD_W + MEGA.width.step * save.shaftWidth,
    powerMult: (1 + 0.15 * u.power) * shardDmg,
    coinMult: (1 + 0.1 * u.fortune) * shardCoin * diff.coins,
    luckMult: 1 + 0.05 * u.luck,
    critChance: 0.02 * u.crit,
    nudgeCharges: 2 + Math.floor(u.control / 2),
    nudgeRegen: 4.5 * Math.pow(0.92, u.control),
    blastRadius: RUN.dynamiteRadius + RUN.dynamiteRadiusPerLvl * u.blast,
    maxFallMult: 1 + 0.04 * u.weight,
    startTier: save.forgeTier,
    dynamite: save.loadout.includes('dynamite') ? Math.min(save.dynamite, SHOP.maxDynamitePerRun) : 0,
    totems: Math.min(save.totems, 1),
    startDepth: save.startDepth,
    dashDownBlocks: save.dashDown > 0 ? DASH_DOWN.blocks[save.dashDown - 1] : 0,
    boosts: Object.fromEntries(
      save.loadout.filter((id) => id !== 'dynamite').map((id) => [id, Math.min(save.boosts[id as Exclude<BoostId, 'dynamite'>] ?? 0, BOOSTS[id].perRun)]),
    ),
  };
}
