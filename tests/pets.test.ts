import { describe, expect, it } from 'vitest';
import { B } from '../src/game/blocks';
import { deriveStats } from '../src/game/economy';
import { addXp, xpForLevel } from '../src/game/meta';
import { EGG, PET_IDS, PET_LEVEL, addPet, buyEgg, hatchEgg, petPower, rollPet } from '../src/game/pets';
import { Rng } from '../src/game/rng';
import { Run } from '../src/game/run';
import { migrate, newSave } from '../src/game/save';
import { missingKeys } from '../src/ui/i18n';

const runWith = (pet: (typeof PET_IDS)[number], lvl = 1, fill = B.STONE) => {
  const s = newSave();
  s.pets = { [pet]: { lvl, dup: 0 } };
  s.pet = pet;
  const run = new Run({ seed: 4, stats: deriveStats(s), bestDepth: 0, milestones: [] });
  for (let y = 0; y < 120; y++) for (let x = 0; x < run.world.width; x++) if (!run.world.isWall(x)) run.world.set(x, y, y < 6 ? B.AIR : fill);
  run.x = 4.5;
  run.y = 5.5;
  return run;
};
const play = (run: Run, sec: number) => {
  const ev: string[] = [];
  for (let i = 0; i < sec * 120 && !run.over; i++) {
    run.step(1 / 120);
    for (const e of run.drainEvents()) ev.push(e.t);
  }
  return ev;
};

describe('pets', () => {
  it('open at level 7 with a free mole and an egg', () => {
    const s = newSave();
    s.level = PET_LEVEL - 1;
    const eggs = s.eggs;
    addXp(s, xpForLevel(s.level));
    expect(s.level).toBe(PET_LEVEL);
    expect(s.pets.mole?.lvl).toBe(1);
    expect(s.pet).toBe('mole');
    expect(s.eggs).toBe(eggs + 1);
  });
  it('duplicates level a pet up', () => {
    const s = newSave();
    expect(addPet(s, 'cat').isNew).toBe(true);
    expect(addPet(s, 'cat').levelUp).toBe(true); // 1 dupe → level 2
    expect(s.pets.cat?.lvl).toBe(2);
    addPet(s, 'cat');
    expect(addPet(s, 'cat').levelUp).toBe(true); // 2 dupes → level 3
  });
  it('eggs are bought with gems and hatch every rarity', () => {
    const s = newSave();
    s.gems = EGG.price;
    expect(buyEgg(s)).toBe(true);
    expect(buyEgg(s)).toBe(false);
    expect(hatchEgg(s, new Rng(1))).not.toBeNull();
    expect(hatchEgg(s, new Rng(1))).toBeNull();
    const rng = new Rng(7);
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) seen.add(rollPet(rng));
    expect(seen.size).toBe(PET_IDS.length);
  });
  it('higher level = stronger', () => {
    expect(petPower('mole', 5).every!).toBeLessThan(petPower('mole', 1).every!);
    expect(petPower('cat', 5).coins!).toBeGreaterThan(petPower('cat', 1).coins!);
  });
  it('mole digs, magpie steals ore, dragon burns, fairy heals', () => {
    const mole = runWith('mole');
    const b0 = mole.blocks;
    expect(play(mole, 4)).toContain('pet');
    expect(mole.blocks).toBeGreaterThan(b0);
    const mag = runWith('magpie');
    mag.world.set(7, 8, B.GOLD);
    play(mag, 4.5);
    expect(mag.world.get(7, 8)).toBe(B.AIR);
    const dr = runWith('dragon');
    expect(play(dr, 7.5)).toContain('pet');
    const fy = runWith('fairy', 1, B.AIR);
    fy.durability = Math.round(fy.maxDur / 2);
    for (let i = 0; i < 18.5 * 120; i++) {
      fy.y = 5.5; // hover in the air: nothing else touches durability
      fy.vy = 0;
      fy.step(1 / 120);
    }
    expect(fy.durability).toBeGreaterThan(fy.maxDur / 2);
  });
  it('turtle wears less, cat earns more', () => {
    const plain = runWith('cat', 1);
    plain.stats.pet = undefined;
    const turtle = runWith('turtle', 5);
    play(plain, 3);
    play(turtle, 3);
    expect(turtle.maxDur - turtle.durability).toBeLessThan(plain.maxDur - plain.durability);
    const cat = runWith('cat', 5);
    const none = runWith('cat', 5);
    none.stats.pet = undefined;
    expect(cat.blockValue(B.GOLD, 10)).toBeGreaterThan(none.blockValue(B.GOLD, 10));
  });
  it('old saves past level 7 get the gift once', () => {
    const s = migrate({ level: 9, runs: 40 });
    expect(s.pet).toBe('mole');
    expect(s.eggs).toBe(1);
    s.eggs = 0;
    expect(migrate(JSON.parse(JSON.stringify(s))).eggs).toBe(0);
    expect(migrate({ level: 3, runs: 5 }).pet).toBe('');
  });
  it('texts exist in both languages', () => {
    expect(missingKeys()).toEqual([]);
  });
});
