import { analyticsExport, analyticsLog, eventCounts, track } from '../analytics';

const analyticsLogSize = () => analyticsLog().length;
import { music } from '../audio/music';
import { sfx } from '../audio/sfx';
import { BLOCKS } from '../game/blocks';
import { BIOMES, BOOST_IDS, BOOSTS, DASH_DOWN, DIFFICULTY, LOADOUT_SIZE, MAX_TIER, MEGA, PRESTIGE, SHOP, TIERS, UPGRADES, WORLD_W, type BoostId, type Difficulty, type MegaId, type UpgradeId } from '../game/config';
import {
  buyBoost,
  buyDashDown,
  boostCost,
  boostOwned,
  dashDownCost,
  toggleLoadout,
  buyForge,
  buyMega,
  megaCost,
  buyTotem,
  buyUpgrade,
  canBuyUpgrade,
  canPrestige,
  deriveStats,
  doPrestige,
  forgeCost,
  prestigeShards,
  upgradeCost,
  upgradeDef,
} from '../game/economy';
import {
  ACHIEVEMENTS,
  COLLECTIBLE,
  DAILY,
  FEATURE_LEVEL,
  achievementClaimable,
  achievementGems,
  achievementsClaimable,
  claimAchievement,
  claimDaily,
  collectIdle,
  dailyStatus,
  freeChestReady,
  idleFull,
  idlePending,
  levelReward,
  openFreeChest,
  rewardScale,
  ensureMissions,
  missionsSkipReady,
  progressMissions,
  skipMission,
  xpForLevel,
  type ChestRarity,
  type Feature,
  type Reward,
} from '../game/meta';
import { RETENTION_DAYS, playerMetrics } from '../game/profile';
import { buyLiftStop, nextGoal, nextLiftStop, unlockedCheckpoints } from '../game/progress';
import { dayKey } from '../game/time';
import { pushPermission, requestPush } from '../notifications';
import { Rng } from '../game/rng';
import { isNative, setVibration, vibrate } from '../platform';
import type { App } from './app';
import { $, bar, closeModal, hms, modalOpen, openModal, rewardTiles, toast } from './dom';
import { fmt } from './format';
import { missionText, setLang, t } from './i18n';
import { BOOST_ICON, UPGRADE_ICON, icon } from './icons';

/** Features that unlock exactly at this level. */
function featuresAt(level: number): Feature[] {
  return (Object.keys(FEATURE_LEVEL) as Feature[]).filter((f) => FEATURE_LEVEL[f] === level);
}

export type ScreenId = 'home' | 'upgrades' | 'forge' | 'quests' | 'collection' | 'shop' | 'settings' | 'profile';

const NAV: { id: ScreenId; icon: string; label: string; feature: Feature }[] = [
  { id: 'upgrades', icon: 'hammer', label: 'upgrades', feature: 'upgrades' },
  { id: 'forge', icon: 'fire', label: 'forge', feature: 'forge' },
  { id: 'home', icon: 'home', label: 'play', feature: 'upgrades' },
  { id: 'quests', icon: 'scroll', label: 'quests', feature: 'quests' },
  { id: 'shop', icon: 'bag', label: 'shop', feature: 'items' },
];

export class Screens {
  private host = $('screen');
  private questTab: 'quests' | 'achievements' = 'quests';
  private confirmPrestige = false;
  private popupQueue: (() => void)[] = [];
  private dailyShownOn = '';
  /** Depth of the elevator stop waiting for a confirming second tap (0 = none). */
  private confirmLift = 0;
  private confirmReset = false;

  constructor(private app: App) {}

  private get s() {
    return this.app.save;
  }

  // ───────────────────────── plumbing ─────────────────────────

  clear(): void {
    this.host.className = 'screen';
    this.host.innerHTML = '';
  }

  private set(html: string, cls: string): void {
    this.host.className = `screen ${cls}`;
    this.host.innerHTML = html;
    this.host.scrollTop = 0;
  }

