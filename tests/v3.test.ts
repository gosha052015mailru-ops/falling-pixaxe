import { describe, expect, it } from 'vitest';
import { B } from '../src/game/blocks';
import { deriveStats } from '../src/game/economy';
import { addPlayTime, playerMetrics, recordRun, startSession, userProperties } from '../src/game/profile';
import { Run } from '../src/game/run';
import { migrate, newSave } from '../src/game/save';
import { World } from '../src/game/world';
import { outOfQuietHours, planNotifications } from '../src/notifications';

const DAY = 86400_000;
const T0 = new Date(2026, 9, 15, 12).getTime();

describe('difficulty', () => {
  it('changes durability, block HP and coins', () => {
    const s = newSave();
    s.difficulty = 'easy';
    const easy = deriveStats(s);
    s.difficulty = 'hard';
    const hard = deriveStats(s);
    s.difficulty = 'normal';
    const normal = deriveStats(s);
    expect(easy.maxDurBase).toBeGreaterThan(normal.maxDurBase);
    expect(hard.maxDurBase).toBeLessThan(normal.maxDurBase);
    expect(hard.coinMult).toBeGreaterThan(normal.coinMult);
    const wn = new World(1, 0, 1, undefined, normal.hpMult);
    const wh = new World(1, 0, 1, undefined, hard.hpMult);
    expect(wh.hpAt(0, 30)).toBeGreaterThan(wn.hpAt(0, 30));
  });
  it('is asked on first launch but kept for existing players', () => {
    expect(newSave().difficulty).toBe('');
    expect(migrate({ runs: 5 }).difficulty).toBe('normal');
    expect(migrate({ runs: 5, difficulty: 'hard' }).difficulty).toBe('hard');
  });
  it('a run uses the difficulty HP multiplier', () => {
    const s = newSave();
    s.difficulty = 'hard';
    const run = new Run({ seed: 1, stats: deriveStats(s), bestDepth: 0, milestones: [] });
    const normal = new World(1);
    run.world.set(0, 40, B.STONE);
    normal.set(0, 40, B.STONE);
    expect(run.world.hpAt(0, 40)).toBeCloseTo(normal.hpAt(0, 40) * 1.3);
  });
});

describe('notifications planner', () => {
  it('never schedules at night', () => {
    const night = new Date(2026, 9, 15, 23, 30).getTime();
    expect(new Date(outOfQuietHours(night)).getHours()).toBe(10);
    const early = new Date(2026, 9, 15, 5).getTime();
    expect(new Date(outOfQuietHours(early)).getHours()).toBe(10);
    const day = new Date(2026, 9, 15, 15).getTime();
    expect(outOfQuietHours(day)).toBe(day);
  });
  it('plans chest, miners, daily and comeback reminders, spaced apart', () => {
    const s = newSave();
    s.level = 5;
    s.bestDepth = 100;
    s.freeChestAt = T0 + 2 * 3600_000;
    s.idleLast = T0 - 3600_000;
    const plan = planNotifications(s, T0);
    const kinds = plan.map((p) => p.kind);
    expect(kinds).toContain('chest');
    expect(kinds).toContain('comeback1');
    for (let i = 1; i < plan.length; i++) expect(plan[i].at - plan[i - 1].at).toBeGreaterThanOrEqual(2 * 3600_000);
    for (const p of plan) {
      const h = new Date(p.at).getHours();
      expect(h >= 9 && h < 22).toBe(true);
    }
  });
  it('skips locked features for new players', () => {
    const plan = planNotifications(newSave(), T0);
    expect(plan.map((p) => p.kind)).toEqual(['comeback1', 'comeback3']);
  });
});

