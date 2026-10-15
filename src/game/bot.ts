import { blockDef } from './blocks';
import { BOOST_IDS } from './config';
import type { Run } from './run';

/**
 * Simple autopilot: steers toward the softest column below and throws
 * dynamite when it has been stuck bouncing for a while. Used by the balance
 * simulation and the menu background.
 */
export class Bot {
  private sinceBreak = 0;
  private think = 0;

  constructor(private readonly skill = 0.7) {}

  update(run: Run, dt: number, brokeSomething: boolean): void {
    this.sinceBreak = brokeSomething ? 0 : this.sinceBreak + dt;
    this.think -= dt;
    if (this.think > 0) return;
    this.think = 0.35 + (1 - this.skill) * 0.6;

    if (this.sinceBreak > 1.6 && run.dynamite > 0) {
      run.useDynamite();
      this.sinceBreak = 0;
      return;
    }
    // power-ups: teleport when stuck, the rest now and then
    const ready = BOOST_IDS.filter((id) => id !== 'dynamite' && run.boostCount(id) > 0 && run.boostActive(id) <= 0);
    if (ready.length && run.time > 3) {
      if (this.sinceBreak > 1.2 && ready.includes('teleport')) {
        run.useBoost('teleport');
        return;
      }
      if (run.rng.chance(0.04)) {
        run.useBoost(run.rng.pick(ready));
        return;
      }
    }
    if (run.stats.dashDownBlocks > 0 && run.nudges > 0 && run.rng.chance(0.25)) {
      run.dash(0, run.rng.range(0.4, 1));
      return;
    }
    if (run.nudges <= 0 || run.rng.next() > this.skill) return;

    const cx = Math.floor(run.x);
    const cy = Math.floor(run.y);
    let bestX = cx;
    let bestCost = Infinity;
    for (let x = 0; x < run.world.width; x++) {
      let cost = Math.abs(x - cx) * 2;
      for (let dy = 1; dy <= 4; dy++) {
        const def = blockDef(run.world.get(x, cy + dy));
        if (def.special && def.special !== 'slime') cost -= 25 / dy;
        else if (def.solid) cost += Math.min(def.hp, 200) / run.damagePerHit / dy;
      }
      if (cost < bestCost) {
        bestCost = cost;
        bestX = x;
      }
    }
    const target = bestX + 0.5;
    if (Math.abs(target - run.x) > 0.8 && Math.sign(target - run.x) !== Math.sign(run.vx || 0.0001) ) {
      run.dash(target > run.x ? 1 : -1, run.rng.range(0.2, 0.9));
    }
  }
}
