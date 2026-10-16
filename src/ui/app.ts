import { App as CapApp } from '@capacitor/app';
import { flush, setUserProps, startAnalytics, track } from '../analytics';
import { BIOME_THEMES, music, type ThemeId } from '../audio/music';

/** Later worlds reuse the six biome tunes in their own order. */
const WORLD_THEMES: ThemeId[][] = [
  BIOME_THEMES,
  ['meadow', 'caves', 'grotto', 'depths', 'abyss'],
  ['meadow', 'depths', 'lava', 'grotto', 'abyss'],
];
import { sfx } from '../audio/sfx';
import { blockDef } from '../game/blocks';
import { Bot } from '../game/bot';
import { BOOSTS, FAST_FORWARD, MINE_EVENTS, PHYS, RUNES, TIERS, WORLDS, biomeIndex, biomesOf, type BoostId } from '../game/config';
import { addCoins, deriveStats } from '../game/economy';
import { missionsReachedLive, progressMissions, runMetrics, unlocked, type MissionDone } from '../game/meta';
import { addPlayTime, eventGoalFor, recordRun, startSession, userProperties } from '../game/profile';
import { applyResult, switchWorld, type ProgressReport } from '../game/progress';
import { Run, type GameEvent, type RunResult } from '../game/run';
import { clockNow, loadSave, wipeStorage, writeSave, type SaveData } from '../game/save';
import { clearPush, listenPushOpens, schedulePush } from '../notifications';
import { isNative, setVibration, showRewardedAd, vibrate } from '../platform';
import { Renderer } from '../render/renderer';
import { makePickaxe } from '../render/textures';
import { $, closeModal, modalOpen, toast } from './dom';
import { fmt } from './format';
import { missionText, setLang, t } from './i18n';
import { BOOST_ICON, icon } from './icons';
import { Screens, type ScreenId } from './screens';

type Coach = 'none' | 'tap' | 'bomb' | 'nudges' | 'events' | 'down' | 'boosts';
type Mode = 'menu' | 'play' | 'paused' | 'dying' | 'revive' | 'results';

const FIXED_DT = 1 / 120;
/** Enough sub-steps for ×4 fast-forward at 60 fps. */
const MAX_STEPS = 36;
/** Background longer than this starts a new analytics session (industry default: 30 min). */
const SESSION_TIMEOUT = 30 * 60_000;
const BANNER_GAP = 4;
const BOOST_COLOR: Record<BoostId, string> = { dynamite: '#ff6a3d', giant: '#ffb020', twin: '#6ff3f0', teleport: '#c77dff', shield: '#5ab0ff', magnet: '#ff3355', meteor: '#ff7a1a', lightning: '#9fe8ff', blackhole: '#8b5cf6', rockets: '#ff4f6d', laser: '#ff2e2e', phantom: '#b8c4ff' };

export class App {
  save: SaveData = loadSave();
  renderer: Renderer;
  run!: Run;
  bot: Bot | null = null;
  private lastBoom = 0;
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
  /** Fast-forward multiplier chosen by the player for this run. */
  speed = 1;
  private ffUnlocked = 0;
  private hud = { dur: -1, max: -1, depth: -1, coins: -1, gems: -1, nudges: -1, bombs: -1, combo: -1, fever: false, buffs: '' };
  private frameTimes: number[] = [];
  private missionTick = 0;
  private coachState: Coach = 'none';
  private evKey = '';
  /** Run time at which the nudge-panel hint should appear (0 = not planned this run). */
  private nudgeHintAt = 0;
  private runStartedAt = 0;
  private tick = 0;
  private activeSince = Date.now();
  private backgroundAt = 0;
  private musicBiome = -1;
  private lastMinorBanner = -1e9;
  private bombHintShown = false;
  /** Missions already celebrated during this run (toast once). */
  private liveMissions = new Set<string>();
  private boostKey = '';
  /** Run time at which the down-breakthrough / power-up hints appear (0 = none). */
  private downHintAt = 0;
  private boostHintAt = 0;

