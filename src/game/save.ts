import { UPGRADES, type UpgradeId } from './config';

export const SAVE_VERSION = 1;
const KEY = 'falling-pickaxe-save';

export interface Settings {
  sound: boolean;
  vibration: boolean;
  lang: 'ru' | 'en' | 'auto';
}

export interface SaveData {
  version: number;
  coins: number;
  gems: number;
  /** Coins earned since the last prestige (drives shard formula). */
  cycleCoins: number;
  totalCoins: number;
  upgrades: Record<UpgradeId, number>;
  forgeTier: number;
  dynamite: number;
  dynamiteBoughtToday: number;
  dynamiteDay: string;
  totems: number;
  bestDepth: number;
  /** Deepest depth ever reached across all cycles (milestones only pay once). */
  milestones: number[];
  startDepth: number;
  shards: number;
  prestiges: number;
  coreReached: boolean;
  runs: number;
  blocksBroken: number;
  discovered: string[];
  settings: Settings;
}

export function freshUpgrades(): Record<UpgradeId, number> {
  const u = {} as Record<UpgradeId, number>;
  for (const def of UPGRADES) u[def.id] = 0;
  return u;
}

export function newSave(): SaveData {
  return {
    version: SAVE_VERSION,
    coins: 0,
    gems: 0,
    cycleCoins: 0,
    totalCoins: 0,
    upgrades: freshUpgrades(),
    forgeTier: 0,
    dynamite: 1,
    dynamiteBoughtToday: 0,
    dynamiteDay: '',
    totems: 0,
    bestDepth: 0,
    milestones: [],
    startDepth: 0,
    shards: 0,
    prestiges: 0,
    coreReached: false,
    runs: 0,
    blocksBroken: 0,
    discovered: [],
    settings: { sound: true, vibration: true, lang: 'auto' },
  };
}

/** Merge a possibly old/partial save onto defaults so new fields always exist. */
export function migrate(raw: unknown): SaveData {
  const base = newSave();
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Partial<SaveData>;
  const out: SaveData = { ...base, ...r, version: SAVE_VERSION };
  out.upgrades = { ...base.upgrades, ...(r.upgrades ?? {}) };
  out.settings = { ...base.settings, ...(r.settings ?? {}) };
  out.milestones = Array.isArray(r.milestones) ? r.milestones : [];
  out.discovered = Array.isArray(r.discovered) ? r.discovered : [];
  for (const k of ['coins', 'gems', 'cycleCoins', 'totalCoins', 'forgeTier', 'dynamite', 'totems', 'bestDepth', 'startDepth', 'shards'] as const) {
    if (typeof out[k] !== 'number' || !Number.isFinite(out[k])) out[k] = base[k];
  }
  return out;
}

export function loadSave(storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage): SaveData {
  try {
    const txt = storage?.getItem(KEY);
    return migrate(txt ? JSON.parse(txt) : null);
  } catch {
    return newSave();
  }
}

export function writeSave(save: SaveData, storage: Pick<Storage, 'setItem'> | undefined = globalThis.localStorage): void {
  try {
    storage?.setItem(KEY, JSON.stringify(save));
  } catch {
    /* storage full or unavailable — game continues in memory */
  }
}
