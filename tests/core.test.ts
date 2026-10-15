import { describe, expect, it } from 'vitest';
import { B } from '../src/game/blocks';
import { BIOMES, CAMPAIGN_DEPTH, TIERS, WORLD_W } from '../src/game/config';
import { buyUpgrade, deriveStats, doPrestige, niceRound, prestigeShards, upgradeCost } from '../src/game/economy';
import { applyResult } from '../src/game/progress';
import { Rng } from '../src/game/rng';
import { Run } from '../src/game/run';
import { migrate, newSave } from '../src/game/save';
import { World, blockHp } from '../src/game/world';

const mkRun = (seed = 1, mutate?: (s: ReturnType<typeof newSave>) => void) => {
  const save = newSave();
  mutate?.(save);
  return new Run({ seed, stats: deriveStats(save), bestDepth: save.bestDepth, milestones: save.milestones });
};

describe('rng', () => {
  it('is deterministic', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });
});

describe('world', () => {
  it('generates the same mine for the same seed', () => {
    const a = new World(7);
    const b = new World(7);
    for (let y = 0; y < 300; y++) for (let x = 0; x < WORLD_W; x++) expect(a.get(x, y)).toBe(b.get(x, y));
  });
  it('has walls, a grass top and the core at the bottom', () => {
    const w = new World(3);
    expect(w.get(-1, 10)).toBe(B.BEDROCK);
    expect(w.get(WORLD_W, 10)).toBe(B.BEDROCK);
    expect(w.get(4, -2)).toBe(B.AIR);
    for (let x = 0; x < WORLD_W; x++) expect(w.get(x, 0)).toBe(B.GRASS);
    expect(w.get(0, CAMPAIGN_DEPTH)).toBe(B.CORE);
  });
  it('scales block hp with depth', () => {
    expect(blockHp(B.STONE, 0)).toBe(3);
    expect(blockHp(B.STONE, 400)).toBeGreaterThan(3 * 6);
    expect(blockHp(B.WORKBENCH, 400)).toBe(1);
  });
  it('spawns specials in every biome', () => {
    const w = new World(11);
    const seen = new Set<number>();
    for (let y = 0; y < CAMPAIGN_DEPTH; y++) for (let x = 0; x < WORLD_W; x++) seen.add(w.get(x, y));
    for (const id of [B.WORKBENCH, B.ANVIL, B.TNT, B.CHEST, B.FURNACE, B.ENCHANT, B.SLIME, B.LAVA, B.STARORE]) {
      expect(seen.has(id)).toBe(true);
    }
  });
});

describe('economy', () => {
  it('rounds prices and grows them', () => {
    expect(niceRound(1234)).toBe(1200);
    expect(upgradeCost('power', 5)).toBeGreaterThan(upgradeCost('power', 4));
  });
  it('buys upgrades only when affordable', () => {
    const s = newSave();
    expect(buyUpgrade(s, 'durability')).toBe(false);
    s.coins = 1000;
    expect(buyUpgrade(s, 'durability')).toBe(true);
    expect(s.upgrades.durability).toBe(1);
    expect(s.coins).toBe(1000 - upgradeCost('durability', 0));
  });
  it('prestige resets upgrades and grants shards', () => {
    const s = newSave();
    s.bestDepth = 500;
    s.cycleCoins = 5000 * 16;
    s.upgrades.power = 10;
    expect(prestigeShards(s)).toBe(4);
    expect(doPrestige(s)).toBe(4);
    expect(s.upgrades.power).toBe(0);
    expect(deriveStats(s).coinMult).toBeCloseTo(1.2);
  });
  it('migrates partial saves', () => {
    const s = migrate({ coins: 50, upgrades: { power: 3 } });
    expect(s.coins).toBe(50);
    expect(s.upgrades.power).toBe(3);
    expect(s.upgrades.durability).toBe(0);
    expect(s.settings.sound).toBe(true);
  });
});

describe('run', () => {
  it('falls, breaks blocks, spends durability and ends', () => {
    const run = mkRun(5);
    let steps = 0;
    while (!run.over && steps < 60 * 600) {
      run.step(1 / 60);
      steps++;
    }
    expect(run.over).toBe(true);
    const r = run.result();
    expect(r.depth).toBeGreaterThan(3);
    expect(r.blocks).toBeGreaterThan(3);
    expect(r.totalCoins).toBeGreaterThan(0);
    expect(run.durability).toBe(0);
  });
  it('workbench raises the tier', () => {
    const run = mkRun(1);
    run.world.set(Math.floor(run.x), run.world.startDepth, B.WORKBENCH);
    for (let i = 0; i < 120 && run.tier === 0; i++) run.step(1 / 60);
    expect(run.tier).toBe(1);
    expect(run.maxDur).toBe(Math.round(deriveStats(newSave()).maxDurBase * TIERS[1].dur));
  });
  it('dynamite clears blocks below the pickaxe', () => {
    const run = mkRun(2);
    run.y = 5.5;
    run.x = 4.5;
    run.vy = 0;
    const before = run.blocks;
    expect(run.useDynamite()).toBe(true);
    expect(run.blocks).toBeGreaterThan(before + 3);
    expect(run.world.get(4, 6)).toBe(B.AIR);
  });
  it('tnt chains', () => {
    const run = mkRun(3);
    run.y = -20; // keep the pickaxe out of the way
    for (let x = 0; x < WORLD_W; x += 2) run.world.set(x, 30, B.TNT);
    run.world.set(0, 31, B.TNT);
    (run as unknown as { queueBlast: (x: number, y: number, r: number, f: number, c: number) => void }).queueBlast(0.5, 30.5, 1, 0, 0);
    for (let i = 0; i < 120; i++) run.step(1 / 60);
    const chains = run.events.filter((e) => e.t === 'explode').length;
    expect(chains).toBeGreaterThanOrEqual(5);
  });
  it('pays milestones once', () => {
    const save = newSave();
    const run = mkRun(4);
    run.y = BIOMES[1].from + 0.5;
    run.step(1 / 60);
    const r = run.result();
    expect(r.newMilestones).toContain(1);
    applyResult(save, r);
    expect(save.milestones).toContain(1);
    expect(save.gems).toBe(r.gems);
  });
});