  constructor() {
    const st = this.save.settings;
    setLang(st.lang);
    sfx.enabled = st.sound;
    music.enabled = st.music;
    music.style = st.musicStyle;
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
    if (!this.resetting) flush();
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
    const w = this.run.worldIdx;
    const themes = WORLD_THEMES[w] ?? BIOME_THEMES;
    return themes[biomeIndex(Math.max(0, this.run.depth), w)] ?? themes[0];
  }

  /** Keep the soundtrack in sync with mode, biome, fever and overlays. */
  updateMusic(force = false): void {
    if (!sfx.context) return;
    const theme = this.musicTheme();
    const bi = this.mode === 'play' ? this.run.worldIdx * 100 + biomeIndex(Math.max(0, this.run.depth), this.run.worldIdx) : -1;
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

  /** Set while wiping progress: nothing may be written back (reload fires "background" → save). */
  private resetting = false;

  persist(): void {
    if (this.resetting) return;
    this.now();
    writeSave(this.save);
  }

  /**
   * Tester shortcut (console: game.cheat({...})). Edits the live save — editing localStorage
   * directly does not work because the game writes its in-memory state back on reload.
   */
  cheat(o: { coins?: number; gems?: number; level?: number; depth?: number; forge?: number; size?: number; width?: number; playMin?: number; down?: number; boosts?: number; world?: number } = {}): void {
    const s = this.save;
    s.coins += o.coins ?? 1e6;
    s.gems += o.gems ?? 100;
    if (o.level) s.level = o.level;
    if (o.depth !== undefined) s.bestDepth = Math.max(s.bestDepth, o.depth);
    if (o.forge !== undefined) s.forgeTier = Math.max(0, Math.min(TIERS.length - 1, o.forge));
    if (o.size !== undefined) s.pickSize = Math.max(0, Math.min(5, o.size));
    if (o.width !== undefined) s.shaftWidth = Math.max(0, Math.min(5, o.width));
    if (o.down !== undefined) s.dashDown = Math.max(0, Math.min(5, o.down));
    if (o.boosts) for (const k of Object.keys(s.boosts) as (keyof typeof s.boosts)[]) s.boosts[k] += o.boosts;
    if (o.world !== undefined) {
      // open every world up to this one (as if the Cores were reached) and switch to it
      const w = Math.max(0, Math.min(WORLDS.length - 1, o.world));
      for (let i = 0; i < w; i++) {
        if (i === s.world) s.coreReached = true;
        else s.worldSaves[i].coreReached = true;
      }
      s.worldsOpen = Math.max(s.worldsOpen, w + 1);
      s.forgeTier = Math.max(s.forgeTier, WORLDS[w].baseTier);
      for (let i = 0; i < s.worldsOpen; i++) if (!s.worldIntro.includes(i)) s.worldIntro.push(i);
      switchWorld(s, w);
    }
    if (o.playMin !== undefined) s.profile.playSec = Math.max(s.profile.playSec, o.playMin * 60);
    if (!s.difficulty) s.difficulty = 'normal';
    s.tutorialDone = true;
    closeModal();
    this.persist();
    this.ui.show('home');
  }

  /** Start over from scratch: wipe storage and reload without saving anything back. */
  resetProgress(): void {
    track('progress_reset', { runs: this.save.runs, level: this.save.level });
    this.resetting = true;
    music.stop();
    wipeStorage();
    location.reload();
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
  }

  // ───────────────────────── runs ─────────────────────────

  startDemo(): void {
    const stats = deriveStats(this.save);
    stats.dynamite = 3;
    stats.maxDurBase = Math.max(stats.maxDurBase, 120);
    stats.startDepth = 0;
    this.run = new Run({ seed: (Math.random() * 1e9) | 0, stats, bestDepth: 1e9, milestones: biomesOf(stats.world).map((_, i) => i) });
    this.bot = new Bot(0.8);
    this.renderer.reset(this.run);
  }

  startRun(): void {
    sfx.unlock();
    const tutorial = !this.save.tutorialDone;
    const stats = deriveStats(this.save);
    const eventGoal = tutorial ? 0 : eventGoalFor(this.save, this.liveSessionSec);
    this.run = new Run({ seed: (Math.random() * 1e9) | 0, stats, bestDepth: this.save.bestDepth, milestones: this.save.milestones, tutorial, eventGoal });
    this.evKey = '';
    if (eventGoal && !this.save.hintEventsDone) {
      track('feature_unlock', { feature: 'mine_events', play_min: Math.round(this.save.profile.playSec / 60) });
    }
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
    this.speed = 1;
    this.ffUnlocked = 0;
    this.renderFF();
    this.setCoach(tutorial ? 'tap' : 'none');
    // Explain the charges panel once: in the tutorial right after the first tap and the upgrade
    // banner (~3.5 s); runs 2–3 are only a fallback if it was missed.
    this.nudgeHintAt = this.save.hintNudgeDone ? 0 : tutorial ? 3.5 : this.save.runs <= 2 ? 2.5 : 0;
    this.downHintAt = stats.dashDownBlocks > 0 && !this.save.hintDownDone ? 1.5 : 0;
    this.boostHintAt = this.isUnlocked('boosts') && !this.save.hintBoostsDone && this.save.loadout.length > 0 ? 4 : 0;
    this.liveMissions.clear();
    this.buildBoosts();
    track('run_start', { n: this.save.runs + 1, start: stats.startDepth, tier: stats.startTier, tutorial });
  }

  private setCoach(state: Coach): void {
    this.coachState = state;
    const host = $('coach');
    $('evBar').classList.toggle('spot', state === 'events');
    if (state === 'events') {
      host.innerHTML = `<div class="coach event-hint"><span class="arrow">${icon('down', 30)}</span><div class="bubble">${t('hintEvents')}</div></div>`;
      setTimeout(() => this.coachState === 'events' && this.setCoach('none'), 6500);
      $('nudges').classList.remove('spot');
      return;
    }
    $('boosts').querySelector('[data-boost=dynamite]')?.classList.toggle('pulse', state === 'bomb');
    $('boosts').classList.toggle('spot', state === 'boosts');
    $('nudges').classList.toggle('spot', state === 'nudges');
    if (state === 'down' || state === 'boosts') {
      host.innerHTML = state === 'down'
        ? `<div class="coach down-hint"><div class="bubble">${t('hintDown')}</div><span class="hand">${icon('hand', 52)}</span></div>`
        : `<div class="coach boost-hint"><div class="bubble">${t('hintBoosts')}</div><span class="arrow">${icon('down', 34)}</span></div>`;
      setTimeout(() => this.coachState === state && this.setCoach('none'), 6000);
      return;
    }
    if (state === 'nudges') {
      host.innerHTML = `<div class="coach nudge-hint"><div class="bubble">${t('hintNudges')}</div><span class="arrow">${icon('down', 34)}</span></div>`;
      setTimeout(() => this.coachState === 'nudges' && this.setCoach('none'), 6000);
      return;
    }
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
    this.notifyMissions(progressMissions(this.save, { coins: r.totalCoins }, false));
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

  // ───────────────────────── breakthrough charge ─────────────────────────

  private charge: { dir: -1 | 0 | 1; start: number } | null = null;

  /** Press: the first tap of the tutorial just releases the pickaxe; otherwise start charging. */
  private startCharge(dir: -1 | 0 | 1): void {
    if (this.run.hold) {
      this.run.nudge(dir || 1);
      return;
    }
    if (dir === 0 && this.run.stats.dashDownBlocks <= 0) return;
    if (this.run.nudges <= 0) {
      sfx.error();
      return;
    }
    this.charge = { dir, start: performance.now() };
    this.renderPower(0);
  }

  private chargePower(): number {
    return this.charge ? Math.min(1, (performance.now() - this.charge.start) / 1000 / PHYS.dashChargeTime) : 0;
  }

  /** Release: dash with the charged power. */
  private releaseCharge(): void {
    if (!this.charge) return;
    const { dir } = this.charge;
    const power = this.chargePower();
    this.charge = null;
    $('power').classList.add('hidden');
    if (this.mode === 'play' && this.run.dash(dir, power)) vibrate(power > 0.7 ? 'heavy' : 'light');
  }

  private renderPower(p: number): void {
    const el = $('power');
    el.classList.remove('hidden');
    el.classList.toggle('max', p >= 1);
    el.classList.toggle('left', this.charge?.dir === -1);
    el.classList.toggle('down', this.charge?.dir === 0);
    $('powerFill').style.setProperty('--p', `${(p * 100).toFixed(0)}%`);
    $('powerText').textContent = p >= 1 ? t('powerMax') : t('power');
  }

  private frame(dt: number): void {
    if (this.charge) {
      if (this.mode !== 'play') {
        this.charge = null;
        $('power').classList.add('hidden');
      } else this.renderPower(this.chargePower());
    }
    const run = this.run;
    const simulate = this.mode === 'play' || this.mode === 'dying' || (this.mode === 'menu' && this.bot !== null);

    if (simulate) {
      // Fixed timestep: identical physics on 60/90/120 Hz screens.
      const mult = this.mode === 'play' || this.mode === 'dying' ? this.speed : 1;
      this.acc = Math.min(this.acc + dt * mult, FIXED_DT * MAX_STEPS);
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
        if (def.ore && def.value >= 50) {
          sfx.ohYes();
          vibrate('medium');
        } else if (def.ore && def.value >= 25) sfx.rare();
        break;
      }
      case 'bounce':
        sfx.bounce();
        break;
      case 'explode': {
        // chain reactions and starfall can blow up many times a second: keep the ears intact
        const now = performance.now();
        if (now - this.lastBoom > 70) {
          this.lastBoom = now;
          sfx.explode();
          vibrate('heavy');
        }
        break;
      }
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
          `<div class="t">${t(`biome.${biomesOf(this.run.worldIdx)[e.biome].key}`)}</div><div class="s">+${fmt(e.coins)} · +${e.gems}</div>`,
          '#6ff3f0',
        );
        track('milestone', { biome: e.biome, world: this.run.worldIdx });
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
      case 'rift':
        sfx.dash(1);
        vibrate('medium');
        this.banner(`<div class="t">${t('fx.rift')}</div><div class="s">${t('riftSub')}</div>`, '#6ff3f0', false);
        break;
      case 'rune':
        sfx.magic();
        vibrate('medium');
        this.banner(`<div class="t">${t(`rune.${e.id}`)}</div><div class="s">${t(`runed.${e.id}`)}</div>`, '#ffd23f');
        break;
      case 'magnet':
        sfx.rare();
        break;
      case 'skid':
        break;
      case 'dash':
        sfx.dash(e.power);
        break;
      case 'dashEnd':
        if (e.broken >= 3) sfx.chest();
        break;
      case 'nudge':
        sfx.nudge();
        vibrate('light');
        if (this.coachState === 'tap') {
          this.setCoach('none');
          track('tutorial_first_tap');
        }
        // tapping while the panel hint is up is the point: keep it a moment, then let it go
        if (this.coachState === 'nudges') setTimeout(() => this.coachState === 'nudges' && this.setCoach('none'), 2500);
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
        if (this.coachState === 'boosts') this.setCoach('none');
        break;
      case 'revive':
        break;
      case 'boost':
        if (e.id === 'dynamite') break;
        sfx.tierUp();
        vibrate('heavy');
        this.banner(`${icon(BOOST_ICON[e.id], 54)}<div class="t">${t(`boost.${e.id}`)}</div>`, BOOST_COLOR[e.id]);
        break;
      case 'teleport':
        sfx.magic();
        vibrate('medium');
        this.banner(`<div class="t">${t('teleported', { n: e.dist })}</div>`, BOOST_COLOR.teleport, false);
        break;
      case 'boostEnd':
        if (e.id !== 'twin' && e.id !== 'teleport') sfx.nudge();
        break;
      case 'twinPoof':
        break;
      case 'zap':
        sfx.dash(0.3);
        break;
      case 'laser':
        sfx.sizzle();
        break;
      case 'mystery':
        sfx.rare();
        break;
      case 'supply':
        sfx.chest();
        vibrate('medium');
        this.banner(
          `${icon('supply', 54)}<div class="t">${t('supply')}</div><div class="s">${e.ids.length ? e.ids.map((id) => icon(BOOST_ICON[id], 22)).join('') + ' +1' : t('supplyNone')}</div>`,
          '#3f7a3a',
        );
        break;
      case 'event':
        sfx.fanfare();
        vibrate('heavy');
        this.banner(`<div class="t">${t(`ev.${e.id}`)}</div><div class="s">${t(`evd.${e.id}`)}</div>`, '#c77dff');
        track('mine_event', { id: e.id, depth: this.run.depth });
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

  /** Speeds available after N seconds of falling: ×1.5 at 10 s, ×2 at 30 s, ×4 at 50 s. */
  private checkFastForward(): void {
    const n = FAST_FORWARD.filter(([sec]) => this.run.time >= sec).length;
    if (n !== this.ffUnlocked) {
      this.ffUnlocked = n;
      this.renderFF(true);
    }
  }

  private renderFF(fresh = false): void {
    const btn = $('ffBtn');
    btn.classList.toggle('hidden', this.ffUnlocked === 0);
    btn.classList.toggle('on', this.speed > 1);
    btn.innerHTML = `${icon('play', 18)}${icon('play', 18)}<b>x${this.speed}</b>`;
    if (fresh) {
      btn.classList.remove('fresh');
      void btn.offsetWidth;
      btn.classList.add('fresh');
    }
  }

  /** Tap cycles through the unlocked speeds: x1 → x1.5 → x2 → x4 → x1. */
  cycleSpeed(): void {
    const options = [1, ...FAST_FORWARD.slice(0, this.ffUnlocked).map(([, v]) => v)];
    const i = options.indexOf(this.speed);
    this.speed = options[(i + 1) % options.length];
    sfx.click();
    track('fast_forward', { speed: this.speed, t: Math.round(this.run.time) });
    this.renderFF();
  }

  private updateHud(): void {
    this.checkFastForward();
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
      $('nudges').innerHTML = Array.from({ length: r.stats.nudgeCharges }, (_, i) => `<i class="${i < r.nudges ? '' : 'empty'}"><b></b></i>`).join('');
    }
    // the next empty charge visibly fills up while it recharges
    const recharging = $('nudges').children[r.nudges] as HTMLElement | undefined;
    if (recharging) {
      const fill = recharging.firstElementChild as HTMLElement | null;
      fill?.style.setProperty('height', `${Math.min(100, (r.nudgeTimer / r.stats.nudgeRegen) * 100).toFixed(0)}%`);
    }
    // mine-event meter
    const ek = r.eventGoal ? `${r.eventProgress}/${r.eventGoal}` : '';
    if (ek !== this.evKey) {
      this.evKey = ek;
      $('evBar').classList.toggle('hidden', !r.eventGoal);
      if (r.eventGoal) {
        $('evFill').style.setProperty('--p', `${((r.eventProgress / r.eventGoal) * 100).toFixed(1)}%`);
        $('evText').textContent = `${t('eventMeter')} · ${r.eventProgress}/${r.eventGoal}`;
        if (!$('evIcon').innerHTML) $('evIcon').innerHTML = icon('sparkle', 26);
      }
    }
    if (r.eventGoal && !this.save.hintEventsDone && r.time >= 2 && this.coachState === 'none') {
      this.save.hintEventsDone = true;
      this.persist();
      this.setCoach('events');
      track('hint_events');
    }
    if (this.nudgeHintAt && r.time >= this.nudgeHintAt && this.coachState === 'none') {
      this.nudgeHintAt = 0;
      this.save.hintNudgeDone = true;
      this.persist();
      this.setCoach('nudges');
      track('hint_nudges', { run: this.save.runs + 1 });
    }
    this.updateBoosts();
    if (this.downHintAt && r.time >= this.downHintAt && this.coachState === 'none') {
      this.downHintAt = 0;
      this.save.hintDownDone = true;
      this.persist();
      this.setCoach('down');
    }
    if (this.boostHintAt && r.time >= this.boostHintAt && this.coachState === 'none') {
      this.boostHintAt = 0;
      this.save.hintBoostsDone = true;
      this.save.settings.boostsOpen = true;
      $('boosts').classList.remove('closed');
      this.persist();
      this.setCoach('boosts');
    }
    if (++this.missionTick % 30 === 0) this.checkLiveMissions();
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
    if (r.goldTimer > 0) buffs.push(`<span class="buff" style="--c:#b88a00">${icon('coin', 20)}x2 ${Math.ceil(r.goldTimer)}</span>`);
    if (r.superTimer > 0) buffs.push(`<span class="buff" style="--c:#c2368f">${icon('hammer', 20)}x3 ${Math.ceil(r.superTimer)}</span>`);
    if (r.furnaceTimer > 0) buffs.push(`<span class="buff" style="--c:#c25a12">${icon('fire', 20)}x2 ${Math.ceil(r.furnaceTimer)}</span>`);
    for (const [k, v] of Object.entries(r.enchants)) {
      if (v > 0) buffs.push(`<span class="buff" style="--c:#6a35c2">${icon('sparkle', 20)}${t(`ench.${k}`).split(':')[0]}${v > 1 ? ' x' + v : ''}</span>`);
    }
    if (r.mightTimer > 0) buffs.push(`<span class="buff" style="--c:#c2402a">${icon('hammer', 20)}x${RUNES.might} ${Math.ceil(r.mightTimer)}</span>`);
    if (r.lightningTimer > 0) buffs.push(`<span class="buff" style="--c:#2a78a8">${icon('lightning', 20)}${Math.ceil(r.lightningTimer)}</span>`);
    if (r.laserTimer > 0) buffs.push(`<span class="buff" style="--c:#b81e1e">${icon('laser', 20)}${Math.ceil(r.laserTimer)}</span>`);
    if (r.phantomTimer > 0) buffs.push(`<span class="buff" style="--c:#5a63a8">${icon('phantom', 20)}${Math.ceil(r.phantomTimer)}</span>`);
    if (r.turboTimer > 0) buffs.push(`<span class="buff" style="--c:#1f8f8c">${icon('arrows', 20)}x${MINE_EVENTS.turboSpeed} ${Math.ceil(r.turboTimer)}</span>`);
    if (r.chainTimer > 0) buffs.push(`<span class="buff" style="--c:#c25a12">${icon('bomb', 20)}${Math.ceil(r.chainTimer)}</span>`);
    if (r.alchemyTimer > 0) buffs.push(`<span class="buff" style="--c:#b88a00">${icon('sparkle', 20)}${Math.ceil(r.alchemyTimer)}</span>`);
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
      const fx = (ev.clientX - rect.left) / rect.width;
      // with the down breakthrough the middle third dives straight down
      if (this.run.stats.dashDownBlocks > 0) this.startCharge(fx < 1 / 3 ? -1 : fx > 2 / 3 ? 1 : 0);
      else this.startCharge(fx < 0.5 ? -1 : 1);
    });
    // release anywhere (finger may slide off the canvas)
    window.addEventListener('pointerup', () => this.releaseCharge());
    window.addEventListener('pointercancel', () => this.releaseCharge());
    $('boosts').addEventListener('pointerdown', (ev) => {
      ev.stopPropagation();
      const el = (ev.target as HTMLElement).closest<HTMLElement>('[data-boost],[data-btoggle]');
      if (!el || this.mode !== 'play') return;
      if (el.dataset.btoggle !== undefined) {
        this.save.settings.boostsOpen = !this.save.settings.boostsOpen;
        $('boosts').classList.toggle('closed', !this.save.settings.boostsOpen);
        sfx.click();
        this.persist();
        return;
      }
      this.tapBoost(el.dataset.boost as BoostId);
    });
    $('pauseBtn').addEventListener('click', () => this.pause());
    $('ffBtn').addEventListener('pointerdown', (ev) => {
      ev.stopPropagation();
      if (this.mode === 'play') this.cycleSpeed();
    });
    window.addEventListener('keydown', (ev) => {
      if (this.mode !== 'play') {
        if (ev.key === 'Escape') this.back();
        return;
      }
      if (ev.key === 'ArrowLeft' || ev.key === 'a') !ev.repeat && this.startCharge(-1);
      else if (ev.key === 'ArrowRight' || ev.key === 'd') !ev.repeat && this.startCharge(1);
      else if (ev.key === 'ArrowDown' || ev.key === 's') !ev.repeat && this.startCharge(0);
      else if (ev.key === ' ') this.tapBoost('dynamite');
      else if (ev.key >= '1' && ev.key <= '3') this.tapBoost(this.save.loadout[Number(ev.key) - 1]);
      else if (ev.key === 'Escape' || ev.key === 'p') this.pause();
    });
    window.addEventListener('keyup', (ev) => {
      if (['ArrowLeft', 'ArrowRight', 'ArrowDown', 'a', 'd', 's'].includes(ev.key)) this.releaseCharge();
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
    this.setCoach('none');
    $('hud').classList.add('hidden');
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

  notifyMissions(done: MissionDone[]): void {
    for (const d of done) {
      toast(`${icon('scroll', 28)}<span>${t('missionDone')}<br><small class="sub">${missionText(d.mission, fmt)}</small></span>`);
      sfx.chest();
    }
  }

  // ───────────────────────── power-ups ─────────────────────────

  /** HUD buttons for the run loadout (dynamite included); folds into one toggle. */
  private buildBoosts(): void {
    const host = $('boosts');
    const ids = this.save.loadout.filter((id) => id === 'dynamite' || this.isUnlocked('boosts'));
    const canFold = this.isUnlocked('boosts') && ids.length > 1;
    host.classList.toggle('hidden', ids.length === 0);
    host.classList.toggle('closed', canFold && !this.save.settings.boostsOpen);
    host.innerHTML =
      (canFold ? `<button class="btoggle" data-btoggle aria-label="power-ups">${icon('chevron', 26)}</button>` : '') +
      `<div class="blist">${ids
        .map((id) => `<button class="boost" data-boost="${id}" style="--c:${BOOST_COLOR[id]}" aria-label="${id}"><i class="bring"></i>${icon(BOOST_ICON[id], 40)}<span class="count">0</span></button>`)
        .join('')}</div>`;
    this.boostKey = '';
  }

  private updateBoosts(): void {
    const r = this.run;
    const ids = this.save.loadout;
    const key = ids.map((id) => `${r.boostCount(id)}:${Math.ceil(r.boostActive(id) * 4)}`).join();
    if (key === this.boostKey) return;
    this.boostKey = key;
    let total = 0;
    for (const id of ids) {
      const el = $('boosts').querySelector<HTMLElement>(`[data-boost=${id}]`);
      if (!el) continue;
      const n = r.boostCount(id);
      const active = r.boostActive(id);
      total += n;
      el.querySelector('.count')!.textContent = String(n);
      el.classList.toggle('empty', n === 0 && active <= 0);
      el.classList.toggle('active', active > 0);
      const time = BOOSTS[id].time ?? 1;
      el.style.setProperty('--p', active > 0 ? `${((active / time) * 100).toFixed(0)}%` : '0%');
    }
    const tg = $('boosts').querySelector<HTMLElement>('[data-btoggle]');
    if (tg) tg.dataset.n = String(total);
  }

  private tapBoost(id: BoostId | undefined): void {
    if (!id || this.mode !== 'play' || !this.save.loadout.includes(id)) return;
    if (this.run.useBoost(id)) {
      vibrate('medium');
      if (this.coachState === 'boosts') this.setCoach('none');
    } else sfx.error();
  }

  /** Toast a mission the moment this run completes it (paid at the end of the run). */
  private checkLiveMissions(): void {
    const r = this.run;
    if (r.init.tutorial || !this.save.missions.list.length) return;
    const metrics = runMetrics(r.result(), this.save.startDepth || 0);
    for (const m of missionsReachedLive(this.save, metrics)) {
      const k = `${m.scope}:${m.type}:${m.target}`;
      if (this.liveMissions.has(k)) continue;
      this.liveMissions.add(k);
      toast(`${icon('scroll', 28)}<span>${t('missionDone')}<br><small class="sub">${missionText(m, fmt)}</small></span>`);
      sfx.chest();
    }
  }
}
