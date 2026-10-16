import { UPGRADES, type BoostId, type UpgradeId } from './config';
import { freshProfile, type Profile } from './profile';

export const SAVE_VERSION = 2;
const KEY = 'falling-pickaxe-save';

export interface Settings {
  sound: boolean;
  vibration: boolean;
  lang: 'ru' | 'en' | 'auto';
  shake: boolean;
  particles: 'high' | 'low';
  music: boolean;
  /** 'groove' = upbeat (default), 'calm' = ambient. */
  musicStyle: 'groove' | 'calm';
  notifications: boolean;
  /** In-run power-up panel expanded (true) or folded into one button. */
  boostsOpen: boolean;
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

/** A mission from the endless pool (see meta.ts). */
export interface Mission {
  /** Template key, e.g. 'blocks' or 'ore:iron'. */
  type: string;
  /** 'run' = in a single run, 'total' = summed over runs. */
  scope: 'run' | 'total';
  target: number;
  progress: number;
  reward: { coins?: number; gems?: number; boost?: BoostId; n?: number };
}

export interface MissionState {
  list: Mission[];
  /** Missions completed so far: drives difficulty (3 per run early → ~0–1 later). */
  done: number;
  /** Running per-run averages of each metric (targets are built from them). */
  avg: Record<string, number>;
  /** Day of the last free skip. */
  skipDay: string;
}

export interface QuestState {
  day: string;
  list: Quest[];
  bonusClaimed: boolean;
  rerolled: boolean;
}

/** Per-world campaign progress (the active world's copy lives in the top-level fields). */
export interface WorldSave {
  bestDepth: number;
  milestones: number[];
  liftStops: number[];
  startDepth: number;
  coreReached: boolean;
}

export function freshWorldSave(): WorldSave {
  return { bestDepth: 0, milestones: [], liftStops: [], startDepth: 0, coreReached: false };
}

export type DifficultyChoice = 'easy' | 'normal' | 'hard' | '';

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
  /** '' = not chosen yet (asked on first launch). */
  difficulty: DifficultyChoice;
  profile: Profile;
  /** Mega upgrades (levels). */
  pickSize: number;
  shaftWidth: number;
  /** Bought elevator stops (depths). */
  liftStops: number[];
  /** The one-time explanation of the nudge-charges panel was shown. */
  hintNudgeDone: boolean;
  /** The one-time explanation of the mine-event meter was shown. */
  hintEventsDone: boolean;
  /** The soft "may we remind you?" question was shown (never nag twice). */
  pushAsked: boolean;
  /** Breakthrough-down level (0 = not bought). */
  dashDown: number;
  /** Power-ups owned (dynamite is kept in `dynamite`). */
  boosts: Record<Exclude<BoostId, 'dynamite'>, number>;
  /** Power-ups taken into the next run (max 3). */
  loadout: BoostId[];
  missions: MissionState;
  hintDownDone: boolean;
  hintBoostsDone: boolean;
  /** Active world (0 = Earth, 1 = Frost, 2 = Ruins). bestDepth & co. belong to it. */
  world: number;
  /** How many worlds are open (a world opens at the previous world's Core). */
  worldsOpen: number;
  /** Stored progress of every world; the active one is refreshed on switch/save. */
  worldSaves: WorldSave[];
  /** Worlds whose "new world" welcome was already shown. */
  worldIntro: number[];
}

export function freshMissions(): MissionState {
  return { list: [], done: 0, avg: {}, skipDay: '' };
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
    settings: { sound: true, vibration: true, lang: 'auto', shake: true, particles: 'high', music: true, musicStyle: 'groove', notifications: true, boostsOpen: true },
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
    difficulty: '',
    profile: freshProfile(),
    pickSize: 0,
    shaftWidth: 0,
    liftStops: [],
    hintNudgeDone: false,
    hintEventsDone: false,
    pushAsked: false,
    dashDown: 0,
    boosts: { giant: 0, twin: 0, teleport: 0, shield: 0, lightning: 0, blackhole: 0, rockets: 0, laser: 0, phantom: 0, magnet: 0, meteor: 0 },
    loadout: ['dynamite'],
    missions: freshMissions(),
    hintDownDone: false,
    hintBoostsDone: false,
    world: 0,
    worldsOpen: 1,
    worldSaves: [freshWorldSave(), freshWorldSave(), freshWorldSave()],
    worldIntro: [0],
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
  out.profile = { ...base.profile, ...(r.profile ?? {}) };
  // the elevator used to be free: keep every stop an existing player could already use
  if (!Array.isArray(r.liftStops)) out.liftStops = [20, 100, 250, 450, 700].filter((d) => (r.bestDepth ?? 0) >= d);
  out.achievements = { ...(r.achievements ?? {}) };
  out.boosts = { ...base.boosts, ...(r.boosts ?? {}) };
  // the five newer power-ups: a starter gift for players who already had power-ups unlocked
  if (r.boosts && !('lightning' in r.boosts) && (r.level ?? 0) >= 4) {
    for (const k of ['lightning', 'blackhole', 'rockets', 'laser', 'phantom'] as const) out.boosts[k] = 2;
  }
  out.loadout = Array.isArray(r.loadout) ? r.loadout : base.loadout;
  out.missions = r.missions && Array.isArray(r.missions.list) ? { ...base.missions, ...r.missions } : base.missions;
  out.quests = r.quests && Array.isArray(r.quests.list) ? r.quests : base.quests;
  out.worldSaves = base.worldSaves.map((w, i) => ({ ...w, ...(Array.isArray(r.worldSaves) ? r.worldSaves[i] ?? {} : {}) }));
  out.worldIntro = Array.isArray(r.worldIntro) ? r.worldIntro : base.worldIntro;
  // players who already beat the Core before worlds existed get the Frost world right away
  if (r.coreReached && (r.worldsOpen ?? 1) < 2) out.worldsOpen = 2;
  // v1 players already know how to play
  if (r.version === 1 && (r.runs ?? 0) > 0) out.tutorialDone = true;
  // existing players keep the balance they were playing with
  if (!r.difficulty && (r.runs ?? 0) > 0) out.difficulty = 'normal';
  for (const k of ['coins', 'gems', 'cycleCoins', 'totalCoins', 'forgeTier', 'dynamite', 'totems', 'bestDepth', 'startDepth', 'shards', 'xp', 'level', 'freeChestAt', 'idleLast', 'dailyStreak', 'lastSeen', 'pickSize', 'shaftWidth', 'dashDown', 'world', 'worldsOpen'] as const) {
    if (typeof out[k] !== 'number' || !Number.isFinite(out[k])) out[k] = base[k];
  }
  out.worldsOpen = Math.max(1, Math.min(3, out.worldsOpen));
  out.world = Math.max(0, Math.min(out.worldsOpen - 1, out.world));
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

/** Every key the game stores (save, backup, analytics journal). */
export const STORAGE_KEYS = [KEY, BACKUP, 'falling-pickaxe-analytics'];

/** Wipes all progress. The caller must stop saving afterwards (see App.resetProgress). */
export function wipeStorage(storage: Pick<Storage, 'removeItem'> | undefined = globalThis.localStorage): void {
  for (const k of STORAGE_KEYS) {
    try {
      storage?.removeItem(k);
    } catch {
      /* ignore */
    }
  }
}

/** Monotonic "now" for timers: never earlier than the latest time this save has seen. */
export function clockNow(save: SaveData, wall = Date.now()): number {
  if (wall > save.lastSeen) save.lastSeen = wall;
  return save.lastSeen;
}
