/**
 * Retention systems (pure logic, no DOM): player level, feature unlocks,
 * daily rewards, daily quests, achievements, chests, idle miners, collection.
 * See GAME_DESIGN.md §6.1–6.2.
 */
import { BLOCKS, B } from './blocks';
import { BOOST_IDS, DASH_DOWN, type BoostId } from './config';
import { addBoost, addCoins, globalBest, niceRound, rewardScale } from './economy';
import type { RunResult } from './run';
import { Rng } from './rng';
import { dayKey } from './time';
import type { Mission, SaveData } from './save';

const HOUR = 3600_000;

export { rewardScale };

// ───────────────────────── level ─────────────────────────

/** Level 1→2 takes ~3 early runs; later levels take a handful of runs each. */
export function xpForLevel(level: number): number {
  return Math.round(250 * Math.pow(level, 1.4));
}

export function runXp(blocks: number, depthGained: number): number {
  return Math.round(blocks + depthGained * 2);
}

export interface Reward {
  coins?: number;
  gems?: number;
  dynamite?: number;
  totems?: number;
  chest?: ChestRarity;
  boosts?: Partial<Record<BoostId, number>>;
}

export function levelReward(save: SaveData, level: number): Reward {
  const r: Reward = { gems: 2 + Math.floor(level / 5), coins: Math.round(rewardScale(save) * 0.5) };
  // power-ups open with a starter pack so the first loadout is never empty
  if (level === FEATURE_LEVEL.boosts) r.boosts = { giant: 2, twin: 2, teleport: 2, shield: 2 };
  return r;
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
    if (save.level === FEATURE_LEVEL.boosts) for (const id of ['giant', 'teleport'] as BoostId[]) if (save.loadout.length < 3 && !save.loadout.includes(id)) save.loadout.push(id);
  }
  return reached;
}

export type Feature = 'upgrades' | 'forge' | 'quests' | 'collection' | 'items' | 'boosts' | 'freeChest' | 'idle' | 'achievements' | 'daily';

