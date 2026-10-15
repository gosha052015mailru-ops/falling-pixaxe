import { B } from './blocks';

/** All balance numbers live here. See GAME_DESIGN.md for rationale. */

export const WORLD_W = 9;
export const CAMPAIGN_DEPTH = 1000;

export const PHYS = {
  gravity: 20,
  maxFall: 15,
  radius: 0.38,
  restitution: 0.45,
  minBounce: 5,
  sideKickMin: 2,
  sideKickMax: 6,
  breakKeep: 0.85,
  pierceKeep: 0.95,
  airDragX: 0.6,
  lavaDrag: 3,
  maxStep: 0.2,
  nudgeImpulse: 7,
  impactRef: 8,
  impactMin: 0.6,
  impactMax: 2.0,
  critMult: 3,
};

export const RUN = {
  baseDurability: 60,
  durPerLevel: 6,
  /** Block HP multiplier grows with depth: hp × (1 + depth / hpDepthDiv) ^ hpDepthPow. */
  hpDepthDiv: 80,
  hpDepthPow: 1.2,
  /** Workbenches can raise the tier at most this much above the forge tier per run. */
  workbenchTierCap: 3,
  comboWindow: 1.2,
  comboStep: 0.025,
  comboCap: 40,
  depthCoinNew: 2,
  depthCoinOld: 0.5,
  depthValueDiv: 500,
  furnaceTime: 12,
  lavaTick: 0.3,
  anvilHeal: 0.3,
  workbenchHeal: 0.15,
  /** Every heal in a run is weaker than the previous one (metal fatigue). */
  healDecay: 0.75,
  tntFuse: 0.3,
  tntChainFuse: 0.18,
  tntRadius: 2.6,
  dynamiteRadius: 2.0,
  dynamiteRadiusPerLvl: 0.25,
  totemHeal: 0.5,
  explosiveEvery: 15,
};

export interface TierDef {
  key: string;
  dmg: number;
  dur: number;
  coinBonus: number;
  critBonus: number;
  fireproof: boolean;
  colors: { head: string; edge: string; handle: string };
}

export const TIERS: TierDef[] = [
  { key: 'wood', dmg: 1, dur: 1.0, coinBonus: 0, critBonus: 0, fireproof: false, colors: { head: '#b5895a', edge: '#8a6238', handle: '#6b4423' } },
  { key: 'stone', dmg: 2, dur: 1.15, coinBonus: 0, critBonus: 0, fireproof: false, colors: { head: '#9a9aa2', edge: '#6e6e76', handle: '#6b4423' } },
  { key: 'copper', dmg: 3, dur: 1.3, coinBonus: 0, critBonus: 0, fireproof: false, colors: { head: '#e8894a', edge: '#b25a24', handle: '#6b4423' } },
  { key: 'iron', dmg: 5, dur: 1.45, coinBonus: 0, critBonus: 0, fireproof: false, colors: { head: '#e6e6ec', edge: '#a9a9b3', handle: '#6b4423' } },
  { key: 'gold', dmg: 8, dur: 1.1, coinBonus: 0.25, critBonus: 0, fireproof: false, colors: { head: '#ffd23f', edge: '#e59a10', handle: '#6b4423' } },
  { key: 'diamond', dmg: 12, dur: 1.7, coinBonus: 0, critBonus: 0, fireproof: false, colors: { head: '#6ff3f0', edge: '#2ab7c4', handle: '#6b4423' } },
  { key: 'obsidian', dmg: 20, dur: 2.0, coinBonus: 0, critBonus: 0, fireproof: true, colors: { head: '#5b2d8a', edge: '#2a1240', handle: '#3a2a1a' } },
  { key: 'star', dmg: 35, dur: 2.3, coinBonus: 0.25, critBonus: 0.1, fireproof: true, colors: { head: '#fff7a8', edge: '#ff7ad9', handle: '#4a3aa8' } },
];
export const MAX_TIER = TIERS.length - 1;

export type UpgradeId =
  | 'durability'
  | 'power'
  | 'fortune'
  | 'luck'
  | 'crit'
  | 'control'
  | 'blast'
  | 'weight';

export interface UpgradeDef {
  id: UpgradeId;
  base: number;
  growth: number;
  max: number;
  icon: string;
}

export const UPGRADES: UpgradeDef[] = [
  { id: 'durability', base: 20, growth: 1.33, max: 60, icon: '❤' },
  { id: 'power', base: 35, growth: 1.4, max: 60, icon: '⚒' },
  { id: 'fortune', base: 50, growth: 1.45, max: 50, icon: '💰' },
  { id: 'luck', base: 90, growth: 1.48, max: 25, icon: '🍀' },
  { id: 'crit', base: 140, growth: 1.52, max: 20, icon: '✦' },
  { id: 'control', base: 70, growth: 1.6, max: 10, icon: '↔' },
  { id: 'blast', base: 110, growth: 1.58, max: 10, icon: '💥' },
  { id: 'weight', base: 60, growth: 1.45, max: 15, icon: '⬇' },
];

/** Forge: cost to raise starting tier to index i+1. */
export const FORGE_COSTS = [500, 3000, 15000, 100000, 600000, 4000000, 25000000];

export const SHOP = {
  dynamiteBase: 60,
  dynamiteGrowth: 1.08,
  maxDynamitePerRun: 5,
  totemGems: 10,
};

export const PRESTIGE = {
  unlockDepth: 450,
  divisor: 5000,
  coinPerShard: 0.05,
  dmgPerShard: 0.03,
};

