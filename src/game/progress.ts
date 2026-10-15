import { BIOMES, CHECKPOINTS } from './config';
import { addCoins } from './economy';
import type { RunResult } from './run';
import type { SaveData } from './save';

/** Apply a finished run to permanent progress. `mult` = 2 after a rewarded ad. */
export function applyResult(save: SaveData, r: RunResult, mult = 1): void {
  addCoins(save, r.totalCoins * mult);
  save.gems += r.gems;
  save.runs++;
  save.blocksBroken += r.blocks;
  save.dynamite = Math.max(0, save.dynamite - r.dynamiteUsed + r.dynamiteFound);
  save.totems = Math.max(0, save.totems - r.totemsUsed);
  if (r.depth > save.bestDepth) save.bestDepth = r.depth;
  for (const m of r.newMilestones) if (!save.milestones.includes(m)) save.milestones.push(m);
  for (const k of r.discovered) if (!save.discovered.includes(k)) save.discovered.push(k);
  if (r.core) save.coreReached = true;
}

/** Elevator stops the player has unlocked (always includes 0). */
export function unlockedCheckpoints(save: SaveData): number[] {
  return [0, ...CHECKPOINTS.filter((d) => save.bestDepth >= d)];
}

export function biomeIndexOfCheckpoint(depth: number): number {
  return Math.max(0, BIOMES.findIndex((b) => b.from === depth));
}
