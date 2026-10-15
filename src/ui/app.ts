import { App as CapApp } from '@capacitor/app';
import { flush, setUserProps, startAnalytics, track } from '../analytics';
import { BIOME_THEMES, music, type ThemeId } from '../audio/music';
import { sfx } from '../audio/sfx';
import { blockDef } from '../game/blocks';
import { Bot } from '../game/bot';
import { BIOMES, TIERS, biomeIndex } from '../game/config';
import { addCoins, deriveStats } from '../game/economy';
import { trackQuests, unlocked } from '../game/meta';
import { addPlayTime, recordRun, startSession, userProperties } from '../game/profile';
import { applyResult, type ProgressReport } from '../game/progress';
import { Run, type GameEvent, type RunResult } from '../game/run';
import { clockNow, loadSave, writeSave, type SaveData } from '../game/save';
import { clearPush, listenPushOpens, schedulePush } from '../notifications';
import { isNative, setVibration, showRewardedAd, vibrate } from '../platform';
import { Renderer } from '../render/renderer';
import { makePickaxe } from '../render/textures';
import { $, closeModal, modalOpen, toast } from './dom';
import { fmt } from './format';
import { setLang, t } from './i18n';
import { icon } from './icons';
import { Screens, type ScreenId } from './screens';

type Mode = 'menu' | 'play' | 'paused' | 'dying' | 'revive' | 'results';

const FIXED_DT = 1 / 120;
const MAX_STEPS = 8;
/** Background longer than this starts a new analytics session (industry default: 30 min). */
const SESSION_TIMEOUT = 30 * 60_000;
const BANNER_GAP = 4;

export class App {
  save: SaveData = loadSave();
  renderer: Renderer;
  run!: Run;
  bot: Bot | null = null;
  mode: Mode = 'menu';
  screen: ScreenId = 'home';
  result: RunResult | null = null;
  report: ProgressReport | null = null;
  readonly ui: Screens;

  private last = 0;
  private acc = 0;
  private dyingTimer = 0;
  private pickImg = new Map<number, string>();
  private blockImg = new Map<number, string>();
  private banners: { html: string; color: string }[] = [];
  private bannerBusy = false;
  private hud = { dur: -1, max: -1, depth: -1, coins: -1, gems: -1, nudges: -1, bombs: -1, combo: -1, fever: false, buffs: '' };
  private frameTimes: number[] = [];
  private coachState: 'none' | 'tap' | 'bomb' = 'none';
  private runStartedAt = 0;
  private tick = 0;
  private activeSince = Date.now();
  private backgroundAt = 0;
  private musicBiome = -1;
  private lastMinorBanner = -1e9;
  private bombHintShown = false;

  constructor() {
    const st = this.save.settings;
    setLang(st.lang);
    sfx.enabled = st.sound;
    music.enabled = st.music;
    setVibration(st.vibration);
    this.renderer = new Renderer($<HTMLCanvasElement>('canvas'));
    this.applyQuality();
    this.ui = new Screens(this);
    this.staticIcons();
    this.bindInput();
    this.beginSession();
    startAnalytics();
    listenPushOpens();
    void clearPush();

    if (!this.save.difficulty) {
      // First launch: one quick choice, then straight into the scripted run.
      this.startDemo();
      this.ui.difficultyPicker(true);
    } else if (!this.save.tutorialDone) {
      this.startTutorial();
    } else {
      this.startDemo();
      this.ui.show('home');
      this.ui.autoPopups();
    }
    requestAnimationFrame((ts) => this.loop(ts));
  }

  startTutorial(): void {
    track('tutorial_start', { difficulty: this.save.difficulty });
    this.startRun();
  }

  // ───────────────────────── sessions & player analytics ─────────────────────────

  private beginSession(): void {
    const now = this.now();
    const st = startSession(this.save, now);
    setUserProps(userProperties(this.save, now), st.session);
    track('session_start', { n: st.session, day: st.day, new_day: st.newActiveDay });
    if (st.retention !== null) track(`retention_d${st.retention}`, { sessions: st.session });
    this.activeSince = Date.now();
    this.persist();
  }