describe('player profile', () => {
  it('tracks sessions, active days and retention once', () => {
    const s = newSave();
    s.profile.installAt = T0;
    expect(startSession(s, T0).retention).toBeNull();
    const d1 = startSession(s, T0 + DAY);
    expect(d1.retention).toBe(1);
    expect(startSession(s, T0 + DAY + 1000).retention).toBeNull();
    const m = playerMetrics(s, T0 + DAY);
    expect(m.sessions).toBe(3);
    expect(m.activeDays).toBe(2);
    expect(m.retained[1]).toBe(true);
    expect(m.retained[7]).toBe(false);
  });
  it('computes run stats, trend and user properties', () => {
    const s = newSave();
    s.profile.installAt = T0;
    for (let i = 0; i < 20; i++) {
      s.runs++;
      recordRun(s, { depth: i < 10 ? 10 : 20, totalCoins: 100, time: 30 } as never, T0);
    }
    addPlayTime(s, 600);
    const m = playerMetrics(s, T0);
    expect(m.avgDepth).toBe(15);
    expect(m.depthTrend).toBe(100);
    expect(m.avgRunSec).toBe(30);
    const up = userProperties(s, T0);
    expect(up.player_id).toBe(s.profile.id);
    expect(up.segment).toBe('casual');
  });
});

describe('new player pacing (playtest guards)', () => {
  it('first run: exactly one pickaxe upgrade, no player level-up, a calm fall speed', async () => {
    const { Bot } = await import('../src/game/bot');
    const { applyResult } = await import('../src/game/progress');
    const s = newSave();
    s.difficulty = 'normal';
    const run = new Run({ seed: 3, stats: deriveStats(s), bestDepth: 0, milestones: [], tutorial: true });
    run.nudge(1);
    const bot = new Bot(0.45);
    let maxV = 0;
    while (!run.over && run.time < 300) {
      run.step(1 / 120);
      maxV = Math.max(maxV, Math.hypot(run.vx, run.vy));
      bot.update(run, 1 / 120, run.drainEvents().some((e) => e.t === 'break'));
    }
    const r = run.result();
    expect(r.tierUps).toBe(1);
    expect(r.time).toBeGreaterThan(25);
    expect(maxV).toBeLessThan(12);
    applyResult(s, r);
    expect(s.level).toBe(1);
  });
});

describe('mega upgrades & fast-forward', () => {
  it('pickaxe size strikes neighbouring blocks with the same hit', () => {
    const s = newSave();
    s.pickSize = 2;
    const run = new Run({ seed: 2, stats: deriveStats(s), bestDepth: 0, milestones: [] });
    for (let x = 0; x < run.world.width; x++) run.world.set(x, 10, B.DIRT);
    for (let y = 0; y < 10; y++) for (let x = 0; x < run.world.width; x++) run.world.set(x, y, B.AIR);
    run.x = 4.5;
    run.y = 8;
    run.vx = 0;
    run.vy = 8;
    for (let i = 0; i < 120 && run.world.get(4, 10) !== B.AIR; i++) run.step(1 / 120);
    expect(run.world.get(4, 10)).toBe(B.AIR);
    expect(run.world.get(3, 10)).toBe(B.AIR);
    expect(run.world.get(5, 10)).toBe(B.AIR);
  });
  it('shaft width widens the world', async () => {
    const { buyMega, megaCost } = await import('../src/game/economy');
    const s = newSave();
    s.coins = 1e9;
    expect(buyMega(s, 'width')).toBe(true);
    const run = new Run({ seed: 2, stats: deriveStats(s), bestDepth: 0, milestones: [] });
    expect(run.world.width).toBe(11);
    expect(run.world.get(10, 20)).not.toBe(B.BEDROCK);
    expect(megaCost(s, 'width')).toBeGreaterThan(megaCost(newSave(), 'width')!);
  });
  it('fast-forward unlocks at 10 / 30 / 50 seconds', async () => {
    const { FAST_FORWARD } = await import('../src/game/config');
    expect(FAST_FORWARD).toEqual([
      [10, 1.5],
      [30, 2],
      [50, 4],
    ]);
  });
});
