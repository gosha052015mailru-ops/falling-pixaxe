import { describe, expect, it } from 'vitest';
import {
  ACHIEVEMENTS,
  COLLECTIBLE,
  DAILY,
  FREE_CHEST_COOLDOWN,
  addXp,
  claimAchievement,
  claimDaily,
  collectIdle,
  dailyStatus,
  ensureMissions,
  idlePending,
  openFreeChest,
  progressMissions,
  skipMission,
  rewardScale,
  unlocked,
  xpForLevel,
} from '../src/game/meta';
import { applyResult } from '../src/game/progress';
import { Rng } from '../src/game/rng';
import { Run } from '../src/game/run';
import { clockNow, loadSave, migrate, newSave, writeSave } from '../src/game/save';
import { deriveStats } from '../src/game/economy';
import { missingKeys } from '../src/ui/i18n';

const DAY = 86400_000;
const T0 = new Date(2026, 9, 15, 12).getTime();

describe('level & unlocks', () => {
  it('levels up and grants rewards', () => {
    const s = newSave();
    const lv = addXp(s, xpForLevel(1) + xpForLevel(2));
    expect(lv).toEqual([2, 3]);
    expect(s.level).toBe(3);
    expect(s.gems).toBeGreaterThan(0);
    expect(unlocked(s, 'quests')).toBe(true);
    expect(unlocked(s, 'achievements')).toBe(false);
  });
  it('reward scale grows with depth', () => {
    const s = newSave();
    const a = rewardScale(s);
    s.bestDepth = 250;
    expect(rewardScale(s)).toBeGreaterThan(a * 50);
  });
});

describe('daily rewards', () => {
  it('advances on consecutive days and resets after a gap', () => {
    const s = newSave();
    const rng = new Rng(1);
    expect(claimDaily(s, T0, rng)!.index).toBe(0);
    expect(claimDaily(s, T0 + 1000, rng)).toBeNull();
    expect(claimDaily(s, T0 + DAY, rng)!.index).toBe(1);
    expect(dailyStatus(s, T0 + 3 * DAY)).toEqual({ index: 0, canClaim: true });
  });
  it('day 7 gives a chest and the cycle wraps', () => {
    const s = newSave();
    const rng = new Rng(2);
    for (let d = 0; d < DAILY.length; d++) claimDaily(s, T0 + d * DAY, rng);
    expect(s.dailyStreak).toBe(7);
    expect(claimDaily(s, T0 + 7 * DAY, rng)!.index).toBe(0);
  });
});

describe('missions', () => {
  it('keeps 3 different missions, pays and replaces finished ones', () => {
    const s = newSave();
    const list = ensureMissions(s);
    expect(list).toHaveLength(3);
    expect(new Set(list.map((m) => `${m.scope}:${m.type}`)).size).toBe(3);
    const huge: Record<string, number> = {};
    for (const m of list) huge[m.type] = 1e9;
    const before = { coins: s.coins, gems: s.gems, dyn: s.dynamite };
    const done = progressMissions(s, huge, true);
    expect(done).toHaveLength(3);
    expect(s.missions.done).toBe(3);
    expect(s.missions.list).toHaveLength(3);
    expect(s.coins + s.gems + s.dynamite).toBeGreaterThan(before.coins + before.gems + before.dyn);
  });
  it('run-scoped missions ignore menu progress; total ones sum up', () => {
    const s = newSave();
    s.missions.list = [
      { type: 'blocks', scope: 'run', target: 10, progress: 0, reward: { gems: 1 } },
      { type: 'upgrade', scope: 'total', target: 2, progress: 0, reward: { gems: 1 } },
    ];
    progressMissions(s, { blocks: 50, upgrade: 1 }, false);
    expect(s.missions.list[0].progress).toBe(0);
    expect(s.missions.list[1].progress).toBe(1);
    expect(progressMissions(s, { upgrade: 1 }, false)).toHaveLength(1);
  });
  it('get harder as more are done (3 per run early, ~1 or less later)', async () => {
    const { missionRuns } = await import('../src/game/meta');
    expect(missionRuns(0)).toBeLessThan(0.5);
    expect(missionRuns(100)).toBeGreaterThan(3);
  });
  it('one free swap per day', () => {
    const s = newSave();
    ensureMissions(s);
    expect(skipMission(s, 0, T0)).toBe(true);
    expect(skipMission(s, 1, T0)).toBe(false);
    expect(skipMission(s, 1, T0 + DAY)).toBe(true);
  });
});