  /** App went to the background: account time, flush analytics, schedule reminders. */
  private onBackground(): void {
    if (this.mode === 'play') this.pause();
    const sec = (Date.now() - this.activeSince) / 1000;
    addPlayTime(this.save, sec);
    this.activeSince = Date.now();
    this.backgroundAt = Date.now();
    track('session_pause', { sec: Math.round(sec) });
    this.persist();
    flush();
    music.stop();
    void schedulePush(this.save, this.now()).then((n) => n && track('push_scheduled', { n }));
  }

  private onForeground(): void {
    this.activeSince = Date.now();
    if (this.backgroundAt && Date.now() - this.backgroundAt > SESSION_TIMEOUT) this.beginSession();
    this.backgroundAt = 0;
    void clearPush();
    this.updateMusic(true);
    if (this.mode === 'menu') this.ui.show(this.screen);
  }

  /** Seconds played since the app came to the foreground (not yet added to the profile). */
  get liveSessionSec(): number {
    return (Date.now() - this.activeSince) / 1000;
  }

  refreshUserProps(): void {
    setUserProps(userProperties(this.save, this.now()), this.save.profile.sessions);
  }

  // ───────────────────────── music ─────────────────────────

  private musicTheme(): ThemeId {
    if (this.mode === 'menu' || this.mode === 'results' || this.bot) return 'menu';
    return BIOME_THEMES[biomeIndex(Math.max(0, this.run.depth))];
  }

  /** Keep the soundtrack in sync with mode, biome, fever and overlays. */
  updateMusic(force = false): void {
    if (!sfx.context) return;
    const theme = this.musicTheme();
    const bi = this.mode === 'play' ? biomeIndex(Math.max(0, this.run.depth)) : -1;
    if (force || bi !== this.musicBiome) {
      this.musicBiome = bi;
      music.play(theme);
    }
    music.setFever(this.mode === 'play' && this.run.fever);
    music.duck(this.mode === 'paused' || this.mode === 'revive' || modalOpen());
  }

  // ───────────────────────── helpers ─────────────────────────

  now(): number {
    return clockNow(this.save);
  }

  persist(): void {
    this.now();
    writeSave(this.save);
  }

  applyQuality(): void {
    const st = this.save.settings;
    this.renderer.shakeEnabled = st.shake;
    this.renderer.fx.density = st.particles === 'low' ? 0.35 : 1;
  }

  pickUrl(tier: number): string {
    let u = this.pickImg.get(tier);
    if (!u) {
      u = makePickaxe(tier, 8).toDataURL();
      this.pickImg.set(tier, u);
    }
    return u;
  }

  blockUrl(id: number): string {
    let u = this.blockImg.get(id);
    if (!u) {
      const src = this.renderer.tex.blocks[id];
      const c = document.createElement('canvas');
      c.width = c.height = 48;
      const ctx = c.getContext('2d')!;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(src, 0, 0, 48, 48);
      u = c.toDataURL();
      this.blockImg.set(id, u);
    }
    return u;
  }

  tierName(tier: number): string {
    return t(`tier.${TIERS[tier].key}`);
  }

  private staticIcons(): void {
    $('pauseBtn').innerHTML = icon('pause', 24);
    $('bombIcon').innerHTML = icon('bomb', 46);
  }

  // ───────────────────────── runs ─────────────────────────

  startDemo(): void {
    const stats = deriveStats(this.save);
    stats.dynamite = 3;
    stats.maxDurBase = Math.max(stats.maxDurBase, 120);
    stats.startDepth = 0;
    this.run = new Run({ seed: (Math.random() * 1e9) | 0, stats, bestDepth: 1e9, milestones: BIOMES.map((_, i) => i) });
    this.bot = new Bot(0.8);
    this.renderer.reset(this.run);
  }

