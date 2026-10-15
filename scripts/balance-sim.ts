/**
 * Headless balance simulation: a greedy bot plays the real Run simulation,
 * applies results and buys upgrades between runs.
 *   npm run sim -- [maxRuns] [seed] [--diff=easy|normal|hard]
 */
import { BIOMES, BOOST_IDS, CAMPAIGN_DEPTH, PRESTIGE, type UpgradeId } from '../src/game/config';
import { FEATURE_LEVEL } from '../src/game/meta';
import { buyDashDown, dashDownCost, buyDynamite, buyForge, buyMega, megaCost, buyUpgrade, canPrestige, deriveStats, doPrestige, dynamiteCost, forgeCost, upgradeCost, upgradeDef } from '../src/game/economy';
import { Bot } from '../src/game/bot';
import { applyResult, buyLiftStop, nextLiftStop, unlockedCheckpoints } from '../src/game/progress';
import { Run } from '../src/game/run';
import { eventGoalFor, recordRun } from '../src/game/profile';
import { newSave } from '../src/game/save';

const maxRuns = Number(process.argv[2] ?? 300);
let seed = Number(process.argv[3] ?? 1);
const BUY: UpgradeId[] = ['durability', 'power', 'fortune', 'luck', 'crit', 'weight', 'control', 'blast'];
const WEIGHT: Record<UpgradeId, number> = { durability: 1, power: 1, fortune: 1.2, luck: 1.6, crit: 1.8, weight: 2, control: 3, blast: 3 };

const save = newSave();
const diffArg = process.argv.find((a) => a.startsWith('--diff='));
save.difficulty = (diffArg?.slice(7) as typeof save.difficulty) || 'normal';
const reached = new Map<number, { run: number; minutes: number }>();
let minutes = 0;
let lastLog = 0;
let eventsOn = false;
let totalEvents = 0;
let eventRuns = 0;
let missionsLog: string[] = [];
let lastMissionMark = 0;
let lastMissionMin = 0;
const noBoosts = process.argv.includes('--noboosts');

