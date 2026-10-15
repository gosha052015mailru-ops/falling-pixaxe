import { UPGRADES, type UpgradeId } from './config';

export const SAVE_VERSION = 2;
const KEY = 'falling-pickaxe-save';

export interface Settings {
  sound: boolean;
  vibration: boolean;
  lang: 'ru' | 'en' | 'auto';
  shake: boolean;
  particles: 'high' | 'low';
}

export interface LifetimeStats {
  tnt: number;
  chests: number;
  tierUps: number;
  ores: number;
  maxCombo: number;
  dynamiteUsed: number;
  fevers: number;
  upgradesBought: number;
}

export interface Quest {
  type: string;
  target: number;
  progress: number;
  claimed: boolean;
}

export interface QuestState {
  day: string;
  list: Quest[];
  bonusClaimed: boolean;
  rerolled: boolean;
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
  // ── v2: retention ──
  xp: number;
  level: number;
  life: LifetimeStats;
  /** Last day a daily reward was claimed and the streak length (days claimed in a row). */
  dailyLast: string;
  dailyStreak: number;
  quests: QuestState;
  /** Achievement id → number of tiers already claimed. */
  achievements: Record<string, number>;
  /** Epoch ms when the next free chest is available. */
  freeChestAt: number;
  /** Epoch ms of the last idle-miners collection (0 = not started). */
  idleLast: number;
  tutorialDone: boolean;
  upgradeHintDone: boolean;
  /** Latest wall-clock time seen; guards timers against the device clock being moved back. */
  lastSeen: number;
}

export function freshLife(): LifetimeStats {
  return { tnt: 0, chests: 0, tierUps: 0, ores: 0, maxCombo: 0, dynamiteUsed: 0, fevers: 0, upgradesBought: 0 };
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
    settings: { sound: true, vibration: true, lang: 'auto', shake: true, particles: 'high' },
    xp: 0,
    level: 1,
    life: freshLife(),
    dailyLast: '',
    dailyStreak: 0,
    quests: { day: '', list: [], bonusClaimed: false, rerolled: false },
    achievements: {},
    freeChestAt: 0,
    idleLast: 0,
    tutorialDone: false,
    upgradeHintDone: false,
    lastSeen: 0,
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
  out.life = { ...base.life, ...(r.life ?? {}) };
  out.achievements = { ...(r.achievements ?? {}) };
  out.quests = r.quests && Array.isArray(r.quests.list) ? r.quests : base.quests;
  // v1 players already know how to play
  if (r.version === 1 && (r.runs ?? 0) > 0) out.tutorialDone = true;
  for (const k of ['coins', 'gems', 'cycleCoins', 'totalCoins', 'forgeTier', 'dynamite', 'totems', 'bestDepth', 'startDepth', 'shards', 'xp', 'level', 'freeChestAt', 'idleLast', 'dailyStreak', 'lastSeen'] as const) {
    if (typeof out[k] !== 'number' || !Number.isFinite(out[k])) out[k] = base[k];
  }
  return out;
}

const BACKUP = KEY + '.bak';

/** Loads the save; if the main slot is corrupted, falls back to the backup slot. */
export function loadSave(storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage): SaveData {
  for (const key of [KEY, BACKUP]) {
    try {
      const txt = storage?.getItem(key);
      if (txt) return migrate(JSON.parse(txt));
    } catch {
      /* try the next slot */
    }
  }
  return newSave();
}

/** Writes the save; the previous good copy is kept as a backup. */
export function writeSave(save: SaveData, storage: Pick<Storage, 'setItem' | 'getItem'> | undefined = globalThis.localStorage): void {
  try {
    const prev = storage?.getItem(KEY);
    if (prev) storage?.setItem(BACKUP, prev);
    storage?.setItem(KEY, JSON.stringify(save));
  } catch {
    /* storage full or unavailable — game continues in memory */
  }
}

/** Monotonic "now" for timers: never earlier than the latest time this save has seen. */
export function clockNow(save: SaveData, wall = Date.now()): number {
  if (wall > save.lastSeen) save.lastSeen = wall;
  return save.lastSeen;
}
