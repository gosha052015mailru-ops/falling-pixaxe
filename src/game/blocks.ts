export enum B {
  AIR = 0,
  GRASS,
  DIRT,
  CLAY,
  STONE,
  COAL,
  COPPER,
  IRON,
  DEEPSTONE,
  GOLD,
  RUBY,
  SAPPHIRE,
  BASALT,
  DIAMOND,
  CRYSTAL,
  AMETHYST,
  EMERALD,
  OBSIDIAN,
  VOIDSTONE,
  STARORE,
  BEDROCK,
  WORKBENCH,
  ANVIL,
  TNT,
  CHEST,
  FURNACE,
  ENCHANT,
  SLIME,
  LUCKGEM,
  LAVA,
  CORE,
  // ── world 2: Frost ──
  SNOW,
  ICE,
  PERMAFROST,
  BLUEICE,
  FROSTSTONE,
  GLACIER,
  FROSTITE,
  SILVER,
  MITHRIL,
  AURORITE,
  ICEHEART,
  RIFT,
  // ── world 3: Ruins ──
  SAND,
  SANDSTONE,
  RUINBRICK,
  JADESTONE,
  TEMPLESTONE,
  MONOLITH,
  RELICGOLD,
  JADE,
  TOPAZ,
  SUNSTONE,
  RELIC,
  RUNE,
}

export type Special =
  | 'workbench'
  | 'anvil'
  | 'tnt'
  | 'chest'
  | 'furnace'
  | 'enchant'
  | 'slime'
  | 'luckgem'
  | 'core'
  /** Frost: an ice rift — the pickaxe plunges straight down through it. */
  | 'rift'
  /** Ruins: an ancient rune — a random short blessing. */
  | 'rune';

export type TextureStyle = 'plain' | 'grass' | 'ore' | 'gem' | 'special' | 'liquid' | 'bricks' | 'ice';

export interface BlockDef {
  id: B;
  key: string;
  /** Damage required to break. Infinity = unbreakable. */
  hp: number;
  /** Base coin value on break. */
  value: number;
  solid: boolean;
  liquid?: boolean;
  /** Durability spent per hit on this block. */
  durCost: number;
  /** Explosions can destroy it. */
  blastable: boolean;
  special?: Special;
  /** Is it an "ore" (affected by furnace / fortune enchant). */
  ore?: boolean;
  /** Ice: the pickaxe skids sideways on it instead of bouncing up. */
  slippery?: boolean;
  /** Texture: base color, accent color(s). */
  colors: [string, string, string?];
  style: TextureStyle;
}

const d = (
  id: B,
  key: string,
  hp: number,
  value: number,
  colors: [string, string, string?],
  style: TextureStyle,
  extra: Partial<BlockDef> = {},
): BlockDef => ({
  id,
  key,
  hp,
  value,
  solid: true,
  durCost: 1,
  blastable: true,
  colors,
  style,
  ...extra,
});

