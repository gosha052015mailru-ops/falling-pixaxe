/**
 * New-player playtest: simulates the first N runs exactly as a fresh install
 * (tutorial run first), with a beginner-level bot that buys upgrades between
 * runs. Reports the "feel" numbers: run length, fall speed, hits per block,
 * tier-ups, player levels, banners and popups per run.
 *   npm run playtest -- [runs] [seed] [--diff=normal]
 */
import { UPGRADES, type UpgradeId } from '../src/game/config';
import { buyUpgrade, canBuyUpgrade, deriveStats, upgradeCost } from '../src/game/economy';
import { Bot } from '../src/game/bot';
import { applyResult } from '../src/game/progress';
import { Run } from '../src/game/run';
import { newSave } from '../src/game/save';

const runs = Number(process.argv[2] ?? 6);
let seed = Number(process.argv[3] ?? 3);
const diffArg = process.argv.find((a) => a.startsWith('--diff='));

const save = newSave();
save.difficulty = (diffArg?.slice(7) as typeof save.difficulty) || 'normal';
const BANNER_EVENTS = new Set(['tierUp', 'heal', 'chest', 'furnace', 'enchant', 'milestone', 'totem', 'core', 'fever']);

console.log('run | time | depth | blocks | hits/blk | m/s | max v | tierUps | banners | lvl  | coins');
for (let i = 1; i <= runs; i++) {
  const tutorial = i === 1;
  const run = new Run({ seed: seed++, stats: deriveStats(save), bestDepth: save.bestDepth, milestones: save.milestones, tutorial });
  if (tutorial) run.nudge(1);
  const bot = new Bot(0.45);
  const dt = 1 / 120;
  let hits = 0;
  let banners = 0;
  let maxV = 0;
  while (!run.over && run.time < 900) {
    run.step(dt);
    maxV = Math.max(maxV, Math.hypot(run.vx, run.vy));
    const ev = run.drainEvents();
    for (const e of ev) {
      if (e.t === 'hit') hits++;
      if (BANNER_EVENTS.has(e.t)) banners++;
    }
    bot.update(run, dt, ev.some((e) => e.t === 'break'));
  }
  const r = run.result();
  const lvlBefore = save.level;
  applyResult(save, r);
  const pickBlocks = Math.max(1, r.blocks);
  console.log(
    `${String(i).padStart(3)} | ${r.time.toFixed(0).padStart(4)}s | ${String(r.depth).padStart(4)}m | ${String(r.blocks).padStart(6)} | ${((hits + pickBlocks) / pickBlocks).toFixed(2).padStart(8)} | ${(r.depth / Math.max(1, r.time)).toFixed(2).padStart(4)} | ${maxV.toFixed(1).padStart(5)} | ${String(r.tierUps).padStart(7)} | ${String(banners).padStart(7)} | ${lvlBefore}→${save.level} | ${r.totalCoins}`,
  );
  // beginner shopping: cheapest affordable upgrade first
  for (;;) {
    const cand = UPGRADES.map((u) => u.id as UpgradeId)
      .filter((id) => canBuyUpgrade(save, id))
      .sort((a, b) => upgradeCost(a, save.upgrades[a]) - upgradeCost(b, save.upgrades[b]));
    if (!cand.length || !buyUpgrade(save, cand[0])) break;
  }
}
