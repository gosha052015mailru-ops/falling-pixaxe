import { App as CapApp } from '@capacitor/app';
import { sfx } from '../audio/sfx';
import { blockDef } from '../game/blocks';
import { Bot } from '../game/bot';
import { BIOMES, MAX_TIER, PRESTIGE, SHOP, TIERS, UPGRADES, type UpgradeId } from '../game/config';
import {
  addCoins,
  buyDynamite,
  buyForge,
  buyTotem,
  buyUpgrade,
  canPrestige,
  deriveStats,
  doPrestige,
  dynamiteCost,
  forgeCost,
  prestigeShards,
  upgradeCost,
  upgradeDef,
} from '../game/economy';
import { applyResult, unlockedCheckpoints } from '../game/progress';
import { Run, type GameEvent, type RunResult } from '../game/run';
import { loadSave, writeSave, type SaveData } from '../game/save';
import { isNative, setVibration, showRewardedAd, vibrate } from '../platform';
import { Renderer } from '../render/renderer';
import { makePickaxe } from '../render/textures';
import { fmt } from './format';
import { setLang, t } from './i18n';

type Mode = 'menu' | 'play' | 'paused' | 'dying' | 'results' | 'shop' | 'settings';
type ShopTab = 'upgrades' | 'forge' | 'items' | 'prestige';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export class App {
  private save: SaveData = loadSave();
  private renderer: Renderer;
  private run!: Run;
  private bot: Bot | null = null;
  private mode: Mode = 'menu';
  private last = 0;
  private dyingTimer = 0;
  private result: RunResult | null = null;
  private shopTab: ShopTab = 'upgrades';
  private pickImg = new Map<number, string>();
  private banners: { html: string; color: string }[] = [];
  private bannerBusy = false;
  private hud = { dur: -1, max: -1, depth: -1, coins: -1, gems: -1, nudges: -1, bombs: -1, combo: -1, buffs: '' };
  private prestigeArmed = false;
  private returnTo: Mode = 'menu';

  private screen = $('screen');
  private hudEl = $('hud');

  constructor() {
    setLang(this.save.settings.lang);
    sfx.enabled = this.save.settings.sound;
    setVibration(this.save.settings.vibration);
    this.renderer = new Renderer($<HTMLCanvasElement>('canvas'));
    this.startDemo();
    this.bindInput();
    this.showMenu();
    requestAnimationFrame((ts) => this.loop(ts));
  }

  // ───────────────────────── helpers ─────────────────────────

  private persist(): void {
    writeSave(this.save);
  }

  private pickUrl(tier: number): string {
    let u = this.pickImg.get(tier);
    if (!u) {
      u = makePickaxe(tier, 8).toDataURL();
      this.pickImg.set(tier, u);
    }
    return u;
  }

  private tierName(tier: number): string {
    return t(`tier.${TIERS[tier].key}`);
  }

  private wallet(): string {
    return `<div class="wallet"><span class="pill gold">🪙 ${fmt(this.save.coins)}</span><span class="pill pink">💎 ${fmt(this.save.gems)}</span>${
      this.save.shards ? `<span class="pill">✦ ${this.save.shards}</span>` : ''
    }</div>`;
  }

  private setScreen(html: string, cls: 'dim' | 'solid' = 'dim'): void {
    this.screen.className = `screen ${cls}`;
    this.screen.innerHTML = html;
  }

  private on(sel: string, fn: (el: HTMLElement) => void): void {
    this.screen.querySelectorAll<HTMLElement>(sel).forEach((el) =>
      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        sfx.unlock();
        fn(el);
      }),
    );
  }

  // ───────────────────────── runs ─────────────────────────

  private startDemo(): void {
    const stats = deriveStats(this.save);
    stats.dynamite = 3;
    stats.maxDurBase = Math.max(stats.maxDurBase, 120);
    stats.startDepth = 0;
    this.run = new Run({ seed: (Math.random() * 1e9) | 0, stats, bestDepth: 1e9, milestones: BIOMES.map((_, i) => i) });
    this.bot = new Bot(0.8);
    this.renderer.reset(this.run);
  }

  private startRun(): void {
    sfx.unlock();
    sfx.click();
    const stats = deriveStats(this.save);
    this.run = new Run({ seed: (Math.random() * 1e9) | 0, stats, bestDepth: this.save.bestDepth, milestones: this.save.milestones });
    this.bot = null;
    this.renderer.reset(this.run);
    this.mode = 'play';
    this.setScreen('');
    this.screen.className = 'screen';
    this.hudEl.classList.remove('hidden');
    this.hud = { dur: -1, max: -1, depth: -1, coins: -1, gems: -1, nudges: -1, bombs: -1, combo: -1, buffs: '' };
    this.banners = [];
    if (this.save.runs < 2) this.showHint();
  }

  private showHint(): void {
    const el = $('hint');
    el.innerHTML = `${t('hintTap')}<br>${t('hintBomb')}`;
    el.classList.remove('hidden');
    setTimeout(() => el.classList.add('hidden'), 4500);
  }

  private finishRun(): void {
    const r = this.run.result();
    this.result = r;
    applyResult(this.save, r);
    this.persist();
    this.hudEl.classList.add('hidden');
    this.showResults(false);
  }

  // ───────────────────────── loop ─────────────────────────

  private loop(ts: number): void {
    const dt = Math.min(0.05, (ts - this.last) / 1000 || 0);
    this.last = ts;
    const run = this.run;

    if (this.mode === 'play' || this.mode === 'dying' || this.isDemo()) {
      run.step(dt);
      const events = run.drainEvents();
      let broke = false;
      for (const e of events) {
        this.renderer.onEvent(e);
        if (e.t === 'break') broke = true;
        if (!this.isDemo()) this.react(e);
      }
      if (this.bot) {
        this.bot.update(run, dt, broke);
        if (run.over) this.startDemo();
      }
    }
    if (this.mode === 'play' && run.over) {
      this.mode = 'dying';
      this.dyingTimer = run.core ? 2.5 : 1.3;
    }
    if (this.mode === 'dying') {
      this.dyingTimer -= dt;
      if (this.dyingTimer <= 0) {
        this.mode = 'results';
        this.finishRun();
      }
    }
    if (this.mode !== 'paused') this.renderer.update(run, dt);
    this.renderer.draw(run);
    if (this.mode === 'play' || this.mode === 'dying') this.updateHud();
    requestAnimationFrame((n) => this.loop(n));
  }

  private isDemo(): boolean {
    return this.bot !== null && (this.mode === 'menu' || this.mode === 'shop' || this.mode === 'settings');
  }

  /** Sounds, haptics and banners for gameplay events. */
  private react(e: GameEvent): void {
    switch (e.t) {
      case 'hit':
        sfx.hit(blockDef(e.id).hp);
        if (e.crit) vibrate('light');
        this.flashDur();
        break;
      case 'break': {
        const def = blockDef(e.id);
        sfx.break(e.combo, !!def.ore);
        if (def.ore && def.value >= 50) vibrate('light');
        break;
      }
      case 'bounce':
        sfx.bounce();
        break;
      case 'explode':
        sfx.explode();
        vibrate('heavy');
        break;
      case 'tierUp':
        sfx.tierUp();
        vibrate('heavy');
        this.banner(
          `<img src="${this.pickUrl(e.tier)}"><div class="t">${e.maxed ? t('tierMax') : t('tierUp', { tier: this.tierName(e.tier).toUpperCase() })}</div>`,
          TIERS[e.tier].colors.head,
        );
        break;
      case 'heal':
        sfx.anvil();
        vibrate('medium');
        this.banner(`<div class="t">🔨 ${t('heal')}</div><div class="s">+${e.amount} ❤</div>`, '#5dff7a');
        break;
      case 'chest': {
        sfx.chest();
        vibrate('medium');
        const key = { coins: 'chestCoins', gems: 'chestGems', dynamite: 'chestDynamite', durability: 'chestDurability' }[e.loot];
        this.banner(`<div class="t">${t(key, { n: fmt(e.amount) })}</div>`, '#ffd23f');
        break;
      }
      case 'furnace':
        sfx.magic();
        this.banner(`<div class="t">🔥 ${t('furnace')}</div>`, '#ff8c1a');
        break;
      case 'enchant':
        sfx.magic();
        vibrate('medium');
        this.banner(`<div class="t">✨ ${t(`ench.${e.id}`)}</div>`, '#c77dff');
        break;
      case 'gem':
        sfx.coin();
        break;
      case 'slime':
        sfx.slime();
        break;
      case 'lava':
        sfx.sizzle();
        this.flashDur();
        break;
      case 'milestone':
        sfx.fanfare();
        vibrate('heavy');
        this.banner(
          `<div class="t">${t(`biome.${BIOMES[e.biome].key}`)}</div><div class="s">${t('milestoneSub', { coins: fmt(e.coins), gems: e.gems })}</div>`,
          '#6ff3f0',
        );
        break;
      case 'totem':
        sfx.tierUp();
        vibrate('heavy');
        this.banner(`<div class="t">🗿 ${t('totemUsed')}</div>`, '#ffe066');
        break;
      case 'shatter':
        sfx.shatter();
        vibrate('heavy');
        break;
      case 'core':
        sfx.fanfare();
        vibrate('heavy');
        this.banner(`<div class="t">🌟 ${t('core')}</div>`, '#ff7ad9');
        break;
      case 'nudge':
        sfx.nudge();
        vibrate('light');
        break;
      case 'combo':
        if (e.n % 20 === 0) this.banner(`<div class="t">${t('combo', { n: e.n })}</div>`, '#ff8800');
        break;
      case 'dynamite':
        break;
    }
  }

  private flashDur(): void {
    const el = $('dur');
    el.classList.remove('hurt');
    void el.offsetWidth;
    el.classList.add('hurt');
  }

  private banner(html: string, color: string): void {
    if (this.banners.length >= 3) this.banners.shift();
    this.banners.push({ html, color });
    if (!this.bannerBusy) this.nextBanner();
  }

  private nextBanner(): void {
    const b = this.banners.shift();
    const host = $('banner');
    if (!b) {
      this.bannerBusy = false;
      host.innerHTML = '';
      return;
    }
    this.bannerBusy = true;
    host.innerHTML = `<div class="b" style="--c:${b.color}">${b.html}</div>`;
    setTimeout(() => this.nextBanner(), this.banners.length ? 900 : 1500);
  }

  private updateHud(): void {
    const r = this.run;
    const h = this.hud;
    const dur = Math.max(0, Math.ceil(r.durability));
    if (dur !== h.dur || r.maxDur !== h.max) {
      h.dur = dur;
      h.max = r.maxDur;
      const frac = dur / r.maxDur;
      const fill = $('durFill');
      fill.style.width = `${Math.min(100, frac * 100)}%`;
      fill.className = 'dur-fill' + (frac > 0.6 ? ' high' : frac > 0.3 ? ' mid' : '');
      $('durText').textContent = `❤ ${dur} / ${r.maxDur}`;
    }
    if (r.depth !== h.depth) {
      h.depth = r.depth;
      $('depth').textContent = `⛏ ${r.depth} ${t('m')}`;
    }
    const coins = r.runCoins;
    if (coins !== h.coins) {
      h.coins = coins;
      $('runCoins').textContent = `🪙 ${fmt(coins)}`;
    }
    if (r.gems !== h.gems) {
      h.gems = r.gems;
      const g = $('runGems');
      g.textContent = `💎 ${r.gems}`;
      g.classList.toggle('hidden', r.gems === 0);
    }
    if (r.nudges !== h.nudges) {
      h.nudges = r.nudges;
      $('nudges').innerHTML = Array.from({ length: r.stats.nudgeCharges }, (_, i) => `<i class="${i < r.nudges ? '' : 'empty'}"></i>`).join('');
    }
    if (r.dynamite !== h.bombs) {
      h.bombs = r.dynamite;
      $('bombCount').textContent = String(r.dynamite);
      $('bombBtn').classList.toggle('empty', r.dynamite === 0);
    }
    const combo = r.combo >= 5 ? r.combo : 0;
    if (combo !== h.combo) {
      const el = $('combo');
      el.textContent = combo ? `×${r.comboMult.toFixed(2)}  ·  ${combo} 🔥` : '';
      el.classList.toggle('on', combo > 0);
      if (combo > h.combo) {
        el.classList.remove('pop');
        void el.offsetWidth;
        el.classList.add('pop');
      }
      h.combo = combo;
    }
    const buffs: string[] = [];
    if (r.furnaceTimer > 0) buffs.push(`<span class="buff" style="--c:#ff8c1a">🔥 ×2 ${Math.ceil(r.furnaceTimer)}s</span>`);
    for (const [k, v] of Object.entries(r.enchants)) if (v > 0) buffs.push(`<span class="buff" style="--c:#c77dff">✨ ${t(`ench.${k}`).split(':')[0]}${v > 1 ? ' ×' + v : ''}</span>`);
    if (r.totems > 0) buffs.push(`<span class="buff" style="--c:#ffe066">🗿</span>`);
    const bh = buffs.join('');
    if (bh !== h.buffs) {
      h.buffs = bh;
      $('buffs').innerHTML = bh;
    }
  }

  // ───────────────────────── input ─────────────────────────

  private bindInput(): void {
    const canvas = $<HTMLCanvasElement>('canvas');
    canvas.addEventListener('pointerdown', (ev) => {
      sfx.unlock();
      if (this.mode !== 'play') return;
      const rect = canvas.getBoundingClientRect();
      this.run.nudge(ev.clientX - rect.left < rect.width / 2 ? -1 : 1);
    });
    $('bombBtn').addEventListener('pointerdown', (ev) => {
      ev.stopPropagation();
      if (this.mode === 'play' && this.run.useDynamite()) vibrate('medium');
      else sfx.error();
    });
    $('pauseBtn').addEventListener('click', () => this.pause());
    window.addEventListener('keydown', (ev) => {
      if (this.mode !== 'play') {
        if (ev.key === 'Escape' && this.mode === 'paused') this.resume();
        return;
      }
      if (ev.key === 'ArrowLeft' || ev.key === 'a') this.run.nudge(-1);
      else if (ev.key === 'ArrowRight' || ev.key === 'd') this.run.nudge(1);
      else if (ev.key === ' ' || ev.key === 'ArrowDown') this.run.useDynamite();
      else if (ev.key === 'Escape' || ev.key === 'p') this.pause();
    });
    window.addEventListener('resize', () => this.renderer.resize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        if (this.mode === 'play') this.pause();
        this.persist();
      }
    });
    if (isNative) {
      void CapApp.addListener('backButton', () => this.back());
      void CapApp.addListener('pause', () => {
        if (this.mode === 'play') this.pause();
        this.persist();
      });
    }
  }

  private back(): void {
    switch (this.mode) {
      case 'play':
        this.pause();
        break;
      case 'paused':
        this.resume();
        break;
      case 'shop':
      case 'settings':
        if (this.returnTo === 'paused') this.pause();
        else this.showMenu();
        break;
      case 'results':
        this.showMenu();
        break;
      case 'menu':
        void CapApp.exitApp();
        break;
    }
  }

  private pause(): void {
    if (this.mode !== 'play' && this.mode !== 'settings') return;
    this.mode = 'paused';
    this.setScreen(`
      <div class="results">
        <h2 class="center">${t('pause')}</h2>
        <button class="btn big" data-a="resume">${t('resume')}</button>
        <button class="btn" data-a="settings">⚙ ${t('settings')}</button>
        <button class="btn red" data-a="quit">${t('quit')}</button>
      </div>`);
    this.on('[data-a=resume]', () => this.resume());
    this.on('[data-a=settings]', () => this.showSettings('paused'));
    this.on('[data-a=quit]', () => {
      // quitting ends the run but still pays out what was earned
      this.mode = 'results';
      this.finishRun();
    });
  }

  private resume(): void {
    this.mode = 'play';
    this.setScreen('');
    this.screen.className = 'screen';
  }

  // ───────────────────────── screens ─────────────────────────

  private showMenu(): void {
    if (this.mode === 'results' || this.mode === 'paused' || !this.bot) this.startDemo();
    this.mode = 'menu';
    this.hudEl.classList.add('hidden');
    const s = this.save;
    const cps = unlockedCheckpoints(s);
    if (!cps.includes(s.startDepth)) s.startDepth = 0;
    const lift =
      cps.length > 1
        ? `<div class="lift"><div class="label">${t('lift')}</div><div class="chips">${cps
            .map((d) => `<button class="chip ${d === s.startDepth ? 'on' : ''}" data-d="${d}">${d} ${t('m')}</button>`)
            .join('')}</div></div>`
        : '';
    this.setScreen(`
      <div class="topbar">${this.wallet()}<button class="icon-btn" data-a="settings">⚙</button></div>
      <div class="logo"><h1>${t('title')}</h1><p>${t('subtitle')}</p></div>
      <div class="hero">
        <img src="${this.pickUrl(s.forgeTier)}" alt="">
        <div class="name">${this.tierName(s.forgeTier)}</div>
        <div class="best">🏆 ${t('best')}: <b>${s.bestDepth} ${t('m')}</b></div>
      </div>
      <div class="menu-actions">
        ${lift}
        <button class="btn big" data-a="play">${t('play')} ▼</button>
        <div class="grid2">
          <button class="btn gold" data-a="upgrades">⚒ ${t('upgrades')}</button>
          <button class="btn purple" data-a="forge">🔥 ${t('forge')}</button>
          <button class="btn" data-a="items">💥 ${t('items')}</button>
          <button class="btn" data-a="prestige" ${s.bestDepth >= PRESTIGE.unlockDepth || s.prestiges ? '' : 'disabled'}>✦ ${t('prestige')}</button>
        </div>
      </div>`);
    this.on('[data-a=play]', () => this.startRun());
    this.on('[data-a=settings]', () => this.showSettings('menu'));
    this.on('[data-a=upgrades]', () => this.showShop('upgrades'));
    this.on('[data-a=forge]', () => this.showShop('forge'));
    this.on('[data-a=items]', () => this.showShop('items'));
    this.on('[data-a=prestige]', () => this.showShop('prestige'));
    this.on('[data-d]', (el) => {
      s.startDepth = Number(el.dataset.d);
      sfx.click();
      this.persist();
      this.showMenu();
    });
  }

  private upgradeText(id: UpgradeId, lvl: number): string {
    const s = this.save;
    const now = deriveStats(s);
    const next = deriveStats({ ...s, upgrades: { ...s.upgrades, [id]: lvl + 1 } });
    const f2 = (n: number) => n.toFixed(2).replace(/\.?0+$/, '');
    const pair: Record<UpgradeId, [string | number, string | number]> = {
      durability: [now.maxDurBase, next.maxDurBase],
      power: [f2(now.powerMult), f2(next.powerMult)],
      fortune: [f2(now.coinMult), f2(next.coinMult)],
      luck: [f2(now.luckMult), f2(next.luckMult)],
      crit: [Math.round(now.critChance * 100), Math.round(next.critChance * 100)],
      control: [`${now.nudgeCharges} / ${now.nudgeRegen.toFixed(1)}s`, `${next.nudgeCharges} / ${next.nudgeRegen.toFixed(1)}s`],
      blast: [f2(now.blastRadius), f2(next.blastRadius)],
      weight: [f2(now.maxFallMult), f2(next.maxFallMult)],
    };
    const [a, b] = pair[id];
    return t(`upd.${id}`, { a, b });
  }

  private showShop(tab: ShopTab): void {
    this.mode = 'shop';
    this.returnTo = 'menu';
    this.shopTab = tab;
    this.prestigeArmed = false;
    this.renderShop();
  }

  private renderShop(): void {
    const s = this.save;
    const tab = this.shopTab;
    let body = '';
    if (tab === 'upgrades') {
      body = `<div class="list">${UPGRADES.map((u) => {
        const lvl = s.upgrades[u.id];
        const maxed = lvl >= upgradeDef(u.id).max;
        const cost = upgradeCost(u.id, lvl);
        return `<div class="card">
          <div class="ic">${u.icon}</div>
          <div class="info"><div class="nm">${t(`up.${u.id}`)}<small>${t('lvl')} ${lvl}</small></div>
          <div class="ds">${maxed ? t('max') : this.upgradeText(u.id, lvl)}</div></div>
          <button class="btn gold" data-up="${u.id}" ${maxed || s.coins < cost ? 'disabled' : ''}>${maxed ? t('max') : '🪙 ' + fmt(cost)}</button>
        </div>`;
      }).join('')}</div>`;
    } else if (tab === 'forge') {
      const cost = forgeCost(s);
      const cur = s.forgeTier;
      body = `<div class="panel center">
        <div class="forge-view"><img src="${this.pickUrl(cur)}">${
          cur < MAX_TIER ? `<span class="arrow">➜</span><img src="${this.pickUrl(cur + 1)}">` : ''
        }</div>
        <div class="nm" style="font-size:22px">${this.tierName(cur)}${cur < MAX_TIER ? ' ➜ ' + this.tierName(cur + 1) : ''}</div>
        <p class="muted">${t('forgeDesc')}</p>
        ${
          cost === null
            ? `<p>${t('forgeMax')}</p>`
            : `<button class="btn gold" data-a="forge" ${s.coins < cost ? 'disabled' : ''}>🔥 🪙 ${fmt(cost)}</button>`
        }
      </div>
      <div class="list" style="margin-top:14px">${TIERS.map(
        (tr, i) => `<div class="card" style="${i > cur ? 'opacity:.5' : ''}"><div class="ic"><img src="${this.pickUrl(i)}"></div>
          <div class="info"><div class="nm">${this.tierName(i)}</div><div class="ds">⚒ ×${tr.dmg} · ❤ ×${tr.dur}${tr.coinBonus ? ` · 🪙 +${tr.coinBonus * 100}%` : ''}${tr.fireproof ? ' · 🔥🛡' : ''}</div></div></div>`,
      ).join('')}</div>`;
    } else if (tab === 'items') {
      const dc = dynamiteCost(s);
      body = `<div class="list">
        <div class="card"><div class="ic">💥</div><div class="info"><div class="nm">${t('dynamite')}<small>${t('owned')}: ${s.dynamite}</small></div><div class="ds">${t('dynamiteDesc')}</div></div>
          <button class="btn gold" data-a="dyn" ${s.coins < dc ? 'disabled' : ''}>🪙 ${fmt(dc)}</button></div>
        <div class="card"><div class="ic">🗿</div><div class="info"><div class="nm">${t('totem')}<small>${t('owned')}: ${s.totems}</small></div><div class="ds">${t('totemDesc')}</div></div>
          <button class="btn purple" data-a="totem" ${s.gems < SHOP.totemGems ? 'disabled' : ''}>💎 ${SHOP.totemGems}</button></div>
      </div>`;
    } else {
      const unlocked = s.bestDepth >= PRESTIGE.unlockDepth || s.prestiges > 0;
      const n = prestigeShards(s);
      body = `<div class="panel center">
        <div style="font-size:54px">✦</div>
        <div class="nm" style="font-size:22px">${t('shards')}: ${s.shards}</div>
        <p class="muted">${t('prestigeDesc')}</p>
        ${
          !unlocked
            ? `<p>${t('prestigeLocked', { d: PRESTIGE.unlockDepth })}</p>`
            : canPrestige(s)
              ? `<button class="btn purple" data-a="prestige">${this.prestigeArmed ? t('confirmPrestige') : t('prestigeBtn', { n })}</button>`
              : `<p>${t('prestigeNone')}</p>`
        }
      </div>`;
    }
    const tabs: ShopTab[] = ['upgrades', 'forge', 'items', 'prestige'];
    this.setScreen(
      `<div class="topbar"><button class="btn small" data-a="back">◀ ${t('back')}</button>${this.wallet()}</div>
       <div class="tabs">${tabs.map((k) => `<button class="tab ${k === tab ? 'on' : ''}" data-tab="${k}">${t(k)}</button>`).join('')}</div>
       ${body}`,
      'solid',
    );
    this.on('[data-a=back]', () => {
      sfx.click();
      this.showMenu();
    });
    this.on('[data-tab]', (el) => {
      sfx.click();
      this.shopTab = el.dataset.tab as ShopTab;
      this.prestigeArmed = false;
      this.renderShop();
    });
    const buy = (ok: boolean) => {
      if (ok) {
        sfx.buy();
        vibrate('light');
        this.persist();
      } else sfx.error();
      this.renderShop();
    };
    this.on('[data-up]', (el) => buy(buyUpgrade(s, el.dataset.up as UpgradeId)));
    this.on('[data-a=forge]', () => buy(buyForge(s)));
    this.on('[data-a=dyn]', () => buy(buyDynamite(s)));
    this.on('[data-a=totem]', () => buy(buyTotem(s)));
    this.on('[data-a=prestige]', () => {
      if (!this.prestigeArmed) {
        this.prestigeArmed = true;
        sfx.click();
        this.renderShop();
        return;
      }
      this.prestigeArmed = false;
      const gained = doPrestige(s);
      if (gained > 0) {
        sfx.tierUp();
        vibrate('heavy');
        this.persist();
      }
      this.renderShop();
    });
  }

  private showResults(adUsed: boolean): void {
    const r = this.result!;
    this.mode = 'results';
    const tier = this.tierName(r.tier);
    this.setScreen(`
      <div class="results">
        <h2 class="center">${r.core ? t('resultsCore') : t('results')}</h2>
        <div class="big-depth">${r.depth} ${t('m')}</div>
        ${r.newRecord ? `<div class="record">🏆 ${t('newRecord')}</div>` : ''}
        <div class="panel rows">
          <div><span>${t('oreCoins')}</span><span>🪙 ${fmt(r.oreCoins)}</span></div>
          <div><span>${t('depthCoins')}</span><span>🪙 ${fmt(r.depthCoins)}</span></div>
          ${r.bonusCoins ? `<div><span>${t('bonusCoins')}</span><span>🪙 ${fmt(r.bonusCoins)}</span></div>` : ''}
          ${r.gems ? `<div><span>${t('gemsFound')}</span><span>💎 ${r.gems}</span></div>` : ''}
          <div><span>${t('blocks')}</span><span>${r.blocks}</span></div>
          <div><span>${t('bestCombo')}</span><span>${r.bestCombo}</span></div>
          <div><span>${t('tierReached')}</span><span>${tier}</span></div>
          <div class="tot"><span>${t('total')}</span><span>🪙 ${fmt(r.totalCoins * (adUsed ? 2 : 1))}</span></div>
        </div>
        ${!adUsed && r.totalCoins > 0 ? `<button class="btn gold" data-a="x2">▶ ${t('x2')}</button>` : ''}
        <button class="btn big" data-a="next">${t('continue')}</button>
      </div>`);
    this.on('[data-a=x2]', async (el) => {
      (el as HTMLButtonElement).disabled = true;
      if (await showRewardedAd(t('x2'))) {
        addCoins(this.save, r.totalCoins);
        this.persist();
        sfx.chest();
        this.showResults(true);
      }
    });
    this.on('[data-a=next]', () => {
      sfx.click();
      this.showMenu();
    });
  }

  private showSettings(from: Mode): void {
    this.returnTo = from === 'paused' ? 'paused' : 'menu';
    this.mode = 'settings';
    const st = this.save.settings;
    const langLabel = st.lang === 'auto' ? t('auto') : st.lang.toUpperCase();
    this.setScreen(
      `<div class="topbar"><button class="btn small" data-a="back">◀ ${t('back')}</button></div>
       <h2 style="margin-top:16px">${t('settings')}</h2>
       <div class="panel" style="margin-top:14px">
         <div class="settings-row"><span>🔊 ${t('sound')}</span><button class="btn small" data-a="sound">${st.sound ? t('on') : t('off')}</button></div>
         <div class="settings-row"><span>📳 ${t('vibration')}</span><button class="btn small" data-a="vib">${st.vibration ? t('on') : t('off')}</button></div>
         <div class="settings-row" style="border:0"><span>🌐 ${t('language')}</span><button class="btn small" data-a="lang">${langLabel}</button></div>
       </div>
       <p class="muted center" style="margin-top:20px">${t('runs')}: ${this.save.runs} · ${t('blocks')}: ${fmt(this.save.blocksBroken)} · ${t('collection')}: ${this.save.discovered.length}</p>
       <p class="muted center">Falling Pickaxe v0.1</p>`,
      'solid',
    );
    this.on('[data-a=back]', () => {
      sfx.click();
      if (this.returnTo === 'paused') {
        this.mode = 'settings';
        this.pause();
      } else this.showMenu();
    });
    this.on('[data-a=sound]', () => {
      st.sound = !st.sound;
      sfx.enabled = st.sound;
      sfx.click();
      this.persist();
      this.showSettings(this.returnTo);
    });
    this.on('[data-a=vib]', () => {
      st.vibration = !st.vibration;
      setVibration(st.vibration);
      vibrate('medium');
      this.persist();
      this.showSettings(this.returnTo);
    });
    this.on('[data-a=lang]', () => {
      st.lang = st.lang === 'auto' ? 'ru' : st.lang === 'ru' ? 'en' : 'auto';
      setLang(st.lang);
      sfx.click();
      this.persist();
      this.showSettings(this.returnTo);
    });
  }
}
