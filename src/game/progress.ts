import { BIOMES, CHECKPOINTS } from './config';
import { addCoins } from './economy';
import { addXp, discoveryGems, runXp, trackQuests } from './meta';
import type { RunResult } from './run';
import type { Quest, SaveData } from './save';

export interface ProgressReport {
  xp: number;
  levelsReached: number[];
  newBlocks: string[];
  newBlockGems: number;
  questsDone: Quest[];
  prevBest: number;
}

/** Apply a finished run to permanent progress. `mult` = 2 after a rewarded ad. */
export function applyResult(save: SaveData, r: RunResult, mult = 1, now = Date.now()): ProgressReport {
  const prevBest = save.bestDepth;
  addCoins(save, r.totalCoins * mult);
  save.gems += r.gems;
  save.runs++;
  save.blocksBroken += r.blocks;
  save.dynamite = Math.max(0, save.dynamite - r.dynamiteUsed + r.dynamiteFound);
  save.totems = Math.max(0, save.totems - r.totemsUsed);
  if (r.depth > save.bestDepth) save.bestDepth = r.depth;
  for (const m of r.newMilestones) if (!save.milestones.includes(m)) save.milestones.push(m);
  if (r.core) save.coreReached = true;

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

  const xp = runXp(r.blocks, Math.max(0, r.depth - (save.startDepth || 0)));
  const levelsReached = addXp(save, xp);

  const questsDone = trackQuests(
    save,
    {
      blocks: r.blocks,
      depth: r.depth,
      tnt: r.tnt,
      chests: r.chests,
      combo: r.bestCombo,
      tierUps: r.tierUps,
      ores: r.ores,
      runs: 1,
      dynamite: r.dynamiteUsed,
      coins: r.totalCoins * mult,
    },
    now,
  );
  if (!save.tutorialDone) save.tutorialDone = true;
  return { xp, levelsReached, newBlocks, newBlockGems, questsDone, prevBest };
}

/** Elevator stops the player has unlocked (always includes 0). */
export function unlockedCheckpoints(save: SaveData): number[] {
  return [0, ...CHECKPOINTS.filter((d) => save.bestDepth >= d)];
}

export function biomeIndexOfCheckpoint(depth: number): number {
  return Math.max(0, BIOMES.findIndex((b) => b.from === depth));
}

/** The next clear goal shown on the main menu. */
export function nextGoal(save: SaveData): { depth: number; biome: number } | null {
  for (let i = 1; i < BIOMES.length; i++) if (save.bestDepth < BIOMES[i].from) return { depth: BIOMES[i].from, biome: i };
  return save.coreReached ? null : { depth: BIOMES[BIOMES.length - 1].to, biome: -1 };
}
