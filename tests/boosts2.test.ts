import { describe, expect, it } from 'vitest';
import { B } from '../src/game/blocks';
import type { BoostId } from '../src/game/config';
import { deriveStats } from '../src/game/economy';
import { applyResult } from '../src/game/progress';
import { Run } from '../src/game/run';
import { migrate, newSave } from '../src/game/save';

const mk = (loadout: BoostId[], fill: B = B.STONE) => {
  const s = newSave();
  s.level = 10;
  for (const id of loadout) if (id !== 'dynamite') s.boosts[id] = 2;
  s.dynamite = 2;
  s.loadout = loadout;
  const run = new Run({ seed: 9, stats: deriveStats(s), bestDepth: 0, milestones: [] });
  for (let y = 0; y < 120; y++) for (let x = 0; x < run.world.width; x++) if (!run.world.isWall(x)) run.world.set(x, y, y < 6 ? B.AIR : fill);
  run.x = 4.5;
  run.y = 5.5;
  run.step(1 / 120);
  return { run, s };
};
const steps = (run: Run, sec: number) => {
  for (let i = 0; i < sec * 120 && !run.over; i++) run.step(1 / 120);
};

const collect = (run: Run, sec: number) => {
  const ev: string[] = [];
  for (let i = 0; i < sec * 120 && !run.over; i++) {
    run.step(1 / 120);
    for (const e of run.drainEvents()) ev.push(e.t);
  }
  return ev;
};

describe('new power-ups', () => {
  it('lightning arcs into nearby blocks of the same kind', () => {
    const { run } = mk(['lightning']);
    expect(run.useBoost('lightning')).toBe(true);
    const ev = collect(run, 1);
    expect(ev).toContain('zap');
  });
  it('black hole swallows a ball of rock', () => {
    const { run } = mk(['blackhole']);
    const b0 = run.blocks;
    run.useBoost('blackhole');
    steps(run, 4);
    expect(run.hole).toBeNull();
    expect(run.blocks - b0).toBeGreaterThan(20);
  });
  it('rockets fly to ores and blow them up', () => {
    const { run } = mk(['rockets']);
    run.world.set(2, 12, B.GOLD);
    run.world.set(7, 15, B.GOLD);
    run.useBoost('rockets');
    expect(run.projectiles.length).toBeGreaterThan(0);
    steps(run, 2);
    expect(run.projectiles.length).toBe(0);
    expect(run.world.get(2, 12)).toBe(B.AIR);
    expect(run.world.get(7, 15)).toBe(B.AIR);
  });
  it('laser cuts whole rows', () => {
    const { run } = mk(['laser']);
    run.useBoost('laser');
    const b0 = run.blocks;
    steps(run, 2);
    expect(run.blocks - b0).toBeGreaterThan(run.world.width * 2);
  });
  it('phantom falls through rock, collects ore and spends no durability', () => {
    const { run } = mk(['phantom']);
    run.world.set(4, 14, B.GOLD);
    const d0 = run.durability;
    const y0 = run.y;
    run.useBoost('phantom');
    steps(run, 1);
    expect(run.y - y0).toBeGreaterThan(8);
    expect(run.world.get(4, 14)).toBe(B.AIR);
    expect(run.world.get(4, 10)).toBe(B.STONE); // plain rock is left in place
    expect(run.durability).toBe(d0);
    steps(run, 2);
    expect(run.phantomTimer).toBe(0);
  });
});

describe('mystery events', () => {
  it('alchemy turns rock to ore, then back', () => {
    const { run } = mk([]);
    run.startEvent('alchemy');
    const row = Math.floor(run.y) + 6;
    const ores = [...Array(run.world.width).keys()].filter((x) => !run.world.isWall(x) && run.world.get(x, row) !== B.STONE).length;
    expect(ores).toBeGreaterThan(3);
    steps(run, 6);
    expect(run.alchemyTimer).toBe(0);
  });
  it('turbo speeds up the fall, quake shatters, stars fall, chain reacts', () => {
    const a = mk([], B.AIR).run;
    const b = mk([], B.AIR).run;
    b.startEvent('turbo');
    steps(a, 0.6);
    steps(b, 0.6);
    expect(b.y).toBeGreaterThan(a.y + 0.5);
    const q = mk([]).run;
    const q0 = q.blocks;
    q.startEvent('quake');
    expect(q.blocks - q0).toBeGreaterThan(15);
    const s = mk([]).run;
    s.startEvent('starfall');
    expect(s.projectiles.length).toBeGreaterThan(5);
    steps(s, 4);
    expect(s.projectiles.length).toBe(0);
    const c = mk([]).run;
    c.startEvent('chain');
    expect(c.chainTimer).toBeGreaterThan(0);
  });
  it('the ? block starts a big event', () => {
    const { run } = mk([]);
    run.world.set(4, 6, B.MYSTERY);
    const ev = collect(run, 1);
    expect(run.mysteries).toBe(1);
    expect(ev).toContain('mystery');
    expect(run.eventsFired).toBeGreaterThan(0);
  });
});

describe('supply crate', () => {
  it('+1 to every power-up in the loadout, kept after the run', () => {
    const { run, s } = mk(['dynamite', 'rockets', 'laser']);
    run.world.set(4, 6, B.SUPPLY);
    steps(run, 1);
    expect(run.supplies).toBe(1);
    expect(run.boostCount('rockets')).toBe(3);
    expect(run.boostCount('laser')).toBe(3);
    expect(run.boostCount('dynamite')).toBe(3);
    run.useBoost('rockets');
    applyResult(s, run.result());
    expect(s.boosts.rockets).toBe(2);
    expect(s.boosts.laser).toBe(3);
  });
});

describe('save', () => {
  it('existing players get a starter pack of the new power-ups', () => {
    const old = { level: 7, runs: 30, boosts: { giant: 1, twin: 0, teleport: 0, shield: 0, magnet: 0, meteor: 0 } };
    const s = migrate(old);
    expect(s.boosts.phantom).toBe(2);
    expect(s.boosts.giant).toBe(1);
    expect(migrate(s).boosts.phantom).toBe(2);
  });
});
