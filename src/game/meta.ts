/**
 * Retention systems (pure logic, no DOM): player level, feature unlocks,
 * daily rewards, daily quests, achievements, chests, idle miners, collection.
 * See GAME_DESIGN.md §6.1–6.2.
 */
import { BLOCKS, B } from './blocks';
import { CAMPAIGN_DEPTH } from './config';
import { addCoins } from './economy';
import { Rng } from './rng';
import type { Quest, SaveData } from './save';

const HOUR = 3600_000;

/** Coin rewards scale with progress so they always feel like 1–2 runs of income. */
export function rewardScale(save: SaveData): number {
  return Math.round(60 * Math.pow(1 + save.bestDepth / 15, 1.9));
}

// ───────────────────────── level ─────────────────────────

export function xpForLevel(level: number): number {
  return Math.round(40 * Math.pow(level, 1.6));
}

export function runXp(blocks: number, depthGained: number): number {
  return Math.round(blocks + depthGained * 3);
}

export interface Reward {
  coins?: number;
  gems?: number;
  dynamite?: number;
  totems?: number;
  chest?: ChestRarity;
}

export function levelReward(save: SaveData, level: number): Reward {
  return { gems: 2 + Math.floor(level / 5), coins: Math.round(rewardScale(save) * 0.5) };
}

/** Adds xp; returns the list of levels reached (rewards are granted). */
export function addXp(save: SaveData, xp: number): number[] {
  save.xp += xp;
  const reached: number[] = [];
  while (save.xp >= xpForLevel(save.level)) {
    save.xp -= xpForLevel(save.level);
    save.level++;
    reached.push(save.level);
    grant(save, levelReward(save, save.level));
  }
  return reached;
}

export type Feature = 'upgrades' | 'forge' | 'quests' | 'collection' | 'items' | 'freeChest' | 'idle' | 'achievements' | 'daily';

export const FEATURE_LEVEL: Record<Feature, number> = {
  upgrades: 1,
  daily: 2,
  forge: 2,
  quests: 2,
  collection: 2,
  items: 3,
  freeChest: 3,
  idle: 3,
  achievements: 4,
};

export function unlocked(save: SaveData, f: Feature): boolean {
  return save.level >= FEATURE_LEVEL[f];
}

// ───────────────────────── rewards / chests ─────────────────────────

export type ChestRarity = 'common' | 'rare' | 'epic' | 'legendary';
export const RARITIES: ChestRarity[] = ['common', 'rare', 'epic', 'legendary'];

export function rollRarity(rng: Rng): ChestRarity {
  return rng.weighted([
    { item: 'common' as const, w: 60 },
    { item: 'rare' as const, w: 28 },
    { item: 'epic' as const, w: 10 },
    { item: 'legendary' as const, w: 2 },
  ]);
}

export function chestContents(save: SaveData, rarity: ChestRarity, rng: Rng): Reward {
  const s = rewardScale(save);
  const i = RARITIES.indexOf(rarity);
  return {
    coins: Math.round(s * [1, 3, 8, 20][i] * rng.range(0.85, 1.25)),
    gems: [rng.int(0, 1), rng.int(2, 3), rng.int(5, 8), rng.int(15, 25)][i],
    dynamite: [rng.int(0, 1), 1, 2, 3][i],
    totems: rarity === 'legendary' ? 1 : rarity === 'epic' && rng.chance(0.3) ? 1 : 0,
  };
}

export function grant(save: SaveData, r: Reward): void {
  if (r.coins) addCoins(save, r.coins);
  if (r.gems) save.gems += r.gems;
  if (r.dynamite) save.dynamite += r.dynamite;
  if (r.totems) save.totems += r.totems;
}

export const FREE_CHEST_COOLDOWN = 4 * HOUR;

export function freeChestReady(save: SaveData, now: number): boolean {
  return now >= save.freeChestAt;
}

export function openFreeChest(save: SaveData, now: number, rng: Rng): { rarity: ChestRarity; reward: Reward } | null {
  if (!freeChestReady(save, now)) return null;
  save.freeChestAt = now + FREE_CHEST_COOLDOWN;
  const rarity = rollRarity(rng);
  const reward = chestContents(save, rarity, rng);
  grant(save, reward);
  return { rarity, reward };
}

/** Opens a chest of a fixed rarity (daily reward, quest bonus). */
export function openChest(save: SaveData, rarity: ChestRarity, rng: Rng): Reward {
  const reward = chestContents(save, rarity, rng);
  grant(save, reward);
  return reward;
}

// ───────────────────────── daily login ─────────────────────────