describe('chests, idle, achievements, collection', () => {
  it('free chest has a cooldown', () => {
    const s = newSave();
    expect(openFreeChest(s, T0, new Rng(1))).not.toBeNull();
    expect(openFreeChest(s, T0 + 1000, new Rng(1))).toBeNull();
    expect(openFreeChest(s, T0 + FREE_CHEST_COOLDOWN, new Rng(1))).not.toBeNull();
  });
  it('idle miners accrue up to the cap', () => {
    const s = newSave();
    s.bestDepth = 100;
    expect(collectIdle(s, T0)).toBe(0); // starts the miners
    expect(idlePending(s, T0 + 3600_000)).toBeGreaterThan(0);
    expect(idlePending(s, T0 + 100 * 3600_000)).toBe(idlePending(s, T0 + 8 * 3600_000));
    expect(collectIdle(s, T0 + 3600_000)).toBeGreaterThan(0);
  });
  it('achievements pay once per tier', () => {
    const s = newSave();
    s.blocksBroken = 150;
    expect(claimAchievement(s, 'blocks')).toBeGreaterThan(0);
    expect(claimAchievement(s, 'blocks')).toBe(0);
    expect(ACHIEVEMENTS.length).toBeGreaterThan(5);
  });
  it('first discoveries give gems and xp', () => {
    const s = newSave();
    const run = new Run({ seed: 4, stats: deriveStats(s), bestDepth: 0, milestones: [] });
    for (let i = 0; i < 60 * 60 && !run.over; i++) run.step(1 / 60);
    const rep = applyResult(s, run.result(), 1, T0);
    expect(rep.newBlocks.length).toBeGreaterThan(0);
    expect(rep.newBlockGems).toBeGreaterThan(0);
    expect(rep.xp).toBeGreaterThan(0);
    expect(COLLECTIBLE).toContain('starore');
  });
});

describe('tutorial run & revive', () => {
  it('holds until the first tap and has a workbench right below', () => {
    const s = newSave();
    const run = new Run({ seed: 9, stats: deriveStats(s), bestDepth: 0, milestones: [], tutorial: true });
    const y = run.y;
    run.step(1 / 60);
    expect(run.y).toBe(y);
    run.nudge(1);
    for (let i = 0; i < 900 && run.tier === 0; i++) run.step(1 / 60);
    expect(run.tier).toBeGreaterThan(0);
  });
  it('revives a broken run once', () => {
    const run = new Run({ seed: 5, stats: deriveStats(newSave()), bestDepth: 0, milestones: [] });
    for (let i = 0; i < 60 * 600 && !run.over; i++) run.step(1 / 60);
    expect(run.over).toBe(true);
    expect(run.revive()).toBe(true);
    expect(run.over).toBe(false);
    expect(run.durability).toBeGreaterThan(0);
  });
});

describe('save robustness', () => {
  it('falls back to the backup slot when the main save is corrupted', () => {
    const mem = new Map<string, string>();
    const st = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
    const s = newSave();
    s.coins = 10;
    writeSave(s, st);
    s.coins = 20;
    writeSave(s, st);
    mem.set('falling-pickaxe-save', '{broken');
    expect(loadSave(st).coins).toBe(10);
  });
  it('clock never goes backwards for timers', () => {
    const s = newSave();
    expect(clockNow(s, 1000)).toBe(1000);
    expect(clockNow(s, 500)).toBe(1000);
  });
  it('v1 saves with runs skip the tutorial', () => {
    expect(migrate({ version: 1, runs: 3 }).tutorialDone).toBe(true);
    expect(migrate({}).tutorialDone).toBe(false);
  });
});

describe('i18n', () => {
  it('has every key in both languages', () => {
    expect(missingKeys()).toEqual([]);
  });
});