for (let i = 1; i <= maxRuns; i++) {
  const cps = unlockedCheckpoints(save).filter((d) => d <= save.bestDepth * 0.7);
  save.startDepth = cps[cps.length - 1] ?? 0;
  save.profile.playSec = minutes * 60;
  const eventGoal = eventGoalFor(save);
  if (eventGoal && !eventsOn) {
    eventsOn = true;
    console.log(`  ✦ mine events unlocked at ~${minutes.toFixed(0)} min (run ${i}, goal ${eventGoal} blocks)`);
  }
  if (save.level >= FEATURE_LEVEL.boosts && !noBoosts) {
    save.loadout = [...BOOST_IDS].sort((a, b) => (b === 'dynamite' ? save.dynamite : save.boosts[b]) - (a === 'dynamite' ? save.dynamite : save.boosts[a])).slice(0, 3);
  }
  if (noBoosts) save.boosts = { giant: 0, twin: 0, teleport: 0, shield: 0 };
  const run = new Run({ seed: seed++, stats: deriveStats(save), bestDepth: save.bestDepth, milestones: save.milestones, eventGoal });
  const bot = new Bot(0.75);
  const dt = 1 / 60;
  let tierUps = 0;
  while (!run.over && run.time < 600) {
    run.step(dt);
    const ev = run.drainEvents();
    if (ev.some((e) => e.t === 'tierUp')) tierUps++;
    bot.update(run, dt, ev.some((e) => e.t === 'break'));
  }
  const r = run.result();
  const before = JSON.stringify(save.missions.list.map((m) => `${m.scope}:${m.type} ${m.progress}/${m.target}`));
  const rep = applyResult(save, r);
  if (process.argv.includes("--mdebug") && i <= 12) console.log("   missions", before, "->", rep.missionsDone.length);
  if (minutes - lastMissionMin >= 15 || i <= 6) {
    missionsLog.push(`${i <= 6 ? 'run ' + i : '~' + Math.round(minutes) + ' min'}: ${((save.missions.done - lastMissionMark) / Math.max(1, i <= 6 ? 1 : (i - (missionsLog as unknown as { lastI?: number }).lastI!))).toFixed(2)}/run`);
    (missionsLog as unknown as { lastI?: number }).lastI = i;
    lastMissionMark = save.missions.done;
    lastMissionMin = minutes;
  }
  void rep;
  recordRun(save, r, 0);
  totalEvents += r.events;
  if (eventsOn) eventRuns++;
  minutes += r.time / 60 + 0.25; // + time in menus
  for (let b = 1; b < BIOMES.length; b++) if (r.depth >= BIOMES[b].from && !reached.has(b)) reached.set(b, { run: i, minutes });
  if (r.core && !reached.has(99)) reached.set(99, { run: i, minutes });

  // elevator stops: buy as soon as affordable (they save a lot of time)
  for (let stop = nextLiftStop(save); stop && save.coins >= stop.cost; stop = nextLiftStop(save)) {
    buyLiftStop(save, stop.depth);
    console.log(`  ⇩ lift ${stop.depth}m at ~${minutes.toFixed(0)} min (cost ${stop.cost})`);
  }
  // mega upgrades first: they are the big goals players save for
  for (const id of (['size', 'width'] as const).filter((m) => !process.argv.includes('--no' + m))) {
    const c = megaCost(save, id);
    if (c !== null && save.coins >= c && buyMega(save, id)) {
      console.log(`  ★ ${id} → ${id === 'size' ? save.pickSize : save.shaftWidth} at ~${minutes.toFixed(0)} min (run ${i}, cost ${c}, earned so far ${Math.round(save.totalCoins)})`);
    }
  }
  {
    const c = dashDownCost(save);
    if (c !== null && save.coins >= c && !process.argv.includes('--nodown') && buyDashDown(save)) console.log(`  ⇓ dash-down → ${save.dashDown} at ~${minutes.toFixed(0)} min (cost ${c})`);
  }
  // spend: forge first when affordable, then cheapest weighted upgrade
  for (;;) {
    const fc = forgeCost(save);
    if (fc !== null && save.coins >= fc) { buyForge(save); continue; }
    let best: UpgradeId | null = null;
    let bestScore = Infinity;
    for (const id of BUY) {
      if (save.upgrades[id] >= upgradeDef(id).max) continue;
      const c = upgradeCost(id, save.upgrades[id]) * WEIGHT[id];
      if (c < bestScore) { bestScore = c; best = id; }
    }
    if (fc !== null && bestScore > fc * 0.25) break; // save up for forge
    if (!best || !buyUpgrade(save, best)) break;
  }
  if (save.dynamite < 2 && save.coins > dynamiteCost(save) * 5) buyDynamite(save);

  if (i <= 10 || i - lastLog >= 10 || r.core) {
    lastLog = i;
    console.log(
      `run ${String(i).padStart(3)} | ${r.time.toFixed(0).padStart(3)}s | start ${String(save.startDepth).padStart(3)} → ${String(r.depth).padStart(4)}m | coins +${String(r.totalCoins).padStart(7)} | tier ${r.tier} (+${tierUps}) | combo ${r.bestCombo} | forge ${save.forgeTier} | ` +
        BUY.map((id) => `${id.slice(0, 3)}${save.upgrades[id]}`).join(' '),
    );
  }
  if (r.core) break;
  if (canPrestige(save) && save.bestDepth >= PRESTIGE.unlockDepth + 200 && save.prestiges === 0 && process.argv.includes('--prestige')) {
    console.log(`  ⟳ prestige: +${doPrestige(save)} shards`);
  }
}

console.log('\nMilestones:');
for (const [b, v] of [...reached.entries()].sort((a, c) => a[0] - c[0])) {
  const name = b === 99 ? `core (${CAMPAIGN_DEPTH}m)` : `${BIOMES[b].key} (${BIOMES[b].from}m)`;
  console.log(`  ${name.padEnd(18)} run ${String(v.run).padStart(3)}  ~${v.minutes.toFixed(0)} min`);
}
console.log('missions: ' + missionsLog.join(' | '));
console.log(`missions done ${save.missions.done}, boosts left ${JSON.stringify(save.boosts)} dyn ${save.dynamite}`);
console.log(`events per run (after unlock): ${(totalEvents / Math.max(1, eventRuns)).toFixed(2)}`);
console.log(`\nbest depth ${save.bestDepth}, coins ${Math.round(save.coins)}, gems ${save.gems}`);