  startRun(): void {
    sfx.unlock();
    const tutorial = !this.save.tutorialDone;
    const stats = deriveStats(this.save);
    this.run = new Run({ seed: (Math.random() * 1e9) | 0, stats, bestDepth: this.save.bestDepth, milestones: this.save.milestones, tutorial });
    this.bot = null;
    this.renderer.reset(this.run);
    this.mode = 'play';
    this.acc = 0;
    this.runStartedAt = this.now();
    this.musicBiome = -2;
    this.ui.clear();
    this.ui.nav(false);
    $('hud').classList.remove('hidden');
    this.hud = { dur: -1, max: -1, depth: -1, coins: -1, gems: -1, nudges: -1, bombs: -1, combo: -1, fever: false, buffs: '' };
    this.banners = [];
    this.setCoach(tutorial ? 'tap' : 'none');
    track('run_start', { n: this.save.runs + 1, start: stats.startDepth, tier: stats.startTier, tutorial });
  }

  private setCoach(state: 'none' | 'tap' | 'bomb'): void {
    this.coachState = state;
    const host = $('coach');
    $('bombBtn').classList.toggle('pulse', state === 'bomb');
    if (state === 'tap') {
      host.innerHTML = `<div class="coach tap">${t('hintTap')}<div class="hands"><span class="hand">${icon('hand', 56)}</span><span class="hand b">${icon('hand', 56)}</span></div></div>`;
    } else if (state === 'bomb') {
      host.innerHTML = `<div class="coach bomb-hint">${t('hintBomb')}<br><span class="hand">${icon('hand', 48)}</span></div>`;
      setTimeout(() => this.coachState === 'bomb' && this.setCoach('none'), 4000);
    } else host.innerHTML = '';
  }

  /** Called when the pickaxe breaks: offer a second chance once per run. */
  /** Second chance only when there is something worth saving (a good run), never in the tutorial. */
  private reviveWorthIt(): boolean {
    const r = this.run;
    const best = this.save.bestDepth;
    if (r.revives > 0 || r.core || r.init.tutorial || r.depth < 20) return false;
    // frequency cap: at most once every 3 runs
    if (this.save.runs - this.save.profile.lastReviveOffer < 3) return false;
    // only for a run that is fighting for the record
    return r.depth >= best * 0.85;
  }

  private onBroken(): void {
    if (this.reviveWorthIt()) {
      this.mode = 'revive';
      $('hud').classList.add('hidden');
      this.ui.reviveOffer(false);
      this.save.profile.adsOffered++;
      this.save.profile.lastReviveOffer = this.save.runs;
      track('ad_offer', { placement: 'revive' });
    } else {
      this.mode = 'dying';
      this.dyingTimer = this.run.core ? 2.5 : 1.1;
    }
  }

  async acceptRevive(free: boolean): Promise<void> {
    closeModal();
    const ok = free || (await showRewardedAd(t('reviveAd')));
    if (ok && this.run.revive()) {
      this.save.profile.revives++;
      if (!free) this.save.profile.adsWatched++;
      track(free ? 'revive_free' : 'ad_watched', { placement: 'revive' });
      this.mode = 'play';
      $('hud').classList.remove('hidden');
      this.hud.dur = -1;
      sfx.tierUp();
      vibrate('heavy');
      this.banner(`<div class="t">${t('revived')}</div>`, '#5dff7a');
    } else this.declineRevive();
  }

  declineRevive(): void {
    closeModal();
    this.mode = 'dying';
    this.dyingTimer = 0.4;
  }

  finishRun(): void {
    const r = this.run.result();
    this.result = r;
    const wasTutorial = !this.save.tutorialDone;
    this.report = applyResult(this.save, r, 1, this.now());
    recordRun(this.save, r, this.now());
    this.refreshUserProps();
    this.persist();
    $('hud').classList.add('hidden');
    this.setCoach('none');
    this.mode = 'results';
    track('run_end', {
      n: this.save.runs,
      depth: r.depth,
      coins: r.totalCoins,
      time: Math.round(r.time),
      tier: r.tier,
      record: r.newRecord,
      revived: this.run.revives > 0,
    });
    if (wasTutorial) track('tutorial_complete', { depth: r.depth });
    for (const l of this.report.levelsReached) track('level_up', { level: l });
    this.ui.results(false);
  }