/** One new system at a time: never more than two unlocks on a level-up. */
export const FEATURE_LEVEL: Record<Feature, number> = {
  upgrades: 1,
  forge: 2,
  quests: 1,
  daily: 3,
  freeChest: 3,
  items: 4,
  boosts: 4,
  idle: 5,
  collection: 5,
  achievements: 6,
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
  for (const [id, n] of Object.entries(r.boosts ?? {})) if (n) addBoost(save, id as BoostId, n);
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

export { dayKey };

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

// ───────────────────────── missions ─────────────────────────
/*
 * An endless pool of missions (3 active slots). Targets are built from the player's own
 * per-run averages, scaled by how many missions are already done:
 *   "total" missions need R(done) runs' worth of progress, "run" missions need F(done)× an
 *   average run. Early on (R < 1) every slot finishes within one run → ~3 per run; later
 *   R grows to 6 → ~0.5 per run. Rewards are mostly power-ups (see BOOSTS).
 */

/** Runs' worth of progress a "total" mission needs. */
export function missionRuns(done: number): number {
  return Math.min(6, 0.15 + 0.04 * done);
}

/** Share of an average run a "run" mission asks for. */
export function missionRunFactor(done: number): number {
  return Math.min(1.35, 0.35 + 0.012 * done);
}

/** Starting guesses for the per-run averages (a fresh player's run). */
const AVG_DEFAULT: Record<string, number> = {
  blocks: 35, ores: 3, coins: 40, meters: 18, tnt: 1, chests: 0.6, tierUps: 0.6, dynamite: 0.3, dashes: 3, dashBlocks: 5,
  bestDash: 2, fevers: 0, events: 0, boosts: 0, heals: 0.6, enchants: 0, slimes: 0, gems: 0, crits: 0, combo: 12, time: 20,
};

/** Everything a finished run contributes to missions. */
export function runMetrics(r: RunResult, startDepth: number): Record<string, number> {
  const boosts = Object.entries(r.boostsUsed).reduce((n, [id, v]) => n + (id === 'dynamite' ? 0 : v ?? 0), 0);
  const m: Record<string, number> = {
    blocks: r.blocks, ores: r.ores, coins: r.totalCoins, meters: Math.max(0, r.depth - startDepth), depth: r.depth, tnt: r.tnt,
    chests: r.chests, tierUps: r.tierUps, dynamite: r.dynamiteUsed, dashes: r.dashes, dashBlocks: r.dashBlocks, bestDash: r.bestDash,
    fevers: r.fevers, events: r.events, boosts, heals: r.heals, enchants: r.enchantsGot, slimes: r.slimes, gems: r.gems, crits: r.crits,
    combo: r.bestCombo, time: Math.round(r.time), runs: 1, rifts: r.rifts ?? 0, runes: r.runes ?? 0,
  };
  for (const [k, v] of Object.entries(r.oreCounts)) m[`ore:${k}`] = v;
  return m;
}

interface MissionTemplate {
  /** Metric name (also the i18n key `m.<key>` / `mr.<key>` for run scope). */
  metric: string;
  scope: 'run' | 'total';
  min: number;
  max?: number;
  avail?: (s: SaveData) => boolean;
  /** Custom target instead of the average-based one. */
  target?: (s: SaveData, done: number) => number;
  w?: number;
}

const avg = (s: SaveData, k: string) => s.missions.avg[k] ?? AVG_DEFAULT[k] ?? 0;
const has = (k: string, v: number) => (s: SaveData) => avg(s, k) >= v;

const TEMPLATES: MissionTemplate[] = [
  { metric: 'blocks', scope: 'total', min: 20, w: 3 },
  { metric: 'blocks', scope: 'run', min: 15, w: 2 },
  { metric: 'ores', scope: 'total', min: 4, w: 2 },
  { metric: 'coins', scope: 'total', min: 40, w: 2 },
  { metric: 'coins', scope: 'run', min: 30 },
  { metric: 'meters', scope: 'total', min: 15, w: 2 },
  {
    metric: 'depth', scope: 'run', min: 10, w: 2,
    target: (s, d) => Math.max(10, Math.round(s.bestDepth * Math.min(1.08, 0.75 + 0.006 * d))),
  },
  { metric: 'combo', scope: 'run', min: 10 },
  { metric: 'time', scope: 'run', min: 15 },
  { metric: 'tnt', scope: 'total', min: 2, avail: has('tnt', 0.4) },
  { metric: 'chests', scope: 'total', min: 1, avail: has('chests', 0.25) },
  { metric: 'tierUps', scope: 'total', min: 1, avail: (s) => s.level >= 2 && avg(s, 'tierUps') >= 0.3 },
  { metric: 'dynamite', scope: 'total', min: 1, avail: (s) => s.dynamite > 0 || avg(s, 'dynamite') >= 0.3 },
  { metric: 'dashes', scope: 'total', min: 3, w: 2 },
  { metric: 'dashBlocks', scope: 'total', min: 5, w: 2 },
  {
    metric: 'bestDash', scope: 'run', min: 2,
    target: (s, d) => Math.min(s.dashDown > 0 ? DASH_DOWN.blocks[s.dashDown - 1] : 5, 2 + Math.floor(avg(s, 'bestDash') * missionRunFactor(d))),
  },
  { metric: 'fevers', scope: 'total', min: 1, avail: has('fevers', 0.2) },
  { metric: 'events', scope: 'total', min: 1, avail: has('events', 0.3) },
  { metric: 'boosts', scope: 'total', min: 1, avail: (s) => s.level >= FEATURE_LEVEL.boosts },
  { metric: 'heals', scope: 'total', min: 1, avail: has('heals', 0.3) },
  { metric: 'enchants', scope: 'total', min: 1, avail: has('enchants', 0.2) },
  { metric: 'slimes', scope: 'total', min: 2, avail: has('slimes', 0.3) },
  { metric: 'gems', scope: 'total', min: 1, avail: has('gems', 0.3) },
  { metric: 'crits', scope: 'total', min: 3, avail: has('crits', 1) },
  // world mechanics: only where they exist
  { metric: 'rifts', scope: 'total', min: 1, w: 1.5, avail: (s) => s.world === 1 && avg(s, 'rifts') >= 0.2 },
  { metric: 'runes', scope: 'total', min: 1, w: 1.5, avail: (s) => s.world === 2 && avg(s, 'runes') >= 0.2 },
  { metric: 'runs', scope: 'total', min: 2, avail: (s) => s.missions.done >= 20, target: (_s, d) => Math.max(2, Math.round(1 + missionRuns(d) * 1.2)) },
  { metric: 'upgrade', scope: 'total', min: 1, target: (_s, d) => 1 + Math.floor(missionRuns(d) / 2) },
];

function niceTarget(n: number): number {
  if (n < 20) return Math.round(n);
  if (n < 200) return Math.round(n / 5) * 5;
  const mag = Math.pow(10, Math.floor(Math.log10(n)) - 1);
  return Math.round(n / mag) * mag;
}

function makeMission(s: SaveData, rng: Rng, avoid: string[]): Mission {
  const d = s.missions.done;
  const pool: { item: MissionTemplate | string; w: number }[] = [];
  for (const tpl of TEMPLATES) {
    if (avoid.includes(`${tpl.scope}:${tpl.metric}`) || (tpl.avail && !tpl.avail(s))) continue;
    pool.push({ item: tpl, w: tpl.w ?? 1 });
  }
  // one template per ore the player keeps finding: "mine 12 iron"
  for (const k of Object.keys(s.missions.avg)) {
    if (k.startsWith('ore:') && avg(s, k) >= 0.7 && blockWorld(k.slice(4)) === s.world && !avoid.includes(`total:${k}`)) pool.push({ item: k, w: 0.6 });
  }
  const pick = rng.weighted(pool);
  const tpl: MissionTemplate = typeof pick === 'string' ? { metric: pick, scope: 'total', min: 3 } : pick;
  let target: number;
  if (tpl.target) target = tpl.target(s, d);
  else {
    const k = tpl.scope === 'total' ? missionRuns(d) : missionRunFactor(d);
    target = avg(s, tpl.metric) * k * rng.range(0.85, 1.15);
  }
  target = niceTarget(Math.max(tpl.min, target));
  if (tpl.max) target = Math.min(tpl.max, target);
  return { type: tpl.metric, scope: tpl.scope, target, progress: 0, reward: missionReward(s, rng, tpl.scope) };
}

function missionReward(s: SaveData, rng: Rng, scope: 'run' | 'total'): Mission['reward'] {
  const d = s.missions.done + s.missions.list.length;
  const boostsOpen = s.level >= FEATURE_LEVEL.boosts;
  const anyBoost = (): BoostId => (boostsOpen ? rng.pick(BOOST_IDS) : 'dynamite');
  // every 5th mission: a bundle of power-ups (no coins — the economy stays the run's job)
  if (d % 5 === 4) return { boost: anyBoost(), n: 3, gems: 2 + Math.floor(d / 40) };
  const roll = rng.next();
  if (roll < 0.5) return { boost: anyBoost(), n: d >= 60 && rng.chance(0.4) ? 2 : 1 };
  if (roll < 0.75) return { gems: rng.int(1, 2) + (d >= 40 ? 1 : 0) };
  // a small top-up: a tenth of an average run
  return { coins: niceRound(Math.max(20, avg(s, 'coins') * (scope === 'run' ? 0.15 : 0.1))) };
}

/** Fill the 3 slots (once missions are unlocked). */
export function ensureMissions(s: SaveData): Mission[] {
  if (!unlocked(s, 'quests')) return s.missions.list;
  const rng = new Rng(0x9e37 + s.missions.done * 7919 + s.runs * 31);
  while (s.missions.list.length < 3) {
    s.missions.list.push(makeMission(s, rng, s.missions.list.map((m) => `${m.scope}:${m.type}`)));
  }
  return s.missions.list;
}

export function grantMission(s: SaveData, m: Mission): Reward {
  const r = m.reward;
  const out: Reward = {};
  if (r.coins) out.coins = r.coins;
  if (r.gems) out.gems = r.gems;
  if (r.boost) out.boosts = { [r.boost]: r.n ?? 1 };
  grant(s, out);
  return out;
}

export interface MissionDone {
  mission: Mission;
  reward: Reward;
}

/**
 * Apply progress. `run` = metrics of a finished run (run-scope missions use max, total ones sum);
 * otherwise only "total" missions move (purchases, idle coins…). Finished missions are paid,
 * counted and replaced right away.
 */
export function progressMissions(s: SaveData, metrics: Record<string, number>, run: boolean): MissionDone[] {
  ensureMissions(s);
  const done: MissionDone[] = [];
  for (const m of s.missions.list) {
    const v = metrics[m.type];
    if (!v || (m.scope === 'run' && !run)) continue;
    m.progress = m.scope === 'run' ? Math.max(m.progress, v) : m.progress + v;
  }
  for (const m of [...s.missions.list]) {
    if (m.progress < m.target) continue;
    m.progress = m.target;
    const reward = grantMission(s, m);
    s.missions.done++;
    s.missions.list.splice(s.missions.list.indexOf(m), 1);
    done.push({ mission: m, reward });
  }
  if (done.length) ensureMissions(s);
  return done;
}

/** Fold a finished run into the per-run averages that mission targets are built from. */
export function updateMissionAvg(s: SaveData, metrics: Record<string, number>): void {
  const a = s.missions.avg;
  const keys = new Set([...Object.keys(AVG_DEFAULT), ...Object.keys(metrics), ...Object.keys(a).filter((k) => k.startsWith('ore:'))]);
  for (const k of keys) {
    if (k === 'runs' || k === 'depth') continue;
    const prev = a[k] ?? AVG_DEFAULT[k] ?? 0;
    a[k] = Math.round((prev * 0.75 + (metrics[k] ?? 0) * 0.25) * 100) / 100;
  }
}

/** Live check during a run: which missions this run has already finished (for a toast). */
export function missionsReachedLive(s: SaveData, metrics: Record<string, number>): Mission[] {
  return s.missions.list.filter((m) => {
    const v = metrics[m.type] ?? 0;
    return m.progress < m.target && (m.scope === 'run' ? v : m.progress + v) >= m.target;
  });
}

/** Once a day a mission can be swapped for free. */
export function skipMission(s: SaveData, index: number, now: number): boolean {
  const day = dayKey(now);
  const m = s.missions.list[index];
  if (!m || s.missions.skipDay === day) return false;
  s.missions.skipDay = day;
  const rng = new Rng(now & 0xffffff);
  s.missions.list[index] = makeMission(s, rng, s.missions.list.map((x) => `${x.scope}:${x.type}`));
  return true;
}

export function missionsSkipReady(s: SaveData, now: number): boolean {
  return s.missions.skipDay !== dayKey(now);
}

// ───────────────────────── collection ─────────────────────────

export const COLLECTIBLE = BLOCKS.filter((b) => b && b.id !== B.AIR && b.id !== B.LAVA && b.id !== B.BEDROCK).map((b) => b.key);

export function discoveryGems(key: string): number {
  const def = BLOCKS.find((b) => b?.key === key);
  if (!def) return 0;
  return def.special || def.value >= 50 ? 2 : 1;
}

// ───────────────────────── achievements ─────────────────────────

/** Which world a block belongs to (by its key). */
export function blockWorld(key: string): number {
  const id = BLOCKS.find((b) => b?.key === key)?.id ?? 0;
  return id >= B.SAND ? 2 : id >= B.SNOW ? 1 : 0;
}

export interface AchievementDef {
  id: string;
  icon: string;
  tiers: number[];
  value: (s: SaveData) => number;
}

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'blocks', icon: 'pickaxe', tiers: [100, 1000, 10000, 100000, 1000000], value: (s) => s.blocksBroken },
  // global depth: worlds 2 and 3 continue the count past 1000 m
  { id: 'depth', icon: 'down', tiers: [20, 100, 250, 450, 700, 1000, 2000, 3000], value: (s) => globalBest(s) },
  { id: 'worlds', icon: 'world', tiers: [2, 3], value: (s) => s.worldsOpen },
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
