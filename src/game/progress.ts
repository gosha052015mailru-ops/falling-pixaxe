import { BOOSTS, WORLDS, biomesOf, checkpointsOf } from './config';
import { addCoins } from './economy';
import { addXp, discoveryGems, ensureMissions, progressMissions, runMetrics, runXp, updateMissionAvg, type MissionDone } from './meta';
import type { RunResult } from './run';
import type { SaveData } from './save';

export interface ProgressReport {
  xp: number;
  levelsReached: number[];
  newBlocks: string[];
  newBlockGems: number;
  missionsDone: MissionDone[];
  prevBest: number;
  /** Index of a world opened by this run (reaching the Core), else -1. */
  worldOpened: number;
}

/** Apply a finished run to permanent progress. `mult` = 2 after a rewarded ad. */
export function applyResult(save: SaveData, r: RunResult, mult = 1, _now = Date.now()): ProgressReport {
  const prevBest = save.bestDepth;
  addCoins(save, r.totalCoins * mult);
  save.gems += r.gems;
  save.runs++;
  save.blocksBroken += r.blocks;
  save.dynamite = Math.max(0, save.dynamite - r.dynamiteUsed + r.dynamiteFound);
  save.totems = Math.max(0, save.totems - r.totemsUsed);
  for (const [id, n] of Object.entries(r.boostsUsed)) {
    if (id !== 'dynamite' && n) save.boosts[id as keyof SaveData['boosts']] = Math.max(0, save.boosts[id as keyof SaveData['boosts']] - n);
  }
  if (r.depth > save.bestDepth) save.bestDepth = r.depth;
  for (const m of r.newMilestones) if (!save.milestones.includes(m)) save.milestones.push(m);
  let worldOpened = -1;
  if (r.core) {
    save.coreReached = true;
    if (save.world + 1 < WORLDS.length && save.worldsOpen < save.world + 2) {
      save.worldsOpen = save.world + 2;
      worldOpened = save.world + 1;
      // the Core's reward: the best pickaxe of this world is yours for good
      save.forgeTier = Math.max(save.forgeTier, WORLDS[worldOpened].baseTier);
    }
  }
  storeWorld(save);

  const life = save.life;
  life.tnt += r.tnt;
  life.chests += r.chests;
  life.tierUps += r.tierUps;
  life.ores += r.ores;
  life.dynamiteUsed += r.dynamiteUsed;
  life.fevers += r.fevers;
  life.maxCombo = Math.max(life.maxCombo, r.bestCombo);

  const newBlocks: string[] = [];
  let newBlockGems = 0;
  for (const k of r.discovered) {
    if (!save.discovered.includes(k)) {
      save.discovered.push(k);
      newBlocks.push(k);
      newBlockGems += discoveryGems(k);
    }
  }
  save.gems += newBlockGems;

  // missions first (only the ones already active), then the averages new targets are built from
  const metrics = runMetrics(r, save.startDepth || 0);
  if (mult > 1) metrics.coins = r.totalCoins * mult;
  const missionsDone = progressMissions(save, metrics, true);
  updateMissionAvg(save, metrics);

  const xp = runXp(r.blocks, Math.max(0, r.depth - (save.startDepth || 0)));
  const levelsReached = addXp(save, xp);
  ensureMissions(save);
  if (!save.tutorialDone) save.tutorialDone = true;
  return { xp, levelsReached, newBlocks, newBlockGems, missionsDone, prevBest, worldOpened };
}

/** Copy the active world's campaign fields into its slot of `worldSaves`. */
export function storeWorld(save: SaveData): void {
  save.worldSaves[save.world] = {
    bestDepth: save.bestDepth,
    milestones: [...save.milestones],
    liftStops: [...save.liftStops],
    startDepth: save.startDepth,
    coreReached: save.coreReached,
  };
}

/** Switch the active world: its own record, elevator and milestones come with it. */
export function switchWorld(save: SaveData, world: number): boolean {
  if (world < 0 || world >= save.worldsOpen || world >= WORLDS.length) return false;
  if (world === save.world) return true;
  storeWorld(save);
  const w = save.worldSaves[world];
  save.world = world;
  save.bestDepth = w.bestDepth;
  save.milestones = [...w.milestones];
  save.liftStops = [...w.liftStops];
  save.startDepth = w.startDepth;
  save.coreReached = w.coreReached;
  // world-exclusive power-ups stay home
  save.loadout = save.loadout.filter((id) => {
    const only = BOOSTS[id].world;
    return only === undefined || only === world;
  });
  return true;
}

/** Elevator stops the player can start from: reached AND bought (always includes 0). */
export function unlockedCheckpoints(save: SaveData): number[] {
  return [0, ...checkpointsOf(save.world).filter((d) => save.bestDepth >= d && save.liftStops.includes(d))];
}

/** The next stop that is reached but not bought yet, with its price. */
export function nextLiftStop(save: SaveData): { depth: number; cost: number } | null {
  const d = checkpointsOf(save.world).find((c) => save.bestDepth >= c && !save.liftStops.includes(c));
  return d === undefined ? null : { depth: d, cost: WORLDS[save.world].lift[d] };
}

export function buyLiftStop(save: SaveData, depth: number): boolean {
  const cost = WORLDS[save.world].lift[depth];
  if (cost === undefined || save.bestDepth < depth || save.liftStops.includes(depth) || save.coins < cost) return false;
  save.coins -= cost;
  save.liftStops.push(depth);
  save.liftStops.sort((a, b) => a - b);
  return true;
}

export function biomeIndexOfCheckpoint(depth: number, world = 0): number {
  return Math.max(0, biomesOf(world).findIndex((b) => b.from === depth));
}

/** The next clear goal shown on the main menu. */
export function nextGoal(save: SaveData): { depth: number; biome: number } | null {
  const biomes = biomesOf(save.world);
  for (let i = 1; i < biomes.length; i++) if (save.bestDepth < biomes[i].from) return { depth: biomes[i].from, biome: i };
  return save.coreReached ? null : { depth: biomes[biomes.length - 1].to, biome: -1 };
}