  async doubleCoins(): Promise<boolean> {
    const r = this.result;
    if (!r) return false;
    track('ad_offer', { placement: 'x2' });
    this.save.profile.adsOffered++;
    if (!(await showRewardedAd(t('x2')))) return false;
    this.save.profile.adsWatched++;
    addCoins(this.save, r.totalCoins);
    trackQuests(this.save, { coins: r.totalCoins }, this.now());
    this.persist();
    track('ad_watched', { placement: 'x2' });
    return true;
  }

  // ───────────────────────── loop ─────────────────────────

  private loop(ts: number): void {
    const frame = Math.min(0.1, (ts - this.last) / 1000 || 0);
    this.last = ts;
    try {
      this.frame(frame);
    } catch (err) {
      // Keep the game alive; report and continue on the next frame.
      track('error', { msg: String(err).slice(0, 120), src: 'loop', line: 0 });
      console.error(err);
    }
    requestAnimationFrame((n) => this.loop(n));
  }

  private frame(dt: number): void {
    const run = this.run;
    const simulate = this.mode === 'play' || this.mode === 'dying' || (this.mode === 'menu' && this.bot !== null);

    if (simulate) {
      // Fixed timestep: identical physics on 60/90/120 Hz screens.
      this.acc = Math.min(this.acc + dt, FIXED_DT * MAX_STEPS);
      let broke = false;
      while (this.acc >= FIXED_DT) {
        this.acc -= FIXED_DT;
        run.step(FIXED_DT);
        for (const e of run.drainEvents()) {
          this.renderer.onEvent(e);
          if (e.t === 'break') broke = true;
          if (!this.bot) this.react(e);
        }
      }
      if (this.bot) {
        this.bot.update(run, dt, broke);
        if (run.over) this.startDemo();
      }
    }
    if (this.mode === 'play' && run.over) this.onBroken();
    if (this.mode === 'dying') {
      this.dyingTimer -= dt;
      if (this.dyingTimer <= 0) this.finishRun();
    }
    if (this.mode !== 'paused' && this.mode !== 'revive') this.renderer.update(this.run, dt);
    this.renderer.draw(this.run);
    if (this.mode === 'play' || this.mode === 'dying') this.updateHud();
    if (this.mode === 'menu' && ++this.tick % 30 === 0) this.ui.refreshTimers();
    if (this.tick % 10 === 0 || this.mode !== 'menu') this.updateMusic();
    this.adaptQuality(dt);
  }

  /** Drop the canvas resolution on slow devices (keeps ≥ ~45 fps). */
  private adaptQuality(dt: number): void {
    if (this.mode !== 'play') return;
    this.frameTimes.push(dt);
    if (this.frameTimes.length < 120) return;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    this.frameTimes = [];
    if (avg > 1 / 45 && this.renderer.maxDpr > 1) {
      this.renderer.maxDpr = this.renderer.maxDpr > 2 ? 2 : this.renderer.maxDpr > 1.5 ? 1.5 : 1;
      this.renderer.resize();
      track('quality_drop', { dpr: this.renderer.maxDpr, fps: Math.round(1 / avg) });
    }
  }

