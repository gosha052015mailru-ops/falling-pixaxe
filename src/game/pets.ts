/**
 * Pets (unlock at level 7): a companion flies next to the pickaxe and helps in every run.
 * Pets hatch from eggs (gems / level rewards); duplicates level the pet up (1–5).
 * See GAME_DESIGN.md §6.14.
 */
import type { Rng } from './rng';
import type { SaveData } from './save';

export type PetId = 'mole' | 'cat' | 'turtle' | 'magpie' | 'fairy' | 'dragon';
export type PetRarity = 'common' | 'rare' | 'epic' | 'legendary';

export interface PetDef {
  rarity: PetRarity;
  /** Main colour (UI frames, effects). */
  color: string;
}

export const PET_IDS: PetId[] = ['mole', 'cat', 'turtle', 'magpie', 'fairy', 'dragon'];

export const PETS: Record<PetId, PetDef> = {
  mole: { rarity: 'common', color: '#a0785a' },
  cat: { rarity: 'common', color: '#ffb347' },
  turtle: { rarity: 'rare', color: '#5ec46a' },
  magpie: { rarity: 'rare', color: '#5ab0ff' },
  fairy: { rarity: 'epic', color: '#ff7ad9' },
  dragon: { rarity: 'legendary', color: '#ff5a3c' },
};

/** Player level that opens pets. */
export const PET_LEVEL = 7;
export const PET_MAX_LEVEL = 5;
/** Duplicates needed to go from level n to n+1 (index n-1). */
export const PET_DUPES = [1, 2, 3, 4];
export const RARITY_COLOR: Record<PetRarity, string> = { common: '#b9b4cc', rare: '#5ab0ff', epic: '#c77dff', legendary: '#ffd23f' };

export const EGG = {
  /** Price in gems. */
  price: 40,
  weights: { common: 55, rare: 30, epic: 12, legendary: 3 } as Record<PetRarity, number>,
};

export interface PetPower {
  /** Seconds between uses (active pets). */
  every?: number;
  blocks?: number;
  coins?: number;
  wear?: number;
  reach?: number;
  heal?: number;
  depth?: number;
}

/** Ability numbers for a pet at a level (1–5). */
export function petPower(id: PetId, lvl: number): PetPower {
  const k = Math.max(0, Math.min(PET_MAX_LEVEL, lvl) - 1);
  switch (id) {
    case 'mole':
      // digs the blocks right under the pickaxe
      return { every: 3.5 - 0.4 * k, blocks: 2 + Math.floor(k / 2) };
    case 'cat':
      // finds coins: a share more of everything mined
      return { coins: 0.08 + 0.04 * k };
    case 'turtle':
      // the pickaxe wears less
      return { wear: 0.1 + 0.05 * k };
    case 'magpie':
      // steals the nearest ore
      return { every: 4 - 0.5 * k, reach: 5 };
    case 'fairy':
      // heals the pickaxe now and then
      return { every: 18 - 2 * k, heal: 0.06 + 0.015 * k };
    case 'dragon':
      // breathes fire straight down
      return { every: 7 - 0.75 * k, depth: 3 + Math.floor(k / 2) };
  }
}

export interface PetState {
  lvl: number;
  /** Duplicates collected toward the next level. */
  dup: number;
}

export function petLevel(save: SaveData, id: PetId): number {
  return save.pets[id]?.lvl ?? 0;
}

export function ownedPets(save: SaveData): PetId[] {
  return PET_IDS.filter((id) => petLevel(save, id) > 0);
}

/** Give a pet (a hatch): new → level 1, duplicate → toward the next level. Returns whether it levelled up. */
export function addPet(save: SaveData, id: PetId): { isNew: boolean; levelUp: boolean } {
  const cur = save.pets[id];
  if (!cur || cur.lvl <= 0) {
    save.pets[id] = { lvl: 1, dup: 0 };
    if (!save.pet) save.pet = id;
    return { isNew: true, levelUp: false };
  }
  if (cur.lvl >= PET_MAX_LEVEL) {
    // a maxed pet turns into gems
    save.gems += Math.round(EGG.price / 2);
    return { isNew: false, levelUp: false };
  }
  cur.dup++;
  if (cur.dup >= PET_DUPES[cur.lvl - 1]) {
    cur.dup = 0;
    cur.lvl++;
    return { isNew: false, levelUp: true };
  }
  return { isNew: false, levelUp: false };
}

export function rollPet(rng: Rng): PetId {
  const rarity = rng.weighted((Object.keys(EGG.weights) as PetRarity[]).map((item) => ({ item, w: EGG.weights[item] })));
  const pool = PET_IDS.filter((id) => PETS[id].rarity === rarity);
  return pool[rng.int(0, pool.length - 1)];
}

/** Open one egg from the stock. */
export function hatchEgg(save: SaveData, rng: Rng): { id: PetId; isNew: boolean; levelUp: boolean } | null {
  if (save.eggs <= 0) return null;
  save.eggs--;
  const id = rollPet(rng);
  return { id, ...addPet(save, id) };
}

export function buyEgg(save: SaveData): boolean {
  if (save.gems < EGG.price) return false;
  save.gems -= EGG.price;
  save.eggs++;
  return true;
}

export function equipPet(save: SaveData, id: PetId | ''): boolean {
  if (id && petLevel(save, id) <= 0) return false;
  save.pet = id;
  return true;
}

/** The pet that comes along in the next run. */
export function runPet(save: SaveData): { id: PetId; lvl: number } | undefined {
  const id = save.pet;
  if (!id) return undefined;
  const lvl = petLevel(save, id);
  return lvl > 0 ? { id, lvl } : undefined;
}