export function dayKey(now: number): string {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function prevDayKey(now: number): string {
  const d = new Date(now);
  d.setDate(d.getDate() - 1);
  return dayKey(d.getTime());
}

/** 7-day cycle. Coins are multiples of rewardScale. */
export const DAILY: Reward[] = [
  { coins: 1 },
  { dynamite: 2 },
  { coins: 2 },
  { gems: 5 },
  { coins: 3 },
  { totems: 1 },
  { chest: 'epic' },
];

export interface DailyStatus {
  /** Index 0..6 of the reward that is (or will be) claimable today. */
  index: number;
  canClaim: boolean;
}

export function dailyStatus(save: SaveData, now: number): DailyStatus {
  const today = dayKey(now);
  if (save.dailyLast === today) return { index: (save.dailyStreak - 1 + 7) % 7, canClaim: false };
  const continues = save.dailyLast === prevDayKey(now);
  return { index: continues ? save.dailyStreak % 7 : 0, canClaim: true };
}

export function claimDaily(save: SaveData, now: number, rng: Rng): { index: number; reward: Reward } | null {
  const st = dailyStatus(save, now);
  if (!st.canClaim) return null;
  const tpl = DAILY[st.index];
  const reward: Reward = { ...tpl };
  if (tpl.coins) reward.coins = tpl.coins * rewardScale(save);
  if (tpl.chest) {
    Object.assign(reward, chestContents(save, tpl.chest, rng));
    grant(save, { ...reward, chest: undefined });
  } else grant(save, reward);
  save.dailyStreak = st.index + 1;
  save.dailyLast = dayKey(now);
  return { index: st.index, reward };
}

// ───────────────────────── quests ─────────────────────────

export type QuestType = 'blocks' | 'depth' | 'tnt' | 'chests' | 'combo' | 'tierUps' | 'ores' | 'runs' | 'dynamite' | 'upgrade' | 'coins';

/** Per-run quest progress snapshot. `best` types use max, others are summed. */
export interface QuestProgress {
  blocks: number;
  depth: number;
  tnt: number;
  chests: number;
  combo: number;
  tierUps: number;
  ores: number;
  runs: number;
  dynamite: number;
  upgrade: number;
  coins: number;
}

const BEST_TYPES: QuestType[] = ['depth', 'combo'];

function round5(n: number): number {
  return Math.max(5, Math.round(n / 5) * 5);
}

export function questTarget(save: SaveData, type: QuestType): number {
  const L = save.level;
  switch (type) {
    case 'blocks':
      return round5(120 + 40 * L);
    case 'depth':
      return Math.min(CAMPAIGN_DEPTH, Math.max(10, round5(save.bestDepth * 0.85)));
    case 'tnt':
      return 3 + Math.floor(L / 3);
    case 'chests':
      return 1 + Math.floor(L / 6);
    case 'combo':
      return Math.min(150, round5(15 + 4 * L));
    case 'tierUps':
      return 1 + Math.floor(L / 5);
    case 'ores':
      return round5(15 + 6 * L);
    case 'runs':
      return 5;
    case 'dynamite':
      return 2 + Math.floor(L / 6);
    case 'upgrade':
      return 3;
    case 'coins':
      return round5(rewardScale(save) * 4);
  }
}

export function questReward(save: SaveData, q: Quest): Reward {
  const hard = q.type === 'depth' || q.type === 'combo' || q.type === 'tierUps';
  return { coins: Math.round(rewardScale(save) * (hard ? 2 : 1.5)), gems: hard ? 2 : 1 };
}

const QUEST_POOL: QuestType[] = ['blocks', 'depth', 'tnt', 'chests', 'combo', 'tierUps', 'ores', 'runs', 'dynamite', 'upgrade', 'coins'];

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function makeQuests(save: SaveData, seed: number, avoid: QuestType[] = []): Quest[] {
  const rng = new Rng(seed);
  const pool = QUEST_POOL.filter((t) => !avoid.includes(t) && !(t === 'tierUps' && save.level < 2));
  const out: Quest[] = [];
  while (out.length < 3 && pool.length) {
    const type = pool.splice(Math.floor(rng.next() * pool.length), 1)[0];
    out.push({ type, target: questTarget(save, type), progress: 0, claimed: false });
  }
  return out;
}

/** Make sure today's quests exist; returns the state. */
export function ensureQuests(save: SaveData, now: number): SaveData['quests'] {
  const day = dayKey(now);
  if (save.quests.day !== day) {
    save.quests = { day, list: makeQuests(save, hashStr(day) ^ save.runs), bonusClaimed: false, rerolled: false };
  }
  return save.quests;
}

export function rerollQuest(save: SaveData, index: number, now: number): boolean {
  const qs = ensureQuests(save, now);
  const q = qs.list[index];
  if (!q || q.claimed || qs.rerolled) return false;
  const fresh = makeQuests(save, hashStr(qs.day + index) ^ (now & 0xffff), qs.list.map((x) => x.type as QuestType));
  if (!fresh.length) return false;
  qs.list[index] = fresh[0];
  qs.rerolled = true;
  return true;
}

/** Apply progress; returns quests that became complete in this update. */
export function trackQuests(save: SaveData, p: Partial<QuestProgress>, now: number): Quest[] {
  const qs = ensureQuests(save, now);
  const done: Quest[] = [];
  for (const q of qs.list) {
    if (q.claimed || q.progress >= q.target) continue;
    const v = p[q.type as QuestType];
    if (!v) continue;
    q.progress = BEST_TYPES.includes(q.type as QuestType) ? Math.max(q.progress, v) : q.progress + v;
    if (q.progress >= q.target) {
      q.progress = q.target;
      done.push(q);
    }
  }
  return done;
}

export function claimQuest(save: SaveData, index: number, now: number): Reward | null {
  const qs = ensureQuests(save, now);
  const q = qs.list[index];
  if (!q || q.claimed || q.progress < q.target) return null;
  q.claimed = true;
  const r = questReward(save, q);
  grant(save, r);
  return r;
}

export function questBonusReady(save: SaveData): boolean {
  return !save.quests.bonusClaimed && save.quests.list.length > 0 && save.quests.list.every((q) => q.claimed);
}

export function claimQuestBonus(save: SaveData, rng: Rng): Reward | null {
  if (!questBonusReady(save)) return null;
  save.quests.bonusClaimed = true;
  return { ...openChest(save, 'rare', rng), chest: 'rare' };
}

export function questsClaimable(save: SaveData): number {
  return save.quests.list.filter((q) => !q.claimed && q.progress >= q.target).length + (questBonusReady(save) ? 1 : 0);
}

// ───────────────────────── collection ─────────────────────────

export const COLLECTIBLE = BLOCKS.filter((b) => b && b.id !== B.AIR && b.id !== B.LAVA && b.id !== B.BEDROCK).map((b) => b.key);

export function discoveryGems(key: string): number {
  const def = BLOCKS.find((b) => b?.key === key);
  if (!def) return 0;
  return def.special || def.value >= 50 ? 2 : 1;
}

// ───────────────────────── achievements ─────────────────────────

export interface AchievementDef {
  id: string;
  icon: string;
  tiers: number[];
  value: (s: SaveData) => number;
}

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'blocks', icon: 'pickaxe', tiers: [100, 1000, 10000, 100000, 1000000], value: (s) => s.blocksBroken },
  { id: 'depth', icon: 'down', tiers: [20, 100, 250, 450, 700, 1000], value: (s) => s.bestDepth },
  { id: 'tnt', icon: 'bomb', tiers: [10, 100, 1000, 10000], value: (s) => s.life.tnt },
  { id: 'chests', icon: 'chest', tiers: [5, 50, 500], value: (s) => s.life.chests },
  { id: 'combo', icon: 'fire', tiers: [25, 50, 100, 200], value: (s) => s.life.maxCombo },
  { id: 'tierUps', icon: 'hammer', tiers: [1, 10, 100, 1000], value: (s) => s.life.tierUps },
  { id: 'runs', icon: 'play', tiers: [10, 100, 500, 2000], value: (s) => s.runs },
  { id: 'coins', icon: 'coin', tiers: [1000, 100000, 10000000, 1000000000], value: (s) => s.totalCoins },
  { id: 'collection', icon: 'book', tiers: [10, 20, COLLECTIBLE.length], value: (s) => s.discovered.length },
];

