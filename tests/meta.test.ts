import { describe, expect, it } from 'vitest';
import {
  ACHIEVEMENTS,
  COLLECTIBLE,
  DAILY,
  FREE_CHEST_COOLDOWN,
  addXp,
  claimAchievement,
  claimDaily,
  claimQuest,
  claimQuestBonus,
  collectIdle,
  dailyStatus,
  ensureQuests,
  idlePending,
  openFreeChest,
  rerollQuest,
  rewardScale,
  trackQuests,
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

describe('quests', () => {
  it('creates 3 daily quests, tracks and pays them', () => {
    const s = newSave();
    s.level = 3;
    const qs = ensureQuests(s, T0);
    expect(qs.list).toHaveLength(3);
    const types = new Set(qs.list.map((q) => q.type));
    expect(types.size).toBe(3);
    const huge = { blocks: 1e6, depth: 1e6, tnt: 1e6, chests: 1e6, combo: 1e6, tierUps: 1e6, ores: 1e6, runs: 1e6, dynamite: 1e6, upgrade: 1e6, coins: 1e9 };
    expect(trackQuests(s, huge, T0)).toHaveLength(3);
    const coins = s.coins;
    for (let i = 0; i < 3; i++) expect(claimQuest(s, i, T0)).not.toBeNull();
    expect(s.coins).toBeGreaterThan(coins);
    expect(claimQuestBonus(s, new Rng(3))).not.toBeNull();
    expect(claimQuestBonus(s, new Rng(3))).toBeNull();
  });
  it('allows one reroll per day and refreshes next day', () => {
    const s = newSave();
    ensureQuests(s, T0);
    expect(rerollQuest(s, 0, T0)).toBe(true);
    expect(rerollQuest(s, 1, T0)).toBe(false);
    ensureQuests(s, T0 + DAY);
    expect(s.quests.rerolled).toBe(false);
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
