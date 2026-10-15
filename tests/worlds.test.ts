import { describe, expect, it } from 'vitest';
import { B } from '../src/game/blocks';
import { WORLDS, WORLD_W } from '../src/game/config';
import { boostAvailable, boostOpen, buyBoost, deriveStats, forgeCost, forgeMax, toggleLoadout } from '../src/game/economy';
import { applyResult, switchWorld } from '../src/game/progress';
import { Run } from '../src/game/run';
import { migrate, newSave, type SaveData } from '../src/game/save';
import { World } from '../src/game/world';

function worldSave(world: number): SaveData {
  const s = newSave();
  s.difficulty = 'normal';
  s.tutorialDone = true;
  s.worldsOpen = world + 1;
  s.forgeTier = WORLDS[world].baseTier;
  switchWorld(s, world);
  return s;
}

function runIn(s: SaveData, seed = 3): Run {
  const run = new Run({ seed, stats: deriveStats(s), bestDepth: 0, milestones: [] });
  // let the pickaxe land and settle into normal play
  for (let i = 0; i < 30; i++) run.step(1 / 60);
  return run;
}

/** Clear a pocket around the pickaxe and put one block right under it. */
function placeBelow(run: Run, id: B): [number, number] {
  const x = Math.floor(run.x);
  const y = Math.max(0, Math.floor(run.y) + 1);
  for (let yy = 0; yy < y; yy++) run.world.set(x, yy, B.AIR);
  run.world.set(x, y, id);
  return [x, y];
}

describe('worlds', () => {
  it('keeps a separate record, elevator and milestones per world', () => {
    const s = newSave();
    s.worldsOpen = 2;
    s.bestDepth = 640;
    s.liftStops = [20, 100];
    s.milestones = [1, 2, 3];
    s.startDepth = 100;
    expect(switchWorld(s, 1)).toBe(true);
    expect(s.world).toBe(1);
    expect(s.bestDepth).toBe(0);
    expect(s.liftStops).toEqual([]);
    expect(s.startDepth).toBe(0);
    s.bestDepth = 42;
    switchWorld(s, 0);
    expect(s.bestDepth).toBe(640);
    expect(s.liftStops).toEqual([20, 100]);
    expect(s.milestones).toEqual([1, 2, 3]);
    switchWorld(s, 1);
    expect(s.bestDepth).toBe(42);
    expect(switchWorld(s, 2)).toBe(false); // not open yet
  });

  it('reaching the Core opens the next world and raises the forge floor', () => {
    const s = worldSave(0);
    const run = runIn(s);
    const r = { ...run.result(), core: true, depth: 1000 };
    const rep = applyResult(s, r, 1, Date.now());
    expect(rep.worldOpened).toBe(1);
    expect(s.worldsOpen).toBe(2);
    expect(s.forgeTier).toBe(WORLDS[1].baseTier);
    // the forge now goes up to the new world's best pickaxe
    expect(forgeMax(s)).toBe(WORLDS[1].maxTier);
    expect(forgeCost(s)).not.toBeNull();
  });

  it('world power-ups only work at home and are sold only once their world is open', () => {
    const s = worldSave(0);
    s.coins = 1e12;
    expect(boostOpen(s, 'magnet')).toBe(false);
    expect(buyBoost(s, 'magnet')).toBe(false);
    s.worldsOpen = 3;
    expect(buyBoost(s, 'magnet')).toBe(true);
    expect(boostAvailable(s, 'magnet')).toBe(false);
    expect(toggleLoadout(s, 'magnet', 3)).toBe(false);
    switchWorld(s, 1);
    expect(toggleLoadout(s, 'magnet', 3)).toBe(true);
    expect(deriveStats(s).boosts.magnet).toBeGreaterThan(0);
    // leaving the world drops it from the loadout
    switchWorld(s, 2);
    expect(s.loadout).not.toContain('magnet');
    expect(deriveStats(s).boosts.magnet ?? 0).toBe(0);
  });

  it('later worlds have tougher rock and richer ore than the earth core', () => {
    const earth = new World(1, 0, 1, undefined, 1, WORLD_W, 0);
    const frost = new World(1, 0, 1, undefined, 1, WORLD_W, 1);
    const ruins = new World(1, 0, 1, undefined, 1, WORLD_W, 2);
    expect(frost.fullHp(B.SNOW, 0)).toBeGreaterThan(earth.fullHp(B.GRASS, 0) * 100);
    expect(frost.fullHp(B.FROSTSTONE, 999)).toBeGreaterThan(frost.fullHp(B.SNOW, 0));
    expect(ruins.fullHp(B.SAND, 0)).toBeGreaterThan(frost.fullHp(B.SNOW, 0));
    expect(frost.offset).toBe(1000);
    expect(earth.get(3, 0)).toBe(B.GRASS);
    expect(frost.get(3, 0)).toBe(B.SNOW);
    expect(ruins.get(3, 0)).toBe(B.SAND);
  });

  it('an ice rift drops the pickaxe straight through the ice', () => {
    const run = runIn(worldSave(1));
    const [, y] = placeBelow(run, B.RIFT);
    for (let i = 0; i < 120 && run.rifts === 0; i++) run.step(1 / 60);
    expect(run.rifts).toBe(1);
    for (let i = 0; i < 60; i++) run.step(1 / 60);
    expect(run.depth).toBeGreaterThanOrEqual(y + 6);
  });

  it('a rune grants a blessing', () => {
    const run = runIn(worldSave(2));
    placeBelow(run, B.RUNE);
    run.durability = run.maxDur * 0.5;
    const before = run.durability;
    for (let i = 0; i < 120 && run.runes === 0; i++) run.step(1 / 60);
    expect(run.runes).toBe(1);
    const blessed = run.mightTimer > 0 || run.goldTimer > 0 || run.shieldTimer > 0 || run.durability > before;
    expect(blessed).toBe(true);
  });

  it('the magnet rips out ore around the pickaxe', () => {
    const s = worldSave(1);
    s.boosts.magnet = 1;
    s.loadout = ['magnet'];
    const run = runIn(s);
    const x = Math.floor(run.x);
    const y = Math.floor(run.y);
    run.world.set(x + 1, y + 1, B.SILVER);
    expect(run.useBoost('magnet')).toBe(true);
    for (let i = 0; i < 20; i++) run.step(1 / 60);
    expect(run.world.get(x + 1, y + 1)).not.toBe(B.SILVER);
  });

  it('the meteor burns a shaft down without wearing the pickaxe', () => {
    const s = worldSave(2);
    s.boosts.meteor = 1;
    s.loadout = ['meteor'];
    const run = runIn(s);
    const d0 = run.depth;
    const dur = run.durability;
    expect(run.useBoost('meteor')).toBe(true);
    for (let i = 0; i < 60; i++) run.step(1 / 60);
    expect(run.depth - d0).toBeGreaterThanOrEqual(8);
    expect(run.durability).toBeGreaterThanOrEqual(dur);
  });

  it('old saves that reached the Core get the second world', () => {
    const s = migrate({ runs: 50, bestDepth: 1000, coreReached: true });
    expect(s.worldsOpen).toBe(2);
    expect(s.world).toBe(0);
    const fresh = migrate({ runs: 5, bestDepth: 300 });
    expect(fresh.worldsOpen).toBe(1);
  });
});