export function achievementGems(tier: number): number {
  return [3, 5, 10, 20, 35, 50][tier] ?? 50;
}

export function achievementClaimable(save: SaveData, a: AchievementDef): boolean {
  const claimed = save.achievements[a.id] ?? 0;
  return claimed < a.tiers.length && a.value(save) >= a.tiers[claimed];
}

export function claimAchievement(save: SaveData, id: string): number {
  const a = ACHIEVEMENTS.find((x) => x.id === id);
  if (!a || !achievementClaimable(save, a)) return 0;
  const tier = save.achievements[id] ?? 0;
  save.achievements[id] = tier + 1;
  const gems = achievementGems(tier);
  save.gems += gems;
  return gems;
}

export function achievementsClaimable(save: SaveData): number {
  return ACHIEVEMENTS.filter((a) => achievementClaimable(save, a)).length;
}

// ───────────────────────── idle miners ─────────────────────────

export const IDLE_CAP_HOURS = 8;

export function idleRatePerHour(save: SaveData): number {
  return save.bestDepth < 20 ? 0 : Math.round(rewardScale(save) * 0.6);
}

export function idlePending(save: SaveData, now: number): number {
  if (!save.idleLast) return 0;
  const hours = Math.min(IDLE_CAP_HOURS, Math.max(0, now - save.idleLast) / HOUR);
  return Math.floor(hours * idleRatePerHour(save));
}

export function idleFull(save: SaveData, now: number): number {
  if (!save.idleLast) return 0;
  return Math.min(1, (now - save.idleLast) / HOUR / IDLE_CAP_HOURS);
}

/** Starts the miners on first unlock; collects otherwise. Returns coins collected. */
export function collectIdle(save: SaveData, now: number): number {
  if (!save.idleLast) {
    save.idleLast = now;
    return 0;
  }
  const coins = idlePending(save, now);
  save.idleLast = now;
  if (coins > 0) addCoins(save, coins);
  return coins;
}