/** Harder (deeper) rock costs more durability per hit; tiers bring matching max HP (config TIERS.dur). */
export const BLOCKS: BlockDef[] = [];
const defs: BlockDef[] = [
  d(B.AIR, 'air', 0, 0, ['#000', '#000'], 'plain', { solid: false, blastable: false }),
  d(B.GRASS, 'grass', 0.85, 1, ['#7a5230', '#4caf3a', '#3a8a2c'], 'grass'),
  d(B.DIRT, 'dirt', 0.85, 1, ['#7a5230', '#5e3d22'], 'plain'),
  d(B.CLAY, 'clay', 2.5, 2, ['#b5785a', '#99603f'], 'plain'),
  d(B.STONE, 'stone', 3, 2, ['#7d7d85', '#64646c'], 'plain'),
  d(B.COAL, 'coal', 4, 6, ['#7d7d85', '#1d1d22', '#3a3a40'], 'ore', { ore: true }),
  d(B.COPPER, 'copper', 5, 10, ['#7d7d85', '#e07a3c', '#3fae8e'], 'ore', { ore: true }),
  d(B.IRON, 'iron', 8, 18, ['#7d7d85', '#e3c3a5', '#b98f6d'], 'ore', { ore: true }),
  d(B.DEEPSTONE, 'deepstone', 8, 4, ['#45434f', '#35333e'], 'bricks', { durCost: 2 }),
  d(B.GOLD, 'gold', 12, 25, ['#45434f', '#ffd23f', '#e59a10'], 'ore', { ore: true, durCost: 2 }),
  d(B.RUBY, 'ruby', 14, 30, ['#45434f', '#ff3355', '#a3102a'], 'gem', { ore: true, durCost: 2 }),
  d(B.SAPPHIRE, 'sapphire', 14, 32, ['#45434f', '#3d7bff', '#1a3fa8'], 'gem', { ore: true, durCost: 2 }),
  d(B.BASALT, 'basalt', 18, 8, ['#3b3333', '#2a2323'], 'bricks', { durCost: 3 }),
  d(B.DIAMOND, 'diamond', 30, 60, ['#3b3333', '#6ff3f0', '#2ab7c4'], 'gem', { ore: true, durCost: 3 }),
  d(B.CRYSTAL, 'crystal', 25, 15, ['#3a3a66', '#5c5ca8'], 'bricks', { durCost: 3 }),
  d(B.AMETHYST, 'amethyst', 35, 50, ['#3a3a66', '#c77dff', '#7b2cbf'], 'gem', { ore: true, durCost: 4 }),
  d(B.EMERALD, 'emerald', 45, 110, ['#3a3a66', '#3dff8a', '#14a352'], 'gem', { ore: true, durCost: 4 }),
  d(B.OBSIDIAN, 'obsidian', 60, 25, ['#1c1029', '#3b1f5c'], 'plain', { durCost: 6, blastable: false }),
  d(B.VOIDSTONE, 'voidstone', 60, 30, ['#12121c', '#24243a'], 'bricks', { durCost: 5 }),
  d(B.STARORE, 'starore', 120, 300, ['#12121c', '#fff7a8', '#ffb3f5'], 'gem', { ore: true, durCost: 5 }),
  d(B.BEDROCK, 'bedrock', Infinity, 0, ['#2b2b2b', '#111111'], 'plain', { blastable: false }),
  d(B.WORKBENCH, 'workbench', 1, 0, ['#9c6b3a', '#d9a066', '#3d2814'], 'special', { special: 'workbench', durCost: 0 }),
  d(B.ANVIL, 'anvil', 1, 0, ['#5a5a66', '#9da0ad', '#2a2a30'], 'special', { special: 'anvil', durCost: 0 }),
  d(B.TNT, 'tnt', 1, 5, ['#d92b2b', '#f2f2f2', '#222'], 'special', { special: 'tnt', durCost: 0 }),
  d(B.CHEST, 'chest', 1, 0, ['#a8722f', '#ffd23f', '#5c3a12'], 'special', { special: 'chest', durCost: 0 }),
  d(B.FURNACE, 'furnace', 1, 0, ['#6b6b73', '#ff8c1a', '#2a2a30'], 'special', { special: 'furnace', durCost: 0 }),
  d(B.ENCHANT, 'enchant', 1, 0, ['#2a1840', '#c77dff', '#ff3355'], 'special', { special: 'enchant', durCost: 0 }),
  d(B.SLIME, 'slime', 3, 3, ['#6bd66b', '#9cff9c', '#3a9a3a'], 'special', { special: 'slime', durCost: 0 }),
  d(B.LUCKGEM, 'luckgem', 1, 0, ['#45434f', '#ff66d9', '#ffffff'], 'gem', { special: 'luckgem', durCost: 0 }),
  d(B.LAVA, 'lava', 0, 0, ['#ff5a00', '#ffb300'], 'liquid', { solid: false, liquid: true, blastable: false, durCost: 0 }),
  // ── world 2: Frost (HP/value continue the global depth curve, see WorldDef.offset; narrower base spread) ──
  d(B.SNOW, 'snow', 50, 3, ['#e8f1ff', '#ffffff', '#b8cde8'], 'grass'),
  d(B.ICE, 'ice', 55, 4, ['#9fd8ff', '#d9f2ff'], 'ice', { slippery: true }),
  d(B.PERMAFROST, 'permafrost', 50, 8, ['#5d6f86', '#8fb3d1'], 'bricks', { durCost: 2 }),
  d(B.BLUEICE, 'blueice', 50, 12, ['#3f8fe0', '#9fd8ff'], 'ice', { slippery: true, durCost: 3 }),
  d(B.FROSTSTONE, 'froststone', 50, 20, ['#34405e', '#5d79a8'], 'bricks', { durCost: 4 }),
  d(B.GLACIER, 'glacier', 65, 30, ['#1d4f8a', '#7cc8ff'], 'ice', { durCost: 6, blastable: false, slippery: true }),
  d(B.FROSTITE, 'frostite', 45, 40, ['#8fb3d1', '#6ff3f0', '#2ab7c4'], 'ore', { ore: true }),
  d(B.SILVER, 'silver', 50, 60, ['#5d6f86', '#f4f7ff', '#a9b6c9'], 'ore', { ore: true, durCost: 2 }),
  d(B.MITHRIL, 'mithril', 50, 140, ['#34405e', '#b6fff0', '#5fd6c0'], 'gem', { ore: true, durCost: 3 }),
  d(B.AURORITE, 'aurorite', 55, 260, ['#34405e', '#8affc1', '#c77dff'], 'gem', { ore: true, durCost: 4 }),
  d(B.ICEHEART, 'iceheart', 90, 650, ['#1d4f8a', '#ffffff', '#6ff3f0'], 'gem', { ore: true, durCost: 5 }),
  d(B.RIFT, 'rift', 1, 0, ['#0b2a4a', '#6ff3f0', '#ffffff'], 'special', { special: 'rift', durCost: 0 }),
  // ── world 3: Ruins ──
  d(B.SAND, 'sand', 70, 5, ['#e8c27a', '#f6dca0', '#c9a05a'], 'grass'),
  d(B.SANDSTONE, 'sandstone', 75, 7, ['#d6a35e', '#b88440'], 'bricks'),
  d(B.RUINBRICK, 'ruinbrick', 75, 12, ['#8a6a4a', '#6b4f36'], 'bricks', { durCost: 2 }),
  d(B.JADESTONE, 'jadestone', 85, 20, ['#2f5d4a', '#4f8a6e'], 'bricks', { durCost: 3 }),
  d(B.TEMPLESTONE, 'templestone', 110, 30, ['#4a3a5e', '#7a5f8f'], 'bricks', { durCost: 4 }),
  d(B.MONOLITH, 'monolith', 180, 40, ['#1e1a24', '#ffd23f'], 'plain', { durCost: 6, blastable: false }),
  d(B.RELICGOLD, 'relicgold', 70, 120, ['#b88440', '#ffd23f', '#ff9f1a'], 'ore', { ore: true }),
  d(B.JADE, 'jade', 75, 200, ['#6b4f36', '#3dff8a', '#14a352'], 'gem', { ore: true, durCost: 2 }),
  d(B.TOPAZ, 'topaz', 85, 350, ['#2f5d4a', '#ffb347', '#ff7a1a'], 'gem', { ore: true, durCost: 3 }),
  d(B.SUNSTONE, 'sunstone', 110, 600, ['#4a3a5e', '#fff2a8', '#ff7a1a'], 'gem', { ore: true, durCost: 4 }),
  d(B.RELIC, 'relic', 200, 1500, ['#1e1a24', '#ffd23f', '#ff66d9'], 'gem', { ore: true, durCost: 5 }),
  d(B.RUNE, 'rune', 1, 0, ['#2a1f3a', '#ffd23f', '#6ff3f0'], 'special', { special: 'rune', durCost: 0 }),
  d(B.CORE, 'core', 1, 0, ['#fff2a8', '#ff7ad9', '#ffffff'], 'special', { special: 'core', durCost: 0, blastable: false }),
];
for (const def of defs) BLOCKS[def.id] = def;

export function blockDef(id: number): BlockDef {
  return BLOCKS[id];
}