  private on(sel: string, fn: (el: HTMLElement) => void, root: ParentNode = this.host): void {
    root.querySelectorAll<HTMLElement>(sel).forEach((el) =>
      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        sfx.unlock();
        fn(el);
      }),
    );
  }

  private wallet(): string {
    const s = this.s;
    return `<div class="wallet">
      <span class="pill" id="wCoins">${icon('coin', 32)}${fmt(s.coins)}</span>
      <span class="pill" id="wGems">${icon('gem', 32)}${fmt(s.gems)}</span>
      ${s.shards ? `<span class="pill">${icon('shard', 32)}${s.shards}</span>` : ''}
    </div>`;
  }

  private header(title: string, wallet = true): string {
    return `<div class="topbar"><button class="icon-btn" data-a="back">${icon('back', 26)}</button><h2>${title}</h2>${wallet ? this.wallet() : ''}</div>`;
  }

  private bindHeader(): void {
    this.on('[data-a=back]', () => {
      sfx.click();
      this.show('home');
    });
  }

  show(id: ScreenId): void {
    this.app.goMenu();
    this.app.screen = id;
    this.confirmPrestige = false;
    this.confirmReset = false;
    this.confirmLift = 0;
    track('screen_view', { id });
    switch (id) {
      case 'home':
        this.home();
        break;
      case 'upgrades':
        this.upgrades();
        break;
      case 'forge':
        this.forge();
        break;
      case 'quests':
        this.quests();
        break;
      case 'collection':
        this.collection();
        break;
      case 'shop':
        this.shop();
        break;
      case 'settings':
        this.settings();
        break;
      case 'profile':
        this.profile();
        break;
    }
    this.nav(true);
  }

  private rerender(): void {
    this.show(this.app.screen);
  }

  private badgeCount(id: ScreenId): number {
    const s = this.s;
    const now = this.app.now();
    switch (id) {
      case 'upgrades':
        return UPGRADES.filter((u) => canBuyUpgrade(s, u.id)).length;
      case 'forge': {
        if (!this.app.isUnlocked('forge')) return 0;
        const c = forgeCost(s);
        const megas = (['size', 'width'] as MegaId[]).filter((id) => {
          const m = megaCost(s, id);
          return m !== null && s.coins >= m;
        }).length;
        const lift = nextLiftStop(s);
        const dd = dashDownCost(s);
        return (c !== null && s.coins >= c ? 1 : 0) + megas + (lift && s.coins >= lift.cost ? 1 : 0) + (dd !== null && s.coins >= dd ? 1 : 0);
      }
      case 'quests':
        return this.app.isUnlocked('achievements') ? achievementsClaimable(s) : 0;
      case 'shop':
        return (this.app.isUnlocked('freeChest') && freeChestReady(s, now) ? 1 : 0) + (canPrestige(s) ? 1 : 0);
      default:
        return 0;
    }
  }

  nav(visible: boolean): void {
    const host = $('nav');
    host.classList.toggle('hidden', !visible);
    if (!visible) return;
    host.innerHTML = NAV.map((n) => {
      const lockedLvl = n.id === 'home' ? 0 : this.app.isUnlocked(n.feature) ? 0 : FEATURE_LEVEL[n.feature];
      const b = lockedLvl ? 0 : this.badgeCount(n.id);
      return `<button class="${this.app.screen === n.id ? 'on' : ''} ${lockedLvl ? 'lock' : ''}" data-nav="${n.id}">
        ${icon(lockedLvl ? 'lock' : n.icon, 34)}<span>${lockedLvl ? t('locked', { n: lockedLvl }) : t(n.label)}</span>
        ${b ? `<span class="badge">${b > 9 ? '9+' : b}</span>` : ''}</button>`;
    }).join('');
    this.on(
      '[data-nav]',
      (el) => {
        const id = el.dataset.nav as ScreenId;
        const n = NAV.find((x) => x.id === id)!;
        if (id !== 'home' && !this.app.isUnlocked(n.feature)) {
          sfx.error();
          toast(`${icon('lock', 26)}${t('lockedHint', { n: FEATURE_LEVEL[n.feature] })}`);
          return;
        }
        sfx.click();
        this.show(id);
      },
      host,
    );
  }

  /** Bump the wallet after a purchase / reward without a full rerender. */
  private bumpWallet(): void {
    for (const id of ['wCoins', 'wGems']) {
      const el = document.getElementById(id);
      if (!el) continue;
      el.classList.remove('bump');
      void el.offsetWidth;
      el.classList.add('bump');
    }
  }

  // ───────────────────────── home ─────────────────────────

  private home(): void {
    const s = this.s;
    const cps = unlockedCheckpoints(s);
    if (!cps.includes(s.startDepth)) s.startDepth = 0;
    const goal = nextGoal(s);
    const goalHtml = goal
      ? `<div class="panel goal"><div class="row"><span><span class="tag">${t('goal')}</span><br>${
          goal.biome > 0 ? t('goalBiome', { biome: t(`biome.${BIOMES[goal.biome].key}`) }) : t('goalCore')
        }</span><span>${s.bestDepth} / ${goal.depth} ${t('m')}</span></div>${bar(s.bestDepth / goal.depth, 'cyan')}</div>`
      : `<div class="panel goal center">${t('goalDone')}</div>`;
    const stop = nextLiftStop(s);
    const lift =
      cps.length > 1 || stop
        ? `<div class="chips"><span class="label">${icon('down', 18)} ${t('lift')}:</span>${cps
            .map((d) => `<button class="chip ${d === s.startDepth ? 'on' : ''}" data-d="${d}">${d} ${t('m')}</button>`)
            .join('')}${
            stop
              ? `<button class="chip buy ${s.coins >= stop.cost ? 'ok' : ''}" data-lift="${stop.depth}">${icon('lock', 16)} ${
                  this.confirmLift === stop.depth ? t('liftConfirm') : `${stop.depth} ${t('m')}`
                } · ${icon('coin', 16)}${fmt(stop.cost)}</button>`
              : ''
          }</div>`
        : '';
    const xpNeed = xpForLevel(s.level);
    this.set(
      `<div class="topbar">
        <button class="lvl" data-a="profile"><div class="star">${icon('star', 44)}<b>${s.level}</b></div>${bar(s.xp / xpNeed, 'purple')}</button>
        ${this.wallet()}
        <button class="icon-btn" data-a="settings">${icon('gear', 28)}</button>
      </div>
      <div id="side">${this.sideHtml()}</div>
      <div class="home-main">
        <h1><span class="a">${t('title1')}</span><span class="b">${t('title2')}</span></h1>
        <div class="hero">
          <img src="${this.app.pickUrl(s.forgeTier)}" alt="">
          <div class="name ol">${this.app.tierName(s.forgeTier)}</div>
          <div class="record ol">${icon('trophy', 24)}${t('best')}: ${s.bestDepth} ${t('m')}</div>
        </div>
      </div>
      <div class="home-bottom">
        ${goalHtml}
        ${lift}
        ${this.loadoutHtml()}
        <button class="btn lg wide pulse" data-a="play">${icon('play', 30)}<span>${t('play')}</span></button>
      </div>`,
      'home',
    );
    this.on('[data-a=play]', () => {
      sfx.click();
      this.app.startRun();
    });
    this.on('[data-a=settings]', () => {
      sfx.click();
      this.show('settings');
    });
    this.on('[data-a=profile]', () => {
      sfx.click();
      this.show('profile');
    });
    this.on('[data-d]', (el) => {
      s.startDepth = Number(el.dataset.d);
      this.confirmLift = 0;
      sfx.click();
      this.app.persist();
      this.home();
    });
    this.on('[data-lift]', (el) => this.tryBuyLift(Number(el.dataset.lift), () => this.home()));
    this.on('[data-a=loadout]', () => {
      sfx.click();
      this.loadoutModal();
    });
    this.lastSideKey = this.sideKey();
    this.bindSide();
  }

  /** "Power-ups for the run": the 3 chosen slots, tap to change. */
  private loadoutHtml(): string {
    const s = this.s;
    if (!this.app.isUnlocked('boosts')) return '';
    const slots = Array.from({ length: LOADOUT_SIZE }, (_, i) => {
      const id = s.loadout[i];
      if (!id) return `<span class="slot empty">+</span>`;
      const n = boostOwned(s, id);
      return `<span class="slot ${n ? '' : 'none'}">${icon(BOOST_ICON[id], 34)}<b>${n}</b></span>`;
    }).join('');
    return `<button class="loadout" data-a="loadout"><span class="lbl">${t('boostsTitle')}</span><span class="slots">${slots}</span></button>`;
  }

  /** Choose up to 3 power-ups for the next run, buy more on the spot. */
  loadoutModal(): void {
    const s = this.s;
    const cards = BOOST_IDS.map((id) => {
      const on = s.loadout.includes(id);
      const n = boostOwned(s, id);
      const cost = boostCost(s, id);
      const def = BOOSTS[id];
      return `<div class="card boostcard ${on ? 'on' : ''}" data-pick="${id}">
        <div class="ic">${icon(BOOST_ICON[id], 42)}</div>
        <div class="info"><div class="nm">${t(`boost.${id}`)}<span class="lv">${t('boostOwned', { n })}</span></div>
        <div class="ds">${t(`boostd.${id}`, { s: def.time ?? 0 })} · ${t('boostPerRun', { n: id === 'dynamite' ? SHOP.maxDynamitePerRun : def.perRun })}</div></div>
        <div class="bcol"><span class="take">${on ? icon('check', 26) : t('boostTake')}</span>
        <button class="btn sm ${s.coins >= cost ? 'gold' : 'off'}" data-bbuy="${id}">+1 ${icon('coin', 18)}<span class="${s.coins >= cost ? '' : 'price-bad'}">${fmt(cost)}</span></button></div></div>`;
    }).join('');
    const host = openModal(`<div class="modal panel wide-modal">
      <div class="ribbon">${t('boostsTitle')}</div>
      <p class="sub">${t('boostsSub', { n: LOADOUT_SIZE })}</p>
      <div class="list">${cards}</div>
      <button class="btn wide" data-a="ok">${t('boostsDone')}</button></div>`);
    this.on(
      '[data-pick]',
      (el) => {
        const id = el.dataset.pick as BoostId;
        if (toggleLoadout(s, id, LOADOUT_SIZE)) {
          sfx.click();
          this.app.persist();
          this.loadoutModal();
        } else {
          sfx.error();
          toast(t('boostsFull', { n: LOADOUT_SIZE }));
        }
      },
      host,
    );
    this.on(
      '[data-bbuy]',
      (el) => {
        const id = el.dataset.bbuy as BoostId;
        const cost = boostCost(s, id);
        if (buyBoost(s, id)) {
          s.profile.coinsSpent += cost;
          sfx.buy();
          track('purchase_item', { id, cost });
          if (!s.loadout.includes(id)) toggleLoadout(s, id, LOADOUT_SIZE);
          this.app.persist();
          this.loadoutModal();
          this.bumpWallet();
        } else sfx.error();
      },
      host,
    );
    this.on(
      '[data-a=ok]',
      () => {
        sfx.click();
        closeModal();
        if (this.app.screen === 'home') this.home();
        else if (this.app.screen === 'shop') this.shop();
      },
      host,
    );
  }

  private sideHtml(): string {
    const s = this.s;
    const now = this.app.now();
    const left: string[] = [];
    const right: string[] = [];
    if (this.app.isUnlocked('daily')) {
      const d = dailyStatus(s, now);
      left.push(`<button class="tile ${d.canClaim ? 'ready' : ''}" data-side="daily"><div class="box">${icon('gift', 40)}</div>
        <span class="cap">${t('daily')}</span>${d.canClaim ? '<span class="badge">!</span>' : ''}</button>`);
    }
    if (this.app.isUnlocked('freeChest')) {
      const ready = freeChestReady(s, now);
      left.push(`<button class="tile ${ready ? 'ready' : ''}" data-side="chest"><div class="box">${icon('chest', 42)}</div>
        <span class="cap" id="chestCap">${ready ? t('freeChestReady') : hms(s.freeChestAt - now)}</span>${ready ? '<span class="badge">!</span>' : ''}</button>`);
    }
    if (this.app.isUnlocked('idle')) {
      const pending = idlePending(s, now);
      const full = idleFull(s, now);
      const locked = s.bestDepth < 20;
      right.push(`<button class="tile ${full >= 1 ? 'ready' : ''}" data-side="idle"><div class="box">${icon('cart', 42)}</div>
        <span class="cap" id="idleCap">${locked ? t('idleLocked') : fmt(pending)}</span>${locked ? '' : bar(full, 'gold')}</button>`);
    }
    return `<div class="side l">${left.join('')}</div><div class="side r">${right.join('')}</div>`;
  }

  private bindSide(): void {
    const side = document.getElementById('side');
    if (!side) return;
    this.on('[data-side=daily]', () => this.daily(), side);
    this.on(
      '[data-side=chest]',
      () => {
        const res = openFreeChest(this.s, this.app.now(), new Rng((Math.random() * 1e9) | 0));
        if (!res) {
          sfx.error();
          return;
        }
        track('chest_open', { source: 'free', rarity: res.rarity });
        this.app.persist();
        this.chestModal(res.rarity, res.reward);
      },
      side,
    );
    this.on(
      '[data-side=idle]',
      () => {
        if (this.s.bestDepth < 20) {
          sfx.error();
          return;
        }
        const coins = collectIdle(this.s, this.app.now());
        if (coins > 0) {
          sfx.chest();
          vibrate('medium');
          toast(`${icon('cart', 28)}<span>${t('idle')}: +${fmt(coins)} ${icon('coin', 20)}</span>`);
          this.app.notifyMissions(progressMissions(this.s, { coins }, false));
          track('idle_collect', { coins });
        } else sfx.click();
        this.app.persist();
        this.home();
        this.nav(true);
      },
      side,
    );
  }

  /** State that changes the side tiles' look; text-only changes are patched in place. */
  private sideKey(): string {
    const s = this.s;
    const now = this.app.now();
    return [dailyStatus(s, now).canClaim, freeChestReady(s, now), idleFull(s, now) >= 1, s.bestDepth >= 20, s.level].join();
  }

  private lastSideKey = '';

  /** Called a few times a second on menus: live timers without recreating buttons (a rebuilt node would eat taps). */
  refreshTimers(): void {
    if (this.app.screen === 'home') {
      const side = document.getElementById('side');
      const key = this.sideKey();
      if (side && key !== this.lastSideKey && !modalOpen()) {
        this.lastSideKey = key;
        side.innerHTML = this.sideHtml();
        this.bindSide();
      } else {
        const now = this.app.now();
        const cc = document.getElementById('chestCap');
        if (cc && !freeChestReady(this.s, now)) cc.textContent = hms(this.s.freeChestAt - now);
        const ic = document.getElementById('idleCap');
        if (ic && this.s.bestDepth >= 20) {
          ic.textContent = fmt(idlePending(this.s, now));
          const fill = ic.parentElement?.querySelector<HTMLElement>('.bar > i');
          fill?.style.setProperty('--p', `${(idleFull(this.s, now) * 100).toFixed(1)}%`);
        }
      }
    }
    const fc = document.getElementById('fcTimer');
    if (fc) fc.textContent = hms(this.s.freeChestAt - this.app.now());
  }

  /** Popups that should appear on the home screen (level-ups, daily reward). */
  /**
   * Popups on returning to the menu — at most ONE per visit, in priority order:
   * feature unlock > daily reward (not on install day, once a day) > notification soft-ask.
   * Plain level-ups never pop up: they are shown inline on the results screen.
   */
  autoPopups(): void {
    const s = this.s;
    const now = this.app.now();
    const rep = this.app.report;
    const levels = rep?.levelsReached ?? [];
    if (rep) rep.levelsReached = [];
    if (modalOpen()) return;
    const unlockLevels = levels.filter((l) => featuresAt(l).length > 0);
    if (unlockLevels.length) {
      this.levelUpModal(unlockLevels[unlockLevels.length - 1], unlockLevels);
      return;
    }
    const today = dayKey(now);
    const installDay = dayKey(s.profile.installAt) === today;
    if (this.app.isUnlocked('daily') && !installDay && this.dailyShownOn !== today && dailyStatus(s, now).canClaim) {
      this.dailyShownOn = today;
      this.daily();
      return;
    }
    // Ask about notifications only when the player clearly came back (2nd+ session, 8+ runs).
    if (isNative && !s.pushAsked && s.runs >= 8 && s.profile.sessions >= 2 && s.settings.notifications) {
      void pushPermission().then((p) => {
        if (p === 'prompt' && !modalOpen()) this.pushAsk();
        else if (p !== 'prompt') {
          s.pushAsked = true;
          this.app.persist();
        }
      });
    }
  }

  private nextPopup(): void {
    if (modalOpen()) return;
    const next = this.popupQueue.shift();
    if (next) next();
  }

  private closeAndNext(): void {
    closeModal();
    this.rerender();
    setTimeout(() => this.nextPopup(), 150);
  }

  // ───────────────────────── upgrades ─────────────────────────

  private upgradeText(id: UpgradeId, lvl: number): string {
    const s = this.s;
    const now = deriveStats(s);
    const next = deriveStats({ ...s, upgrades: { ...s.upgrades, [id]: lvl + 1 } });
    const f2 = (n: number) => n.toFixed(2).replace(/\.?0+$/, '');
    const pair: Record<UpgradeId, [string | number, string | number]> = {
      durability: [now.maxDurBase, next.maxDurBase],
      power: [f2(now.powerMult), f2(next.powerMult)],
      fortune: [f2(now.coinMult), f2(next.coinMult)],
      luck: [f2(now.luckMult), f2(next.luckMult)],
      crit: [Math.round(now.critChance * 100), Math.round(next.critChance * 100)],
      control: [`${now.nudgeCharges} · ${now.nudgeRegen.toFixed(1)}s`, `${next.nudgeCharges} · ${next.nudgeRegen.toFixed(1)}s`],
      blast: [f2(now.blastRadius), f2(next.blastRadius)],
      weight: [f2(now.maxFallMult), f2(next.maxFallMult)],
    };
    const [a, b] = pair[id];
    return t(`upd.${id}`, { a, b });
  }

  private upgrades(): void {
    const s = this.s;
    const hintId = !s.upgradeHintDone ? UPGRADES.find((u) => canBuyUpgrade(s, u.id))?.id : undefined;
    const cards = UPGRADES.map((u) => {
      const lvl = s.upgrades[u.id];
      const maxed = lvl >= upgradeDef(u.id).max;
      const cost = upgradeCost(u.id, lvl);
      const afford = s.coins >= cost;
      return `<div class="card">
        <div class="ic">${icon(UPGRADE_ICON[u.id], 38)}</div>
        <div class="info"><div class="nm">${t(`up.${u.id}`)}<span class="lv">${t('lvl')} ${lvl}</span></div>
        <div class="ds">${maxed ? t('max') : this.upgradeText(u.id, lvl)}</div></div>
        ${
          maxed
            ? `<button class="btn sm off" disabled>${t('max')}</button>`
            : `<button class="btn sm ${afford ? 'gold' : 'off'} ${hintId === u.id ? 'pulse' : ''}" data-up="${u.id}">${icon('coin', 22)}<span class="${afford ? '' : 'price-bad'}">${fmt(cost)}</span></button>`
        }
      </div>`;
    }).join('');
    this.set(
      `${this.header(t('upgrades'))}
       ${hintId ? `<div class="coach-inline center ol" style="margin:12px 0 0;font-size:18px;font-weight:900">${t('hintUpgrade')} ${icon('hand', 28)}</div>` : ''}
       <div class="list" style="margin-top:14px">${cards}</div>`,
      'solid',
    );
    this.bindHeader();
    this.on('[data-up]', (el) => {
      const id = el.dataset.up as UpgradeId;
      const lvl = s.upgrades[id];
      const before = s.coins;
      if (buyUpgrade(s, id)) {
        s.profile.coinsSpent += before - s.coins;
        sfx.buy();
        vibrate('light');
        s.upgradeHintDone = true;
        this.app.notifyMissions(progressMissions(s, { upgrade: 1 }, false));
        track('purchase_upgrade', { id, level: lvl + 1, cost: upgradeCost(id, lvl) });
        this.app.persist();
        this.upgrades();
        this.bumpWallet();
        this.nav(true);
      } else sfx.error();
    });
  }

  // ───────────────────────── forge ─────────────────────────

  private forge(): void {
    const s = this.s;
    const cost = forgeCost(s);
    const cur = s.forgeTier;
    const tiers = TIERS.map((tr, i) => {
      const bonus = [`${icon('hammer', 18)} x${tr.dmg}`, `${icon('heart', 18)} x${tr.dur}`];
      if (tr.coinBonus) bonus.push(`${icon('coin', 18)} +${tr.coinBonus * 100}%`);
      if (tr.fireproof) bonus.push(`${icon('fire', 18)}`);
      return `<div class="card ${i > cur ? 'dim' : ''}"><div class="ic"><img src="${this.app.pickUrl(i)}"></div>
        <div class="info"><div class="nm">${this.app.tierName(i)}</div><div class="ds">${bonus.join(' · ')}</div></div>
        ${i <= cur ? icon('check', 28) : ''}</div>`;
    }).join('');
    this.set(
      `${this.header(t('forge'))}
       <div class="panel center" style="margin-top:14px">
         <div class="forge-view"><img src="${this.app.pickUrl(cur)}">${
           cur < MAX_TIER ? `${icon('play', 30)}<img src="${this.app.pickUrl(cur + 1)}">` : ''
         }</div>
         <div class="nm ol" style="font-size:22px;font-weight:900">${this.app.tierName(cur)}${cur < MAX_TIER ? ' → ' + this.app.tierName(cur + 1) : ''}</div>
         <p class="sub">${t('forgeDesc')}</p>
         ${
           cost === null
             ? `<p class="ol">${t('forgeMax')}</p>`
             : `<button class="btn ${s.coins >= cost ? 'gold' : 'off'} wide" data-a="forge">${icon('fire', 28)}<span>${icon('coin', 24)} <span class="${s.coins >= cost ? '' : 'price-bad'}">${fmt(cost)}</span></span></button>`
         }
       </div>
       <h2 style="font-size:22px;margin:18px 0 4px">${t('mega')}</h2>
       <p class="sub" style="margin:0 0 10px">${t('megaDesc')}</p>
       <div class="list">${(['size', 'width'] as MegaId[]).map((id) => this.megaCard(id)).join('')}${this.dashDownCard()}${this.liftCard()}</div>
       <div class="list" style="margin-top:14px">${tiers}</div>`,
      'solid',
    );
    this.bindHeader();
    this.on('[data-wlift]', (el) => this.tryBuyLift(Number(el.dataset.wlift), () => this.forge()));
    this.on('[data-a=dashdown]', () => {
      const before = s.coins;
      if (buyDashDown(s)) {
        s.profile.coinsSpent += before - s.coins;
        sfx.tierUp();
        vibrate('heavy');
        track('purchase_dash_down', { level: s.dashDown, cost: before - s.coins });
        this.app.notifyMissions(progressMissions(s, { upgrade: 1 }, false));
        this.app.persist();
        this.forge();
        this.bumpWallet();
        this.nav(true);
      } else sfx.error();
    });
    this.on('[data-mega]', (el) => {
      const id = el.dataset.mega as MegaId;
      const before = s.coins;
      if (buyMega(s, id)) {
        s.profile.coinsSpent += before - s.coins;
        sfx.tierUp();
        vibrate('heavy');
        track('purchase_mega', { id, level: id === 'size' ? s.pickSize : s.shaftWidth, cost: before - s.coins });
        this.app.persist();
        this.forge();
        this.bumpWallet();
        this.nav(true);
      } else sfx.error();
    });
    this.on('[data-a=forge]', () => {
      const before = s.coins;
      if (buyForge(s)) {
        s.profile.coinsSpent += before - s.coins;
        sfx.tierUp();
        vibrate('heavy');
        this.app.notifyMissions(progressMissions(s, { upgrade: 1 }, false));
        track('purchase_forge', { tier: s.forgeTier });
        this.app.persist();
        this.forge();
        this.bumpWallet();
        this.nav(true);
      } else sfx.error();
    });
  }

  /** Two-tap purchase of an elevator stop: first tap asks, second buys. */
  private tryBuyLift(depth: number, rerender: () => void): void {
    const s = this.s;
    if (this.confirmLift !== depth) {
      this.confirmLift = depth;
      sfx.click();
      rerender();
      return;
    }
    this.confirmLift = 0;
    const before = s.coins;
    if (buyLiftStop(s, depth)) {
      s.profile.coinsSpent += before - s.coins;
      s.startDepth = depth;
      sfx.tierUp();
      vibrate('heavy');
      track('purchase_lift', { depth, cost: before - s.coins });
      this.app.persist();
      toast(`${icon('down', 26)}<span>${t('liftBought', { d: depth })}</span>`);
      this.nav(true);
    } else sfx.error();
    rerender();
  }

  private liftCard(): string {
    const s = this.s;
    const stop = nextLiftStop(s);
    const owned = s.liftStops.length;
    const desc = stop ? t('liftDesc', { d: stop.depth }) : s.bestDepth < 20 ? t('liftNone') : t('liftAll');
    const afford = stop !== null && s.coins >= stop.cost;
    return `<div class="card"><div class="ic">${icon('down', 40)}</div>
      <div class="info"><div class="nm">${t('lift')}<span class="lv">${owned}/5</span></div><div class="ds">${desc}</div></div>
      ${
        stop
          ? `<button class="btn sm ${afford ? 'gold' : 'off'}" data-wlift="${stop.depth}">${
              this.confirmLift === stop.depth ? t('liftConfirm') : `${icon('coin', 22)}<span class="${afford ? '' : 'price-bad'}">${fmt(stop.cost)}</span>`
            }</button>`
          : ''
      }</div>`;
  }

  /** One-time purchase (then 4 more levels): the breakthrough can also go straight down. */
  private dashDownCard(): string {
    const s = this.s;
    const lvl = s.dashDown;
    const cost = dashDownCost(s);
    const desc =
      lvl === 0 ? t('dashDownBuy', { n: DASH_DOWN.blocks[0] }) : cost === null ? t('dashDownDesc', { n: DASH_DOWN.blocks[lvl - 1] }) : t('dashDownNext', { a: DASH_DOWN.blocks[lvl - 1], b: DASH_DOWN.blocks[lvl] });
    const afford = cost !== null && s.coins >= cost;
    return `<div class="card"><div class="ic">${icon('down', 40)}</div>
      <div class="info"><div class="nm">${t('dashDown')}<span class="lv">${t('lvl')} ${lvl}</span></div><div class="ds">${desc}</div></div>
      ${
        cost === null
          ? `<button class="btn sm off" disabled>${t('max')}</button>`
          : `<button class="btn sm ${afford ? 'gold' : 'off'}" data-a="dashdown">${icon('coin', 22)}<span class="${afford ? '' : 'price-bad'}">${fmt(cost)}</span></button>`
      }</div>`;
  }

  private megaCard(id: MegaId): string {
    const s = this.s;
    const lvl = id === 'size' ? s.pickSize : s.shaftWidth;
    const cost = megaCost(s, id);
    const desc =
      id === 'size'
        ? t('megad.size', { a: 1 + lvl, b: 2 + lvl })
        : t('megad.width', { a: WORLD_W + MEGA.width.step * lvl, b: WORLD_W + MEGA.width.step * (lvl + 1) });
    const afford = cost !== null && s.coins >= cost;
    return `<div class="card"><div class="ic">${icon(id === 'size' ? 'pickaxe' : 'arrows', 40)}</div>
      <div class="info"><div class="nm">${t(`mega.${id}`)}<span class="lv">${t('lvl')} ${lvl}</span></div>
      <div class="ds">${cost === null ? t('max') : desc}</div></div>
      ${
        cost === null
          ? `<button class="btn sm off" disabled>${t('max')}</button>`
          : `<button class="btn sm ${afford ? 'gold' : 'off'}" data-mega="${id}">${icon('coin', 22)}<span class="${afford ? '' : 'price-bad'}">${fmt(cost)}</span></button>`
      }</div>`;
  }

  // ───────────────────────── quests & achievements ─────────────────────────

  private quests(): void {
    const s = this.s;
    const now = this.app.now();
    const list = ensureMissions(s);
    const achUnlocked = this.app.isUnlocked('achievements');
    const tab = achUnlocked ? this.questTab : 'quests';
    let body: string;
    if (tab === 'quests') {
      const skip = missionsSkipReady(s, now);
      const cards = list
        .map((m, i) => {
          const r = m.reward;
          const reward = [
            r.boost ? `${icon(BOOST_ICON[r.boost], 22)}×${r.n ?? 1}` : '',
            r.gems ? `${icon('gem', 20)}${r.gems}` : '',
            r.coins ? `${icon('coin', 20)}${fmt(r.coins)}` : '',
          ].filter(Boolean).join(' ');
          return `<div class="card mission"><div class="ic">${icon('scroll', 36)}</div>
            <div class="info"><div class="nm">${missionText(m, fmt)}</div>
            <div style="margin-top:6px">${bar(m.progress / m.target, 'gold', `${fmt(m.scope === 'run' ? m.progress : Math.min(m.progress, m.target))} / ${fmt(m.target)}`)}</div></div>
            <div class="mreward">${reward}${skip ? `<button class="btn sm ghost" data-skip="${i}" aria-label="${t('missionSkip')}">${icon('refresh', 18)}</button>` : ''}</div></div>`;
        })
        .join('');
      body = `<div class="sub center">${t('missionsSub')}</div>
        <div class="list" style="margin-top:10px">${cards}</div>
        <div class="sub center">${t('missionsDoneN', { n: s.missions.done })} · ${skip ? t('missionSkip') : t('missionSkipUsed')}</div>`;
    } else {
      body = `<div class="list">${ACHIEVEMENTS.map((a) => {
        const claimed = s.achievements[a.id] ?? 0;
        const all = claimed >= a.tiers.length;
        const target = a.tiers[Math.min(claimed, a.tiers.length - 1)];
        const v = a.value(s);
        const can = achievementClaimable(s, a);
        const stars = `<span class="stars">${a.tiers.map((_, i) => `<span style="opacity:${i < claimed ? 1 : 0.25}">${icon('star', 14)}</span>`).join('')}</span>`;
        return `<div class="card ${all ? 'done' : ''}"><div class="ic">${icon(a.icon, 36)}</div>
          <div class="info"><div class="nm">${t(`ach.${a.id}`)} ${stars}</div>
          <div class="ds">${all ? t('achDone') : t(`achd.${a.id}`, { n: fmt(target) })}</div>
          ${all ? '' : `<div style="margin-top:6px">${bar(v / target, can ? '' : 'cyan', `${fmt(Math.min(v, target))} / ${fmt(target)}`)}</div>`}</div>
          ${all ? icon('trophy', 34) : `<button class="btn sm purple ${can ? 'pulse' : 'off'}" data-ach="${a.id}" ${can ? '' : 'disabled'}>${icon('gem', 20)}${achievementGems(claimed)}</button>`}
        </div>`;
      }).join('')}</div>`;
    }
    const qBadge = 0;
    const aBadge = achUnlocked ? achievementsClaimable(s) : 0;
    this.set(
      `${this.header(t('quests'))}
       <div class="tabs">
         <button class="tab ${tab === 'quests' ? 'on' : ''}" data-tab="quests">${t('missionsTitle')}${qBadge ? `<span class="badge">${qBadge}</span>` : ''}</button>
         <button class="tab ${tab === 'achievements' ? 'on' : ''}" data-tab="achievements">${achUnlocked ? t('achievements') : `${icon('lock', 16)} ${t('locked', { n: FEATURE_LEVEL.achievements })}`}${aBadge ? `<span class="badge">${aBadge}</span>` : ''}</button>
       </div>
       ${body}
       <button class="btn blue wide" data-a="collection" style="margin-top:6px">${icon('book', 28)}<span>${t('collection')} · ${s.discovered.length}/${COLLECTIBLE.length}</span></button>`,
      'solid',
    );
    this.bindHeader();
    this.on('[data-tab]', (el) => {
      if (el.dataset.tab === 'achievements' && !achUnlocked) {
        sfx.error();
        return;
      }
      sfx.click();
      this.questTab = el.dataset.tab as 'quests' | 'achievements';
      this.quests();
    });
    this.on('[data-skip]', (el) => {
      if (skipMission(s, Number(el.dataset.skip), this.app.now())) {
        sfx.click();
        track('mission_skip');
        this.app.persist();
        this.quests();
      } else sfx.error();
    });
    this.on('[data-ach]', (el) => {
      const gems = claimAchievement(s, el.dataset.ach!);
      if (!gems) return;
      track('achievement_claim', { id: el.dataset.ach!, tier: s.achievements[el.dataset.ach!] });
      this.app.persist();
      this.rewardModal(t('achievementToast'), { gems }, 'trophy');
    });
    this.on('[data-a=collection]', () => {
      if (!this.app.isUnlocked('collection')) return sfx.error();
      sfx.click();
      this.show('collection');
    });
  }

  // ───────────────────────── collection ─────────────────────────

  private collection(): void {
    const s = this.s;
    const cells = COLLECTIBLE.map((key) => {
      const def = BLOCKS.find((b) => b?.key === key)!;
      const known = s.discovered.includes(key);
      return `<div class="cell ${known ? '' : 'unknown'}"><img src="${this.app.blockUrl(def.id)}"><span>${known ? t(`block.${key}`) : t('unknown')}</span></div>`;
    }).join('');
    this.set(
      `${this.header(t('collection'))}
       <div class="panel" style="margin:14px 0 12px"><div class="row" style="display:flex;justify-content:space-between;margin-bottom:6px;font-weight:800">
         <span>${icon('book', 24)} ${t('collectionDesc', { a: s.discovered.length, b: COLLECTIBLE.length })}</span></div>
         ${bar(s.discovered.length / COLLECTIBLE.length, 'cyan')}</div>
       <div class="grid">${cells}</div>`,
      'solid',
    );
    this.bindHeader();
  }

  // ───────────────────────── shop ─────────────────────────

  private shop(): void {
    const s = this.s;
    const now = this.app.now();
    const chestUnlocked = this.app.isUnlocked('freeChest');
    const ready = freeChestReady(s, now);
    const prestigeOpen = s.bestDepth >= PRESTIGE.unlockDepth || s.prestiges > 0;
    const shards = prestigeShards(s);
    this.set(
      `${this.header(t('shop'))}
       <div class="list" style="margin-top:14px">
         ${
           chestUnlocked
             ? `<div class="card"><div class="ic">${icon('chest', 42)}</div><div class="info"><div class="nm">${t('freeChest')}</div>
                <div class="ds">${t('rarity.common')} → ${t('rarity.legendary')}</div></div>
                ${ready ? `<button class="btn sm pulse" data-a="chest">${t('open')}</button>` : `<button class="btn sm off" disabled id="fcTimer">${hms(s.freeChestAt - now)}</button>`}</div>`
             : ''
         }
         ${(this.app.isUnlocked('boosts') ? BOOST_IDS : (['dynamite'] as BoostId[]))
           .map((id) => {
             const c = boostCost(s, id);
             return `<div class="card"><div class="ic">${icon(BOOST_ICON[id], 40)}</div><div class="info"><div class="nm">${t(`boost.${id}`)}<span class="lv">${t('owned', { n: boostOwned(s, id) })}</span></div><div class="ds">${t(`boostd.${id}`, { s: BOOSTS[id].time ?? 0 })}</div></div>
               <button class="btn sm ${s.coins >= c ? 'gold' : 'off'}" data-buyb="${id}">${icon('coin', 22)}<span class="${s.coins >= c ? '' : 'price-bad'}">${fmt(c)}</span></button></div>`;
           })
           .join('')}
         ${this.app.isUnlocked('boosts') ? `<button class="btn blue wide" data-a="loadout">${icon('bag', 26)}<span>${t('boostsTitle')}</span></button>` : ''}
         <div class="card"><div class="ic">${icon('totem', 40)}</div><div class="info"><div class="nm">${t('totem')}<span class="lv">${t('owned', { n: s.totems })}</span></div><div class="ds">${t('totemDesc')}</div></div>
           <button class="btn sm ${s.gems >= SHOP.totemGems ? 'purple' : 'off'}" data-a="totem">${icon('gem', 22)}<span class="${s.gems >= SHOP.totemGems ? '' : 'price-bad'}">${SHOP.totemGems}</span></button></div>
       </div>
       <div class="panel center" style="margin-top:6px">
         <div>${icon('shard', 56)}</div>
         <h2 style="font-size:22px">${t('prestige')} · ${t('shards')}: ${s.shards}</h2>
         <p class="sub">${t('prestigeDesc')}</p>
         ${
           !prestigeOpen
             ? `<button class="btn off wide" disabled>${icon('lock', 24)}<span>${t('prestigeLocked', { d: PRESTIGE.unlockDepth })}</span></button>`
             : canPrestige(s)
               ? `<button class="btn purple wide" data-a="prestige">${this.confirmPrestige ? t('confirm') : `${t('prestigeBtn', { n: shards })} ${icon('shard', 24)}`}</button>`
               : `<p class="ol">${t('prestigeNone')}</p>`
         }
       </div>`,
      'solid',
    );
    this.bindHeader();
    const after = (ok: boolean, ev: string, params: Record<string, string | number> = {}) => {
      if (ok) {
        sfx.buy();
        vibrate('light');
        track(ev, params);
        this.app.persist();
        this.shop();
        this.bumpWallet();
        this.nav(true);
      } else sfx.error();
    };
    this.on('[data-buyb]', (el) => {
      const id = el.dataset.buyb as BoostId;
      const c = boostCost(s, id);
      const ok = buyBoost(s, id);
      if (ok) s.profile.coinsSpent += c;
      after(ok, 'purchase_item', { id, cost: c });
    });
    this.on('[data-a=loadout]', () => {
      sfx.click();
      this.loadoutModal();
    });
    this.on('[data-a=totem]', () => {
      const ok = buyTotem(s);
      if (ok) s.profile.gemsSpent += SHOP.totemGems;
      after(ok, 'purchase_item', { id: 'totem', gems: SHOP.totemGems });
    });
    this.on('[data-a=chest]', () => {
      const res = openFreeChest(s, this.app.now(), new Rng((Math.random() * 1e9) | 0));
      if (!res) return sfx.error();
      track('chest_open', { source: 'free', rarity: res.rarity });
      this.app.persist();
      this.chestModal(res.rarity, res.reward);
    });
    this.on('[data-a=prestige]', () => {
      if (!this.confirmPrestige) {
        this.confirmPrestige = true;
        sfx.click();
        this.shop();
        return;
      }
      this.confirmPrestige = false;
      const gained = doPrestige(s);
      if (gained > 0) {
        sfx.tierUp();
        vibrate('heavy');
        track('prestige', { shards: gained, total: s.shards });
        this.app.persist();
      }
      this.shop();
    });
  }

  // ───────────────────────── settings ─────────────────────────

  private settings(): void {
    const st = this.s.settings;
    const onOff = (v: boolean) => (v ? t('on') : t('off'));
    const langLabel = st.lang === 'auto' ? t('auto') : st.lang.toUpperCase();
    this.set(
      `${this.header(t('settings'), false)}
       <div class="panel" style="margin-top:14px">
         <div class="settings-row"><span>${icon('star', 28)}${t('difficulty')}</span><button class="btn sm purple" data-a="diff">${t(`diff.${this.s.difficulty || 'normal'}`)}</button></div>
         <div class="settings-row"><span>${icon('sound', 28)}${t('sound')}</span><button class="btn sm ${st.sound ? '' : 'ghost'}" data-a="sound">${onOff(st.sound)}</button></div>
         <div class="settings-row"><span>${icon('play', 28)}${t('music')}</span><button class="btn sm ${st.music ? (st.musicStyle === 'calm' ? 'blue' : '') : 'ghost'}" data-a="music">${st.music ? t(st.musicStyle === 'calm' ? 'musicCalm' : 'musicGroove') : t('off')}</button></div>
         <div class="settings-row"><span>${icon('gift', 28)}${t('notifications')}${isNative ? '' : `<br><small class="sub">${t('pushUnsupported')}</small>`}</span><button class="btn sm ${st.notifications ? '' : 'ghost'}" data-a="push">${onOff(st.notifications)}</button></div>
         <div class="settings-row"><span>${icon('vibrate', 28)}${t('vibration')}</span><button class="btn sm ${st.vibration ? '' : 'ghost'}" data-a="vib">${onOff(st.vibration)}</button></div>
         <div class="settings-row"><span>${icon('shake', 28)}${t('shakeOpt')}</span><button class="btn sm ${st.shake ? '' : 'ghost'}" data-a="shake">${onOff(st.shake)}</button></div>
         <div class="settings-row"><span>${icon('sparkle', 28)}${t('particlesOpt')}</span><button class="btn sm blue" data-a="parts">${st.particles === 'high' ? t('high') : t('low')}</button></div>
         <div class="settings-row"><span>${icon('globe', 28)}${t('language')}</span><button class="btn sm blue" data-a="lang">${langLabel}</button></div>
       </div>
       <button class="btn blue wide" data-a="profile" style="margin-top:16px">${icon('trophy', 26)}<span>${t('profile')}</span></button>
       <button class="btn red wide" data-a="reset" style="margin-top:14px">${this.confirmReset ? t('resetConfirm') : t('reset')}</button>
       <p class="sub center" style="margin-top:14px">Falling Pickaxe · ${t('version')} 0.3.0</p>`,
      'solid',
    );
    this.bindHeader();
    const save = () => {
      this.app.persist();
      this.app.applyQuality();
      this.settings();
    };
    this.on('[data-a=sound]', () => {
      st.sound = !st.sound;
      sfx.enabled = st.sound;
      sfx.click();
      save();
    });
    this.on('[data-a=vib]', () => {
      st.vibration = !st.vibration;
      setVibration(st.vibration);
      vibrate('medium');
      save();
    });
    this.on('[data-a=shake]', () => {
      st.shake = !st.shake;
      sfx.click();
      save();
    });
    this.on('[data-a=parts]', () => {
      st.particles = st.particles === 'high' ? 'low' : 'high';
      sfx.click();
      save();
    });
    // Upbeat → Calm → Off → Upbeat
    this.on('[data-a=music]', () => {
      if (st.music && st.musicStyle === 'groove') st.musicStyle = 'calm';
      else if (st.music) st.music = false;
      else {
        st.music = true;
        st.musicStyle = 'groove';
      }
      music.setStyle(st.musicStyle);
      music.setEnabled(st.music, 'menu');
      track('music_setting', { on: st.music, style: st.musicStyle });
      sfx.click();
      save();
    });
    this.on('[data-a=push]', async () => {
      st.notifications = !st.notifications;
      sfx.click();
      if (st.notifications && isNative && (await pushPermission()) === 'prompt') await requestPush();
      track('push_toggle', { on: st.notifications });
      save();
    });
    this.on('[data-a=reset]', () => {
      if (!this.confirmReset) {
        this.confirmReset = true;
        sfx.click();
        this.settings();
        return;
      }
      this.app.resetProgress();
    });
    this.on('[data-a=diff]', () => {
      sfx.click();
      this.difficultyPicker(false);
    });
    this.on('[data-a=profile]', () => {
      sfx.click();
      this.show('profile');
    });
    this.on('[data-a=lang]', () => {
      st.lang = st.lang === 'auto' ? 'ru' : st.lang === 'ru' ? 'en' : 'auto';
      setLang(st.lang);
      sfx.click();
      save();
      this.nav(true);
    });
  }

  // ───────────────────────── in-run overlays ─────────────────────────

  pause(): void {
    this.set(
      `<div class="results">
        <h2 class="center">${t('pause')}</h2>
        <button class="btn lg wide" data-a="resume">${icon('play', 30)}<span>${t('resume')}</span></button>
        <button class="btn red wide" data-a="quit">${t('quit')}</button>
      </div>`,
      'over',
    );
    this.on('[data-a=resume]', () => {
      sfx.click();
      this.app.resume();
    });
    this.on('[data-a=quit]', () => {
      sfx.click();
      this.app.quitRun();
    });
  }

  reviveOffer(free: boolean): void {
    let left = 5;
    const host = openModal(`<div class="modal panel">
      <div class="ribbon" style="--rt:#8af27a;--rb:#2fbf3a">${t('reviveTitle')}</div>
      <div class="ring" id="ring"><div id="ringN">5</div></div>
      <p class="sub">${t('reviveDesc')}</p>
      <div class="modal-actions">
        <button class="btn lg wide pulse" data-a="yes">${free ? t('reviveFree') : `${icon('ad', 30)}<span>${t('reviveAd')}</span>`}</button>
        <button class="link" data-a="no">${t('noThanks')}</button>
      </div></div>`);
    const timer = setInterval(() => {
      left -= 0.1;
      const ring = document.getElementById('ring');
      if (!ring) return clearInterval(timer);
      ring.style.setProperty('--p', `${Math.max(0, (left / 5) * 100)}%`);
      document.getElementById('ringN')!.textContent = String(Math.max(0, Math.ceil(left)));
      if (left <= 0) {
        clearInterval(timer);
        this.app.declineRevive();
      }
    }, 100);
    this.on(
      '[data-a=yes]',
      () => {
        clearInterval(timer);
        void this.app.acceptRevive(free);
      },
      host,
    );
    this.on(
      '[data-a=no]',
      () => {
        clearInterval(timer);
        this.app.declineRevive();
      },
      host,
    );
  }

  results(adUsed: boolean): void {
    const r = this.app.result!;
    const rep = this.app.report!;
    const s = this.s;
    const mult = adUsed ? 2 : 1;
    const affordable = UPGRADES.filter((u) => canBuyUpgrade(s, u.id)).length;
    let near = '';
    if (!r.newRecord && rep.prevBest - r.depth > 0 && rep.prevBest - r.depth <= 15) near = t('nearRecord', { n: rep.prevBest - r.depth });
    else {
      const g = nextGoal(s);
      if (g && g.biome > 0 && g.depth - r.depth <= 25 && g.depth > r.depth) near = t('nearGoal', { n: g.depth - r.depth, biome: t(`biome.${BIOMES[g.biome].key}`) });
    }
    const newBlocks = rep.newBlocks.length
      ? `<div class="panel"><div class="sub" style="margin-bottom:6px">${t('newBlocks')} · +${rep.newBlockGems} ${icon('gem', 18)}</div>
         <div style="display:flex;gap:6px;flex-wrap:wrap">${rep.newBlocks
           .map((k) => `<img src="${this.app.blockUrl(BLOCKS.find((b) => b?.key === k)!.id)}" style="width:36px;height:36px;border:2px solid var(--ink);border-radius:6px;image-rendering:pixelated">`)
           .join('')}</div></div>`
      : '';
    this.set(
      `<div class="results">
        <h2 class="center">${r.core ? t('resultsCore') : t('results')}</h2>
        <div class="big-depth">${r.depth} ${t('m')}</div>
        ${r.newRecord ? `<div class="record-badge">${t('newRecord')}</div>` : ''}
        ${near ? `<div class="near ol">${near}</div>` : ''}
        <div class="panel rows">
          <div><span>${t('oreCoins')}</span><span class="v">${icon('coin', 22)}${fmt(r.oreCoins * mult)}</span></div>
          <div><span>${t('depthCoins')}</span><span class="v">${icon('coin', 22)}${fmt(r.depthCoins * mult)}</span></div>
          ${r.bonusCoins ? `<div><span>${t('bonusCoins')}</span><span class="v">${icon('coin', 22)}${fmt(r.bonusCoins * mult)}</span></div>` : ''}
          ${r.gems ? `<div><span>${t('gemsFound')}</span><span class="v">${icon('gem', 22)}${r.gems}</span></div>` : ''}
          <div><span>${t('blocks')} · ${t('bestCombo')}</span><span class="v">${r.blocks} · ${r.bestCombo}</span></div>
          <div class="tot"><span>${t('total')}</span><span class="v">${icon('coin', 30)}${fmt(r.totalCoins * mult)}</span></div>
          <div class="xpline">${icon('star', 26)}<span>${t('lvl')} ${s.level}</span>${bar(s.xp / xpForLevel(s.level), 'purple', `+${rep.xp} ${t('xp')}`)}</div>
          ${rep.levelsReached.length ? `<div class="qdone" style="color:var(--gold)">${icon('star', 22)}${t('levelUpInline', { n: s.level })} +${rep.levelsReached.reduce((g, l) => g + (levelReward(s, l).gems ?? 0), 0)} ${icon('gem', 16)}</div>` : ''}
        </div>
        ${newBlocks}
        ${rep.missionsDone.length ? `<div class="panel">${rep.missionsDone.map((d) => `<div class="qdone">${icon('check', 22)}<span>${missionText(d.mission, fmt)}</span>${rewardTiles(d.reward, { totem: t('totem'), dynamite: t('dynamite') })}</div>`).join('')}</div>` : ''}
        ${!adUsed && r.totalCoins > 0 ? `<button class="btn gold wide" data-a="x2">${icon('ad', 30)}<span>${t('x2')}</span></button>` : ''}
        <div class="row2">
          ${
            affordable > 0
              ? `<button class="btn blue ${s.runs <= 3 ? 'pulse' : ''}" data-a="upgrade">${icon('hammer', 26)}<span>${t('upgrades')}</span><span class="badge">${affordable}</span></button>`
              : `<button class="btn ghost" data-a="menu">${icon('home', 26)}<span>${t('menu')}</span></button>`
          }
          <button class="btn" data-a="again">${icon('play', 24)}<span>${t('playAgain')}</span></button>
        </div>
      </div>`,
      'over',
    );
    if (rep.missionsDone.length) sfx.chest();
    this.on('[data-a=x2]', async (el) => {
      (el as HTMLButtonElement).disabled = true;
      if (await this.app.doubleCoins()) {
        sfx.chest();
        this.results(true);
      }
    });
    const toMenu = (screen: ScreenId) => {
      sfx.click();
      this.show(screen);
      this.autoPopups();
    };
    this.on('[data-a=upgrade]', () => toMenu('upgrades'));
    this.on('[data-a=menu]', () => toMenu('home'));
    this.on('[data-a=again]', () => {
      sfx.click();
      if (this.app.report?.levelsReached.some((l) => featuresAt(l).length)) return toMenu('home');
      this.app.startRun();
    });
  }

  // ───────────────────────── modals ─────────────────────────

  private rewardModal(title: string, reward: Reward, ic: string): void {
    sfx.chest();
    vibrate('medium');
    const host = openModal(`<div class="modal panel">
      <div class="ribbon">${title}</div>
      <div style="margin-top:6px">${icon(ic, 64)}</div>
      ${rewardTiles(reward, { totem: t('totem'), dynamite: t('dynamite') })}
      <button class="btn wide" data-a="ok">${t('claim')}</button></div>`);
    this.on(
      '[data-a=ok]',
      () => {
        sfx.buy();
        this.closeAndNext();
        this.bumpWallet();
      },
      host,
    );
  }

  private chestModal(rarity: ChestRarity, reward: Reward): void {
    const host = openModal(`<div class="modal panel rarity-${rarity}">
      <div class="ribbon" style="--rt:var(--rc);--rb:var(--rc)">${t(`rarity.${rarity}`)}</div>
      <div class="chest-stage shake" id="stage"><div class="rays"></div><div class="big">${icon('chest', 120)}</div></div>
      <div id="chestBody"><p class="ol" style="font-size:18px;font-weight:900">${t('tapToOpen')}</p></div></div>`);
    sfx.click();
    const stage = host.querySelector<HTMLElement>('#stage')!;
    let opened = false;
    stage.addEventListener('click', () => {
      if (opened) return;
      opened = true;
      stage.classList.remove('shake');
      stage.classList.add('burst');
      sfx.tierUp();
      vibrate('heavy');
      host.querySelector('#chestBody')!.innerHTML = `<div class="rarity-name">${t(`rarity.${rarity}`)}</div>
        ${rewardTiles(reward, { totem: t('totem'), dynamite: t('dynamite') })}
        <button class="btn wide" data-a="ok">${t('claim')}</button>`;
      this.on(
        '[data-a=ok]',
        () => {
          sfx.buy();
          this.closeAndNext();
          this.bumpWallet();
        },
        host,
      );
    });
  }

  private daily(): void {
    const s = this.s;
    const now = this.app.now();
    const st = dailyStatus(s, now);
    const scale = rewardScale(s);
    const cells = DAILY.map((d, i) => {
      const got = st.canClaim ? i < st.index : i <= st.index;
      const today = st.canClaim && i === st.index;
      const ic = d.chest ? 'chest' : d.gems ? 'gem' : d.dynamite ? 'bomb' : d.totems ? 'totem' : 'coin';
      const amt = d.chest ? t(`rarity.${d.chest}`).split(' ')[0] : d.coins ? fmt(d.coins * scale) : `+${d.gems ?? d.dynamite ?? d.totems}`;
      return `<div class="dayc ${i === 6 ? 'big' : ''} ${got ? 'got' : ''} ${today ? 'today' : ''}">
        <span>${t('day', { n: i + 1 })}</span>${icon(ic, i === 6 ? 48 : 34)}<span class="amt">${amt}</span></div>`;
    }).join('');
    const host = openModal(`<div class="modal panel">
      <div class="ribbon">${t('dailyTitle')}</div>
      <button class="icon-btn close" data-a="close">${icon('close', 22)}</button>
      <p class="sub" style="margin:6px 30px 0">${t('dailyDesc')}</p>
      <div class="days">${cells}</div>
      ${st.canClaim ? `<button class="btn lg wide pulse" data-a="claim">${t('claim')}</button>` : `<button class="btn off wide" disabled>${t('comeBack')}</button>`}
    </div>`);
    this.on('[data-a=close]', () => this.closeAndNext(), host);
    this.on(
      '[data-a=claim]',
      () => {
        const res = claimDaily(s, this.app.now(), new Rng((Math.random() * 1e9) | 0));
        if (!res) return;
        track('daily_claim', { day: res.index + 1 });
        this.app.persist();
        if (DAILY[res.index].chest) this.chestModal(DAILY[res.index].chest!, res.reward);
        else this.rewardModal(t('day', { n: res.index + 1 }), res.reward, 'gift');
      },
      host,
    );
  }

  private levelUpModal(level: number, levels: number[] = [level]): void {
    const s = this.s;
    const unlockedNow = levels.flatMap((l) => featuresAt(l));
    // Reward was already granted in addXp; show it.
    const reward = levelReward(s, level);
    sfx.fanfare();
    vibrate('heavy');
    const host = openModal(`<div class="modal panel">
      <div class="ribbon" style="--rt:#d2a8ff;--rb:#8a4dff">${t('levelUp')}</div>
      <div class="lvl" style="justify-content:center;margin-top:8px"><div class="star" style="width:96px;height:96px">${icon('star', 96)}<b style="font-size:34px">${level}</b></div></div>
      ${rewardTiles(reward, { totem: t('totem'), dynamite: t('dynamite') })}
      ${unlockedNow.map((f) => `<p class="ol" style="font-size:17px;font-weight:900;margin:6px 0">${icon('lock', 20)} ${t('unlockedNow', { what: t(`feat_${f}`) })}</p>`).join('')}
      <button class="btn wide" data-a="ok">${t('claim')}</button></div>`);
    this.on(
      '[data-a=ok]',
      () => {
        sfx.buy();
        this.closeAndNext();
        this.nav(true);
      },
      host,
    );
  }

  // ───────────────────────── difficulty ─────────────────────────

  /** First launch (first=true) or from settings. */
  difficultyPicker(first: boolean): void {
    const cur = this.s.difficulty || 'normal';
    const opts: Difficulty[] = ['easy', 'normal', 'hard'];
    const colors: Record<Difficulty, string> = { easy: 'blue', normal: '', hard: 'red' };
    const icons: Record<Difficulty, string> = { easy: 'heart', normal: 'pickaxe', hard: 'fire' };
    const host = openModal(`<div class="modal panel">
      <div class="ribbon">${t('diffTitle')}</div>
      ${first ? '' : `<button class="icon-btn close" data-a="close">${icon('close', 22)}</button>`}
      <div class="list" style="margin-top:12px;text-align:left">
        ${opts
          .map((d) => {
            const k = DIFFICULTY[d];
            const tags = [`${icon('heart', 16)} x${k.dur}`, `${icon('hammer', 16)} HP x${k.hp}`, `${icon('coin', 16)} x${k.coins}`].join(' · ');
            return `<button class="card ${!first && d === cur ? 'done' : ''}" data-diff="${d}" style="text-align:left;width:100%">
              <div class="ic">${icon(icons[d], 36)}</div>
              <div class="info"><div class="nm">${t(`diff.${d}`)}${d === 'normal' ? `<span class="lv">${t('recommended')}</span>` : ''}</div>
              <div class="ds">${t(`diffd.${d}`)}</div><div class="ds" style="margin-top:4px">${tags}</div></div>
              <span class="btn sm ${colors[d]}" style="min-width:0;padding:0 10px">${icon('play', 18)}</span>
            </button>`;
          })
          .join('')}
      </div>
      <p class="sub">${t('diffDesc')}</p>
    </div>`);
    this.on('[data-a=close]', () => closeModal(), host);
    this.on(
      '[data-diff]',
      (el) => {
        const d = el.dataset.diff as Difficulty;
        const prev = this.s.difficulty;
        this.s.difficulty = d;
        track('difficulty_select', { value: d, prev: prev || 'none', first });
        this.app.refreshUserProps();
        this.app.persist();
        sfx.buy();
        closeModal();
        if (first) this.app.startTutorial();
        else this.rerender();
      },
      host,
    );
  }

  private pushAsk(): void {
    const s = this.s;
    s.pushAsked = true;
    this.app.persist();
    track('push_soft_ask');
    const host = openModal(`<div class="modal panel">
      <div class="ribbon">${t('pushAskTitle')}</div>
      <div style="margin-top:8px">${icon('chest', 72)}</div>
      <p style="font-weight:700">${t('pushAskBody')}</p>
      <div class="modal-actions">
        <button class="btn lg wide" data-a="yes">${t('pushAskYes')}</button>
        <button class="link" data-a="no">${t('pushAskNo')}</button>
      </div></div>`);
    this.on(
      '[data-a=yes]',
      async () => {
        track('push_soft_yes');
        await requestPush();
        this.closeAndNext();
      },
      host,
    );
    this.on(
      '[data-a=no]',
      () => {
        track('push_soft_no');
        this.closeAndNext();
      },
      host,
    );
  }

  // ───────────────────────── player profile ─────────────────────────

  private profile(): void {
    const s = this.s;
    const now = this.app.now();
    const live = this.app.liveSessionSec;
    const m = playerMetrics(s, now, live);
    const dur = (sec: number) => (sec >= 3600 ? `${(sec / 3600).toFixed(1)} ${t('h')}` : sec >= 60 ? `${Math.round(sec / 60)} ${t('min')}` : `${Math.round(sec)} ${t('s')}`);
    const kpi = (label: string, value: string) => `<div class="kpi"><b>${value}</b><span>${label}</span></div>`;
    const trend = m.depthTrend === null ? '—' : `${m.depthTrend > 0 ? '+' : ''}${m.depthTrend}%`;
    const row = (label: string, value: string) => `<div><span>${label}</span><span class="v">${value}</span></div>`;
    this.set(
      `${this.header(t('profile'), false)}
       <div class="panel" style="margin-top:14px">
         <div class="sub" style="font-weight:800">${t('pHistory')}</div>
         <div id="chartTip" class="center" style="min-height:22px;font-size:14px;font-weight:800">&nbsp;</div>
         ${this.runChart()}
       </div>
       <div class="kpis" style="margin-top:12px">
         ${kpi(t('pPlay'), dur(s.profile.playSec + live))}
         ${kpi(t('pAvgSession'), dur(m.avgSessionMin * 60))}
         ${kpi(t('pSessions'), String(m.sessions))}
         ${kpi(t('pDays'), `${m.activeDays}`)}
         ${kpi(t('pRuns'), String(m.runs))}
         ${kpi(t('pAvgRun'), dur(m.avgRunSec))}
         ${kpi(t('pAvgDepth'), `${Math.round(m.avgDepth)} ${t('m')}`)}
         ${kpi(t('pMedianDepth'), `${Math.round(m.medianDepth)} ${t('m')}`)}
         ${kpi(t('best'), `${m.bestDepth} ${t('m')}`)}
         ${kpi(t('pTrend'), trend)}
         ${kpi(t('pAvgCoins'), fmt(m.avgCoins))}
         ${kpi(t('bestCombo'), String(s.life.maxCombo))}
       </div>
       <div class="panel rows" style="margin-top:12px">
         ${row(t('pActive7'), `${m.activeLast7} / 7`)}
         ${row(t('blocks'), fmt(s.blocksBroken))}
         ${row(t('pRevives'), String(m.revives))}
         ${row(t('pAds'), String(s.profile.adsWatched))}
         ${row(t('pSpent'), `${icon('coin', 18)}${fmt(s.profile.coinsSpent)} · ${icon('gem', 18)}${s.profile.gemsSpent}`)}
       </div>
       <div class="panel rows" style="margin-top:12px">
         <div class="sub" style="font-weight:800">${t('pDev')}</div>
         ${row(t('pSegment'), t(`seg.${m.segment}`))}
         ${row(t('pChurn'), t(`churn.${m.churnRisk}`))}
         ${row(t('difficulty'), t(`diff.${s.difficulty || 'normal'}`))}
         ${row(t('pId'), s.profile.id.slice(0, 13))}
         <div class="sub">${t('pRetention')}</div>
         <div class="chips" style="justify-content:flex-start">${RETENTION_DAYS.map((d) => `<span class="chip ${m.retained[d] ? 'on' : ''}">D${d}</span>`).join('')}</div>
         <div class="sub">${t('pEvents')}: ${analyticsLogSize()}</div>
         <div class="chips" style="justify-content:flex-start">${eventCounts()
           .slice(0, 10)
           .map(([n, c]) => `<span class="chip" style="font-size:11px">${n} · ${c}</span>`)
           .join('')}</div>
         <button class="btn ghost wide" data-a="export" style="margin-top:6px">${t('pExport')}</button>
       </div>`,
      'solid',
    );
    this.bindHeader();
    const tip = document.getElementById('chartTip')!;
    this.host.querySelectorAll<SVGRectElement>('[data-run]').forEach((el) => {
      const show = () => {
        const r = s.profile.history[Number(el.dataset.run)];
        tip.innerHTML = `#${s.runs - (s.profile.history.length - 1 - Number(el.dataset.run))} · ${r.d} ${t('m')} · ${icon('coin', 16)} ${fmt(r.c)} · ${dur(r.t)}`;
      };
      el.addEventListener('pointerenter', show);
      el.addEventListener('pointerdown', show);
    });
    this.on('[data-a=export]', async () => {
      const data = JSON.stringify({ metrics: playerMetrics(s, this.app.now(), this.app.liveSessionSec), analytics: JSON.parse(analyticsExport()) });
      try {
        await navigator.clipboard.writeText(data);
        toast(`${icon('check', 24)}${t('pCopied')}`);
      } catch {
        console.log(data);
      }
      track('analytics_export');
    });
  }

  /** Bar chart of the last runs' depth: one series, one hue, record line, tap for details. */
  private runChart(): string {
    const h = this.s.profile.history.slice(-30);
    if (!h.length) return `<p class="sub center">${t('pHistoryEmpty')}</p>`;
    const W = 320;
    const H = 130;
    const top = 14;
    const max = Math.max(this.s.bestDepth, ...h.map((r) => r.d), 10);
    const gap = 2;
    const bw = Math.min(22, Math.max(3, (W - gap * (h.length - 1)) / h.length));
    const y = (d: number) => H - (d / max) * (H - top);
    const bars = h
      .map((r, i) => {
        const x = i * (bw + gap);
        const bh = Math.max(2, H - y(r.d));
        const rr = Math.min(4, bw / 2);
        const isBest = r.d === this.s.bestDepth;
        const idx = this.s.profile.history.length - h.length + i;
        return `<path d="M${x},${H} v${-(bh - rr)} q0,${-rr} ${rr},${-rr} h${bw - 2 * rr} q${rr},0 ${rr},${rr} v${bh - rr} z" fill="${isBest ? '#ffd23f' : '#6ff3f0'}"/>
          <rect data-run="${idx}" x="${x - gap / 2}" y="0" width="${bw + gap}" height="${H}" fill="transparent"/>`;
      })
      .join('');
    const ry = y(this.s.bestDepth);
    return `<svg viewBox="0 0 ${W} ${H + 2}" width="100%" style="display:block;overflow:visible" role="img" aria-label="${t('pHistory')}">
      <line x1="0" x2="${W}" y1="${H}" y2="${H}" stroke="#ffffff33" stroke-width="1"/>
      <line x1="0" x2="${W}" y1="${ry}" y2="${ry}" stroke="#ffd23f99" stroke-width="1" stroke-dasharray="4 4"/>
      <text x="${W}" y="${ry - 4}" text-anchor="end" fill="#b9a9dd" font-size="10" font-weight="700">${t('pRecord')} ${this.s.bestDepth} ${t('m')}</text>
      ${bars}
    </svg>`;
  }
}