  /** Sounds, haptics, banners and coach marks for gameplay events. */
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
        if (!this.save.tutorialDone) track('tutorial_tierup', { tier: e.tier });
        break;
      case 'heal':
        sfx.anvil();
        vibrate('medium');
        this.banner(`<div class="t">${t('heal')}</div><div class="s">+${e.amount}</div>`, '#5dff7a', false);
        break;
      case 'chest': {
        sfx.chest();
        vibrate('medium');
        const key = { coins: 'chestCoins', gems: 'chestGems', dynamite: 'chestDynamite', durability: 'chestDurability' }[e.loot];
        this.banner(`<div class="t">${t(key, { n: fmt(e.amount) })}</div>`, '#ffd23f', false);
        break;
      }
      case 'furnace':
        sfx.magic();
        this.banner(`<div class="t">${t('furnace')}</div>`, '#ff8c1a', false);
        break;
      case 'enchant':
        sfx.magic();
        vibrate('medium');
        this.banner(`<div class="t">${t(`ench.${e.id}`)}</div>`, '#c77dff', false);
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
          `<div class="t">${t(`biome.${BIOMES[e.biome].key}`)}</div><div class="s">+${fmt(e.coins)} · +${e.gems}</div>`,
          '#6ff3f0',
        );
        track('milestone', { biome: e.biome });
        break;
      case 'totem':
        sfx.tierUp();
        vibrate('heavy');
        this.banner(`<div class="t">${t('totemUsed')}</div>`, '#ffe066');
        break;
      case 'shatter':
        sfx.shatter();
        vibrate('heavy');
        break;
      case 'core':
        sfx.fanfare();
        vibrate('heavy');
        this.banner(`<div class="t">${t('core')}</div>`, '#ff7ad9');
        break;
      case 'nudge':
        sfx.nudge();
        vibrate('light');
        if (this.coachState === 'tap') {
          this.setCoach('none');
          track('tutorial_first_tap');
        }
        break;
      case 'combo':
        // the HUD combo counter already celebrates this — no banner
        break;
      case 'fever':
        sfx.fanfare();
        vibrate('heavy');
        this.banner(`<div class="t">${t('fever')}</div><div class="s">${t('feverSub')}</div>`, '#ff7ad9');
        break;
      case 'stuck':
        // taught once: until the player has used dynamite at least once
        if (!this.bombHintShown && this.save.life.dynamiteUsed === 0 && this.run.dynamiteUsed === 0 && this.run.depth > 8 && this.run.dynamite > 0 && this.coachState === 'none') {
          this.bombHintShown = true;
          this.setCoach('bomb');
        }
        break;
      case 'dynamite':
        if (this.coachState === 'bomb') this.setCoach('none');
        break;
      case 'revive':
        break;
    }
  }

  private flashDur(): void {
    const el = $('dur');
    el.classList.remove('hurt');
    void el.offsetWidth;
    el.classList.add('hurt');
  }

  /**
   * In-run banners. Important moments always show; minor ones (chest, furnace, repair…)
   * at most once per BANNER_GAP seconds so the screen never turns into a slot machine.
   */
  banner(html: string, color: string, important = true): void {
    const now = performance.now();
    if (!important && (this.bannerBusy || now - this.lastMinorBanner < BANNER_GAP * 1000)) return;
    if (!important) this.lastMinorBanner = now;
    if (this.banners.length >= 2) this.banners.shift();
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
      const frac = Math.min(1, dur / r.maxDur);
      const fill = $('durFill');
      fill.style.width = `${frac * 100}%`;
      $('durGhost').style.width = `${frac * 100}%`;
      fill.className = 'dur-fill' + (frac > 0.6 ? ' high' : frac > 0.3 ? ' mid' : '');
      $('durText').textContent = `${dur} / ${r.maxDur}`;
      if (!$('dur').querySelector('.ico')) $('dur').insertAdjacentHTML('afterbegin', icon('heart', 34));
    }
    if (r.depth !== h.depth) {
      h.depth = r.depth;
      $('depth').innerHTML = `${icon('down', 30)}${r.depth} ${t('m')}`;
    }
    const coins = r.runCoins;
    if (coins !== h.coins) {
      h.coins = coins;
      $('runCoins').innerHTML = `${icon('coin', 30)}${fmt(coins)}`;
    }
    if (r.gems !== h.gems) {
      h.gems = r.gems;
      const g = $('runGems');
      g.innerHTML = `${icon('gem', 30)}${r.gems}`;
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
    if (combo !== h.combo || r.fever !== h.fever) {
      const el = $('combo');
      el.innerHTML = combo ? `${combo}<small>x${r.comboMult.toFixed(2)}</small>` : '';
      el.classList.toggle('on', combo > 0);
      el.classList.toggle('fever', r.fever);
      if (combo > h.combo) {
        el.classList.remove('pop');
        void el.offsetWidth;
        el.classList.add('pop');
      }
      h.combo = combo;
      h.fever = r.fever;
    }
    const buffs: string[] = [];
    if (r.fever) buffs.push(`<span class="buff" style="--c:#c2368f">${icon('sparkle', 20)}${t('fever')} ${Math.ceil(r.feverTimer)}</span>`);
    if (r.furnaceTimer > 0) buffs.push(`<span class="buff" style="--c:#c25a12">${icon('fire', 20)}x2 ${Math.ceil(r.furnaceTimer)}</span>`);
    for (const [k, v] of Object.entries(r.enchants)) {
      if (v > 0) buffs.push(`<span class="buff" style="--c:#6a35c2">${icon('sparkle', 20)}${t(`ench.${k}`).split(':')[0]}${v > 1 ? ' x' + v : ''}</span>`);
    }
    if (r.totems > 0) buffs.push(`<span class="buff" style="--c:#8a6a1a">${icon('totem', 20)}</span>`);
    const bh = buffs.join('');
    if (bh !== h.buffs) {
      h.buffs = bh;
      $('buffs').innerHTML = bh;
    }
  }

  // ───────────────────────── input ─────────────────────────

  private bindInput(): void {
    const canvas = $<HTMLCanvasElement>('canvas');
    // Audio can only start after a user gesture (autoplay policy).
    window.addEventListener(
      'pointerdown',
      () => {
        const first = !sfx.context;
        sfx.unlock();
        if (first) this.updateMusic(true);
      },
      { capture: true },
    );
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
        if (ev.key === 'Escape') this.back();
        return;
      }
      if (ev.key === 'ArrowLeft' || ev.key === 'a') this.run.nudge(-1);
      else if (ev.key === 'ArrowRight' || ev.key === 'd') this.run.nudge(1);
      else if (ev.key === ' ' || ev.key === 'ArrowDown') this.run.useDynamite();
      else if (ev.key === 'Escape' || ev.key === 'p') this.pause();
    });
    window.addEventListener('resize', () => this.renderer.resize());
    document.addEventListener('visibilitychange', () => (document.hidden ? this.onBackground() : this.onForeground()));
    if (isNative) void CapApp.addListener('backButton', () => this.back());
  }

  /** Android back button / Escape. */
  back(): void {
    if (modalOpen()) {
      if (this.mode === 'revive') this.declineRevive();
      else closeModal();
      return;
    }
    switch (this.mode) {
      case 'play':
        this.pause();
        break;
      case 'paused':
        this.resume();
        break;
      case 'results':
        this.ui.show('home');
        break;
      case 'menu':
        if (this.screen !== 'home') this.ui.show('home');
        else if (isNative) void CapApp.exitApp();
        break;
    }
  }

  pause(): void {
    if (this.mode !== 'play') return;
    this.mode = 'paused';
    this.ui.pause();
  }

  resume(): void {
    this.mode = 'play';
    this.acc = 0;
    this.ui.clear();
  }

  quitRun(): void {
    this.save.profile.quits++;
    track('run_quit', { depth: this.run.depth });
    this.mode = 'dying';
    this.dyingTimer = 0;
    this.ui.clear();
    this.run.over = true;
  }

  goMenu(): void {
    if (this.mode !== 'menu') {
      this.mode = 'menu';
      this.startDemo();
    }
  }

  isUnlocked(f: Parameters<typeof unlocked>[1]): boolean {
    return unlocked(this.save, f);
  }

  get runTime(): number {
    return this.now() - this.runStartedAt;
  }

  notifyQuests(done: { type: string; target: number }[]): void {
    for (const q of done) {
      toast(`${icon('scroll', 28)}<span>${t('questDoneToast')}<br><small class="sub">${t(`q.${q.type}`, { n: fmt(q.target) })}</small></span>`);
      sfx.chest();
    }
  }
}
