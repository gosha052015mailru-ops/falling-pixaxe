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
  | 'core';

export type TextureStyle = 'plain' | 'grass' | 'ore' | 'gem' | 'special' | 'liquid' | 'bricks';

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

export const BLOCKS: BlockDef[] = [];
const defs: BlockDef[] = [
  d(B.AIR, 'air', 0, 0, ['#000', '#000'], 'plain', { solid: false, blastable: false }),
  d(B.GRASS, 'grass', 1, 1, ['#7a5230', '#4caf3a', '#3a8a2c'], 'grass'),
  d(B.DIRT, 'dirt', 1, 1, ['#7a5230', '#5e3d22'], 'plain'),
  d(B.CLAY, 'clay', 2, 2, ['#9aa3b5', '#7f889b'], 'plain'),
  d(B.STONE, 'stone', 3, 2, ['#7d7d85', '#64646c'], 'plain'),
  d(B.COAL, 'coal', 4, 6, ['#7d7d85', '#1d1d22', '#3a3a40'], 'ore', { ore: true }),
  d(B.COPPER, 'copper', 5, 10, ['#7d7d85', '#e07a3c', '#3fae8e'], 'ore', { ore: true }),
  d(B.IRON, 'iron', 8, 18, ['#7d7d85', '#e3c3a5', '#b98f6d'], 'ore', { ore: true }),
  d(B.DEEPSTONE, 'deepstone', 8, 4, ['#45434f', '#35333e'], 'bricks'),
  d(B.GOLD, 'gold', 12, 25, ['#45434f', '#ffd23f', '#e59a10'], 'ore', { ore: true }),
  d(B.RUBY, 'ruby', 14, 30, ['#45434f', '#ff3355', '#a3102a'], 'gem', { ore: true }),
  d(B.SAPPHIRE, 'sapphire', 14, 32, ['#45434f', '#3d7bff', '#1a3fa8'], 'gem', { ore: true }),
  d(B.BASALT, 'basalt', 18, 8, ['#3b3333', '#2a2323'], 'bricks'),
  d(B.DIAMOND, 'diamond', 30, 60, ['#3b3333', '#6ff3f0', '#2ab7c4'], 'gem', { ore: true }),
  d(B.CRYSTAL, 'crystal', 25, 15, ['#3a3a66', '#5c5ca8'], 'bricks'),
  d(B.AMETHYST, 'amethyst', 35, 50, ['#3a3a66', '#c77dff', '#7b2cbf'], 'gem', { ore: true }),
  d(B.EMERALD, 'emerald', 45, 110, ['#3a3a66', '#3dff8a', '#14a352'], 'gem', { ore: true }),
  d(B.OBSIDIAN, 'obsidian', 60, 25, ['#1c1029', '#3b1f5c'], 'plain', { durCost: 3, blastable: false }),
  d(B.VOIDSTONE, 'voidstone', 60, 30, ['#12121c', '#24243a'], 'bricks'),
  d(B.STARORE, 'starore', 120, 300, ['#12121c', '#fff7a8', '#ffb3f5'], 'gem', { ore: true }),
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
  d(B.CORE, 'core', 1, 0, ['#fff2a8', '#ff7ad9', '#ffffff'], 'special', { special: 'core', durCost: 0, blastable: false }),
];
for (const def of defs) BLOCKS[def.id] = def;

export function blockDef(id: number): BlockDef {
  return BLOCKS[id];
}