export type EnchantId = 'efficiency' | 'fortune' | 'unbreaking' | 'fireproof' | 'explosive' | 'heavy';
export const ENCHANTS: EnchantId[] = ['efficiency', 'fortune', 'unbreaking', 'fireproof', 'explosive', 'heavy'];

export interface BiomeDef {
  key: string;
  from: number;
  to: number;
  base: { item: B; w: number }[];
  /** Per-cell probability that a cell is an ore. */
  oreChance: number;
  ores: { item: B; w: number }[];
  /** Cave noise threshold (higher = fewer caves). */
  cave: number;
  /** Multipliers for special block chances. */
  special: Partial<Record<SpecialSpawn, number>>;
  lavaInCaves?: number;
  bedrockChance?: number;
  bg: [string, string];
  milestoneCoins: number;
  milestoneGems: number;
}

export type SpecialSpawn = 'workbench' | 'anvil' | 'tnt' | 'chest' | 'furnace' | 'enchant' | 'slime' | 'luckgem';

/** Base per-cell spawn probabilities. */
export const SPECIAL_BASE: Record<SpecialSpawn, number> = {
  workbench: 0.0025,
  anvil: 0.0025,
  tnt: 0.006,
  chest: 0.0025,
  furnace: 0.002,
  enchant: 0.0012,
  slime: 0.004,
  luckgem: 0.0008,
};

export const SPECIAL_BLOCK: Record<SpecialSpawn, B> = {
  workbench: B.WORKBENCH,
  anvil: B.ANVIL,
  tnt: B.TNT,
  chest: B.CHEST,
  furnace: B.FURNACE,
  enchant: B.ENCHANT,
  slime: B.SLIME,
  luckgem: B.LUCKGEM,
};

export const BIOMES: BiomeDef[] = [
  {
    key: 'meadow', from: 0, to: 20,
    base: [{ item: B.DIRT, w: 8 }, { item: B.CLAY, w: 2 }],
    oreChance: 0.03, ores: [{ item: B.COAL, w: 1 }],
    cave: 0.78, special: { workbench: 0.7, tnt: 0.5, enchant: 0, furnace: 0.5 },
    bg: ['#3a2a1e', '#2a1d14'], milestoneCoins: 0, milestoneGems: 0,
  },
  {
    key: 'caves', from: 20, to: 100,
    base: [{ item: B.STONE, w: 10 }, { item: B.DIRT, w: 1 }],
    oreChance: 0.08, ores: [{ item: B.COAL, w: 6 }, { item: B.COPPER, w: 4 }, { item: B.IRON, w: 2 }],
    cave: 0.7, special: {},
    bg: ['#2c2c33', '#1d1d22'], milestoneCoins: 60, milestoneGems: 1,
  },
  {
    key: 'depths', from: 100, to: 250,
    base: [{ item: B.DEEPSTONE, w: 10 }, { item: B.STONE, w: 1 }],
    oreChance: 0.09, ores: [{ item: B.IRON, w: 6 }, { item: B.GOLD, w: 3 }, { item: B.RUBY, w: 2 }, { item: B.SAPPHIRE, w: 2 }, { item: B.COAL, w: 2 }],
    cave: 0.66, special: { tnt: 1.3 },
    bg: ['#1f1d29', '#15131c'], milestoneCoins: 600, milestoneGems: 3,
  },
  {
    key: 'lava', from: 250, to: 450,
    base: [{ item: B.BASALT, w: 10 }, { item: B.OBSIDIAN, w: 0.5 }],
    oreChance: 0.09, ores: [{ item: B.GOLD, w: 5 }, { item: B.DIAMOND, w: 2 }, { item: B.RUBY, w: 2 }],
    cave: 0.64, special: { tnt: 1.4, furnace: 1.5 }, lavaInCaves: 0.35,
    bg: ['#2a1414', '#1a0b0b'], milestoneCoins: 4000, milestoneGems: 5,
  },
  {
    key: 'grotto', from: 450, to: 700,
    base: [{ item: B.CRYSTAL, w: 10 }],
    oreChance: 0.1, ores: [{ item: B.AMETHYST, w: 5 }, { item: B.EMERALD, w: 2 }, { item: B.DIAMOND, w: 2 }],
    cave: 0.64, special: { slime: 1, enchant: 1.5 },
    bg: ['#1b1838', '#100e24'], milestoneCoins: 25000, milestoneGems: 8,
  },
  {
    key: 'abyss', from: 700, to: CAMPAIGN_DEPTH,
    base: [{ item: B.VOIDSTONE, w: 10 }, { item: B.OBSIDIAN, w: 1 }],
    oreChance: 0.07, ores: [{ item: B.STARORE, w: 1 }, { item: B.EMERALD, w: 3 }, { item: B.DIAMOND, w: 3 }],
    cave: 0.62, special: { workbench: 1.3, anvil: 1.3 }, bedrockChance: 0.012,
    bg: ['#0d0d16', '#05050a'], milestoneCoins: 120000, milestoneGems: 12,
  },
];

/** Biome boundaries that act as elevator checkpoints. */
export const CHECKPOINTS = BIOMES.slice(1).map((b) => b.from);
export const CORE_REWARD = { coins: 500000, gems: 50 };

export function biomeAt(depth: number): BiomeDef {
  for (const b of BIOMES) if (depth < b.to) return b;
  return BIOMES[BIOMES.length - 1];
}
export function biomeIndex(depth: number): number {
  for (let i = 0; i < BIOMES.length; i++) if (depth < BIOMES[i].to) return i;
  return BIOMES.length - 1;
}
