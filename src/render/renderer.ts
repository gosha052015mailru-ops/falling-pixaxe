import { B, blockDef } from '../game/blocks';
import { BIOMES, BOOSTS, BOOST_FX, WORLD_W, biomeAt, biomeIndex } from '../game/config';
import type { GameEvent, Run } from '../game/run';
import { blockHp } from '../game/world';
import { fmt } from '../ui/format';
import { t } from '../ui/i18n';
import { Particles } from './particles';
import { buildTextures, shade, type Textures } from './textures';

const WALL_VIS = 0.5;
/** The camera zooms out for a wider shaft, but never shows more than this many columns. */
const MAX_VIEW_COLS = 13;
const PICK_SIZE = 1.25;
const RAINBOW = ['#ff5f7e', '#ffd23f', '#5ee06f', '#6ff3f0', '#c77dff'];
const BOOST_FX_COLORS: Record<string, string[]> = {
  giant: ['#ffd23f', '#ffb020', '#fff'],
  twin: ['#6ff3f0', '#bffcff', '#fff'],
  teleport: ['#c77dff', '#6ff3f0', '#fff'],
  shield: ['#5ab0ff', '#bfe3ff', '#fff'],
};

export class Renderer {
  readonly ctx: CanvasRenderingContext2D;
  readonly tex: Textures;
  readonly fx = new Particles();
  scale = 40;
  viewH = 16;
  camY = -6;
  /** Left edge of the view in world columns. */
  camX = -WALL_VIS;
  private worldW = WORLD_W;
  private viewW = WORLD_W + WALL_VIS * 2;
  private shakeAmp = 0;
  private flash = 0;
  private flashColor = '#fff';
  private trail: { x: number; y: number }[] = [];
  private time = 0;
  private lastOhYes = -10;
  /** Seconds of the white dash streak left. */
  private dashGlow = 0;
  /** Smoothed visual size of the giant power-up (springs in and out). */
  private giantVis = 1;
  private giantVel = 0;
  /** Teleport portals: entry and exit swirl for a moment. */
  private portals: { x: number; y: number; life: number; color: string }[] = [];
  private beam: { x: number; y0: number; y1: number; life: number } | null = null;
  /** Settings / adaptive quality. */
  maxDpr = 3;
  shakeEnabled = true;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.tex = buildTextures();
    this.resize();
  }

  resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, this.maxDpr);
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.scale = this.canvas.width / this.viewW;
    this.viewH = this.canvas.height / this.scale;
  }

  reset(run: Run): void {
    this.worldW = run.world.width;
    this.pickScale = 1 + 0.22 * run.stats.pickSize;
    this.viewW = Math.min(MAX_VIEW_COLS, this.worldW + WALL_VIS * 2);
    this.resize();
    this.camX = this.targetCamX(run.x);
    this.fx.clear();
    this.trail = [];
    this.camY = run.y - this.viewH * 0.35;
    this.flash = 0;
    this.shakeAmp = 0;
    this.giantVis = 1;
    this.giantVel = 0;
    this.portals = [];
    this.beam = null;
  }

  shake(amount: number): void {
    if (!this.shakeEnabled) return;
    this.shakeAmp = Math.min(0.6, Math.max(this.shakeAmp, amount));
  }

  doFlash(color: string, strength = 0.6): void {
    this.flash = strength;
    this.flashColor = color;
  }

  /** Turn simulation events into particles, numbers, shake and flashes. */
  onEvent(e: GameEvent): void {
    const fx = this.fx;
    switch (e.t) {
      case 'hit': {
        const def = blockDef(e.id);
        fx.burst(e.x + 0.5, e.y + 0.5, [def.colors[0], def.colors[1], '#fff'], e.crit ? 10 : 4, 4, 0.1);
        this.shake(e.crit ? 0.12 : 0.04);
        if (e.crit) fx.text(e.x + 0.5, e.y, 'CRIT!', '#ff5577', 0.45);
        break;
      }
      case 'break': {
        const def = blockDef(e.id);
        const cols = [def.colors[0], def.colors[1], def.colors[2] ?? def.colors[1]];
        fx.burst(e.x + 0.5, e.y + 0.5, cols, def.ore ? 16 : 9, def.ore ? 7 : 5);
        if (e.coins >= 1 && (def.ore || e.coins >= 5)) {
          fx.text(e.x + 0.5, e.y + 0.3, '+' + fmt(e.coins), def.ore ? def.colors[1] : '#ffd23f', def.ore ? 0.55 : 0.42);
        }
        if (def.ore && def.value >= 50) {
          if (this.time - this.lastOhYes > 3) {
            this.lastOhYes = this.time;
            fx.text(e.x + 0.5, e.y - 0.6, 'OH YES!', '#ffffff', 0.6);
          }
          fx.burst(e.x + 0.5, e.y + 0.5, ['#fff', def.colors[1]], 10, 9, 0.08, 4, true);
          this.shake(0.15);
        } else this.shake(0.05);
        break;
      }
      case 'bounce':
        if (e.speed > 3) fx.burst(e.x, e.y, ['#999', '#ddd'], 2, 2, 0.07);
        break;
      case 'explode':
        fx.ring(e.x, e.y, e.r * 1.2, '#ffcf6a');
        fx.burst(e.x, e.y, ['#ffdd55', '#ff8800', '#ff3300', '#555'], 40, 12, 0.2, 10, true);
        this.shake(0.35 + Math.min(0.25, e.chain * 0.05));
        this.doFlash('#ffcc66', 0.35);
        if (e.chain >= 2) fx.text(e.x, e.y - 1, `×${e.chain + 1} CHAIN!`, '#ff8844', 0.7);
        break;
      case 'tierUp':
        this.doFlash('#ffffff', 0.85);
        this.shake(0.3);
        fx.ring(this.lastPickX, this.lastPickY, 3, '#ffffff');
        fx.burst(this.lastPickX, this.lastPickY, ['#fff', '#ffd23f', '#6ff3f0'], 50, 10, 0.15, 6, true);
        break;
      case 'heal':
        fx.burst(this.lastPickX, this.lastPickY, ['#5dff7a', '#b6ffbf'], 20, 5, 0.12, -4, true);
        fx.text(this.lastPickX, this.lastPickY - 1, `+${e.amount} ❤`, '#5dff7a', 0.55);
        break;
      case 'chest':
        fx.burst(e.x + 0.5, e.y + 0.5, ['#ffd23f', '#fff1a8', '#a8722f'], 30, 8, 0.14, 15, true);
        break;
      case 'furnace':
        this.doFlash('#ff8c1a', 0.3);
        break;
      case 'enchant':
        this.doFlash('#c77dff', 0.5);
        fx.burst(this.lastPickX, this.lastPickY, ['#c77dff', '#ff66d9', '#fff'], 35, 7, 0.12, -2, true);
        break;
      case 'gem':
        fx.burst(e.x + 0.5, e.y + 0.5, ['#ff66d9', '#fff'], 20, 6, 0.12, 5, true);
        fx.text(e.x + 0.5, e.y, '+1 💎', '#ff9de6', 0.55);
        break;
      case 'slime':
        fx.burst(e.x, e.y - 0.4, ['#9cff9c', '#6bd66b'], 8, 5, 0.14);
        this.shake(0.08);
        break;
      case 'lava':
        fx.burst(e.x, e.y, ['#ff5a00', '#ffb300', '#333'], 6, 3, 0.12, -6);
        this.doFlash('#ff3300', 0.15);
        break;
      case 'milestone':
        this.doFlash('#ffd23f', 0.6);
        break;
      case 'totem':
        this.doFlash('#ffe066', 0.9);
        fx.burst(this.lastPickX, this.lastPickY, ['#ffe066', '#5dff7a', '#fff'], 60, 10, 0.15, 3, true);
        break;
      case 'shatter': {
        fx.burst(e.x, e.y, ['#fff', '#aaa', '#6b4423'], 40, 9, 0.16, 20);
        this.shake(0.45);
        this.doFlash('#ff3344', 0.4);
        break;
      }
      case 'core':
        this.doFlash('#ffffff', 1);
        fx.burst(this.lastPickX, this.lastPickY, ['#fff2a8', '#ff7ad9', '#6ff3f0'], 120, 14, 0.2, 2, true);
        break;
      case 'fever':
        this.doFlash('#ffffff', 0.4);
        fx.ring(this.lastPickX, this.lastPickY, 2.5, '#ff7ad9');
        fx.burst(this.lastPickX, this.lastPickY, RAINBOW, 40, 9, 0.14, 4, true);
        break;
      case 'event':
        this.doFlash('#c77dff', 0.5);
        fx.ring(this.lastPickX, this.lastPickY, 3, '#e0b3ff');
        fx.burst(this.lastPickX, this.lastPickY, ['#c77dff', '#ffd23f', '#ffffff'], 45, 9, 0.14, 3, true);
        break;
      case 'revive':
        this.doFlash('#5dff7a', 0.8);
        fx.burst(this.lastPickX, this.lastPickY, ['#5dff7a', '#fff', '#ffe066'], 60, 10, 0.15, 3, true);
        break;
      case 'dash':
        this.shake(0.08 + 0.2 * e.power);
        fx.burst(this.lastPickX - e.dir * 0.6, this.lastPickY - 0.4, ['#ffffff', '#6ff3f0'], 8 + Math.round(16 * e.power), 6, 0.12, 0, true);
        this.dashGlow = 0.25 + 0.4 * e.power;
        break;
      case 'dashEnd':
        if (e.broken >= 3) fx.text(this.lastPickX, this.lastPickY - 1, `${t('breakthrough')} ×${e.broken}!`, '#6ff3f0', 0.6);
        break;
      case 'boost': {
        if (e.id === 'dynamite') break;
        const c = BOOST_FX_COLORS[e.id];
        this.doFlash(c[0], 0.35);
        fx.ring(e.x, e.y, 2.2, c[0]);
        fx.ring(e.x, e.y, 3.4, c[1]);
        fx.burst(e.x, e.y, c, 40, 9, 0.14, 2, true);
        if (e.id === 'giant') {
          this.shake(0.35);
          this.giantVel = 6;
        }
        break;
      }
      case 'teleport':
        this.portals.push({ x: e.x0, y: e.y0, life: 0.9, color: '#c77dff' }, { x: e.x, y: e.y, life: 1.1, color: '#6ff3f0' });
        this.beam = { x: e.x, y0: e.y0, y1: e.y, life: 0.35 };
        this.doFlash('#c77dff', 0.45);
        this.trail = [];
        fx.burst(e.x0, e.y0, ['#c77dff', '#fff'], 30, 7, 0.13, 0, true);
        fx.burst(e.x, e.y, ['#6ff3f0', '#fff'], 40, 9, 0.14, 0, true);
        fx.text(e.x, e.y - 1.2, `+${e.dist} m`, '#6ff3f0', 0.6);
        this.shake(0.3);
        // snap the camera so the arrival is visible at once
        this.camY = e.y - this.viewH * 0.36;
        break;
      case 'boostEnd':
        fx.burst(this.lastPickX, this.lastPickY, BOOST_FX_COLORS[e.id] ?? ['#fff'], 16, 5, 0.12, 0, true);
        break;
      case 'twinPoof':
        fx.burst(e.x, e.y, ['#6ff3f0', '#bffcff', '#fff'], 18, 6, 0.12, 0, true);
        fx.ring(e.x, e.y, 1.2, '#bffcff');
        break;
      case 'nudge':
        fx.burst(this.lastPickX - e.dir * 0.5, this.lastPickY, ['rgba(255,255,255,0.8)'], 5, 3, 0.1, 0);
        break;
      default:
        break;
    }
  }

  private lastPickX = 4.5;
  private lastPickY = 0;

  /** Follow the pickaxe horizontally when the shaft is wider than the view. */
  private targetCamX(x: number): number {
    const min = -WALL_VIS;
    const max = this.worldW + WALL_VIS - this.viewW;
    return max <= min ? (this.worldW - this.viewW) / 2 : Math.max(min, Math.min(max, x - this.viewW / 2));
  }

  update(run: Run, dt: number): void {
    this.time += dt;
    this.camX += (this.targetCamX(run.x) - this.camX) * Math.min(1, dt * 4);
    this.lastPickX = run.x;
    this.lastPickY = run.y;
    const target = run.y - this.viewH * 0.36 + Math.max(0, run.vy) * 0.25;
    this.camY += (target - this.camY) * Math.min(1, dt * 6);
    this.shakeAmp *= Math.exp(-dt * 9);
    this.flash = Math.max(0, this.flash - dt * 2.2);
    this.dashGlow = Math.max(0, this.dashGlow - dt);
    // giant: a springy grow / shrink with a little overshoot
    const giantTarget = run.giantTimer > 0 ? BOOST_FX.giantRadius * 1.15 : 1;
    this.giantVel += ((giantTarget - this.giantVis) * 90 - this.giantVel * 11) * dt;
    this.giantVis += this.giantVel * dt;
    for (const p of this.portals) p.life -= dt;
    this.portals = this.portals.filter((p) => p.life > 0);
    if (this.beam && (this.beam.life -= dt) <= 0) this.beam = null;
    if (run.twinTimer > 0) for (const g of run.twins) if (Math.random() < 0.35) this.fx.burst(g.x, g.y, ['#6ff3f0', '#bffcff'], 1, 1.5, 0.1, 0, true);
    if (run.giantTimer > 0 && Math.random() < 0.4) this.fx.burst(run.x, run.y, ['#ffd23f', '#fff'], 1, 3, 0.12, 0, true);
    this.fx.update(dt);
    const speed = Math.hypot(run.vx, run.vy);
    this.trail.push({ x: run.x, y: run.y });
    if (this.trail.length > (this.dashGlow > 0 ? 12 : speed > 9 ? 8 : 3)) this.trail.shift();
  }

  draw(run: Run): void {
    const { ctx, scale: s, tex } = this;
    const W = this.canvas.width;
    const H = this.canvas.height;
    ctx.imageSmoothingEnabled = false;

    const sx = (Math.random() - 0.5) * this.shakeAmp * 2;
    const sy = (Math.random() - 0.5) * this.shakeAmp * 2;
    const camY = this.camY + sy;
    const camX = this.camX + sx;
    const toX = (x: number) => (x - camX) * s;
    const toY = (y: number) => (y - camY) * s;

    // background
    const biome = biomeAt(Math.max(0, Math.floor(run.y)));
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, biome.bg[0]);
    g.addColorStop(1, biome.bg[1]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    const y0 = Math.floor(camY) - 1;
    const y1 = Math.ceil(camY + this.viewH) + 1;
    const world = run.world;
    const sz = Math.ceil(s) + 1;
    const lavaFrame = tex.lava[Math.floor(this.time * 4) % tex.lava.length];

    for (let y = y0; y <= y1; y++) {
      const py = Math.floor(toY(y));
      if (y < 0) {
        // daylight sky above the surface, fading into the dark at the top
        const k = Math.max(0, 1 + y / 14);
        ctx.fillStyle = `rgb(${Math.round(40 + 70 * k)},${Math.round(60 + 120 * k)},${Math.round(110 + 130 * k)})`;
        ctx.fillRect(0, py, W, sz);
        continue;
      }
      const backId = BIOMES[biomeIndex(y)].base[0].item;
      const xa = Math.max(-1, Math.floor(camX) - 1);
      const xb = Math.min(this.worldW, Math.ceil(camX + this.viewW) + 1);
      for (let x = xa; x <= xb; x++) {
        const pxX = Math.floor(toX(x));
        const id = world.get(x, y);
        if (world.isWall(x)) {
          ctx.drawImage(tex.blocks[B.BEDROCK], pxX, py, sz, sz);
          continue;
        }
        if (id === B.AIR) {
          ctx.drawImage(tex.back[backId], pxX, py, sz, sz);
          continue;
        }
        if (id === B.LAVA) {
          ctx.drawImage(lavaFrame, pxX, py, sz, sz);
          continue;
        }
        ctx.drawImage(tex.blocks[id], pxX, py, sz, sz);
        const def = blockDef(id);
        if (Number.isFinite(def.hp) && !def.special) {
          const frac = world.hpAt(x, y) / blockHp(id, y);
          if (frac < 0.999) {
            const stage = frac > 0.66 ? 0 : frac > 0.33 ? 1 : 2;
            ctx.drawImage(tex.cracks[stage], pxX, py, sz, sz);
          }
        } else if (def.special && def.special !== 'slime') {
          // pulsing outline so the eye finds special blocks
          const a = 0.35 + 0.35 * Math.sin(this.time * 5 + x + y);
          ctx.strokeStyle = shade(def.colors[1], 0.3).replace('rgb', 'rgba').replace(')', `,${a})`);
          ctx.lineWidth = Math.max(2, s * 0.06);
          ctx.strokeRect(pxX + 1, py + 1, sz - 3, sz - 3);
        }
      }
    }

    // teleport portals and the light beam between them
    for (const p of this.portals) this.drawPortal(toX(p.x), toY(p.y), p.life, p.color, s);
    if (this.beam) {
      const a = this.beam.life / 0.35;
      const bx = toX(this.beam.x);
      const gr = ctx.createLinearGradient(bx - s * 0.5, 0, bx + s * 0.5, 0);
      gr.addColorStop(0, 'rgba(199,125,255,0)');
      gr.addColorStop(0.5, `rgba(255,255,255,${0.85 * a})`);
      gr.addColorStop(1, 'rgba(111,243,240,0)');
      ctx.fillStyle = gr;
      const ya = toY(this.beam.y0);
      ctx.fillRect(bx - s * 0.5, ya, s, toY(this.beam.y1) - ya);
    }

    // pickaxe + motion trail
    const pick = tex.pickaxes[run.tier];
    if (!run.over || run.core) {
      // ghost twins: translucent, cyan-glowing copies
      if (run.twinTimer > 0) {
        for (const g of run.twins) {
          const fade = Math.min(1, g.life / 0.5);
          const gx = toX(g.x);
          const gy = toY(g.y);
          const gr = ctx.createRadialGradient(gx, gy, 0, gx, gy, s * 1.1);
          gr.addColorStop(0, `rgba(111,243,240,${0.45 * fade})`);
          gr.addColorStop(1, 'rgba(111,243,240,0)');
          ctx.fillStyle = gr;
          ctx.fillRect(gx - s * 1.2, gy - s * 1.2, s * 2.4, s * 2.4);
          ctx.globalAlpha = 0.55 * fade;
          this.drawPick(pick, gx, gy, g.angle, s, 0.85);
          ctx.globalAlpha = 1;
        }
      }
      const gv = Math.max(0.5, this.giantVis);
      if (run.giantTimer > 0 || gv > 1.05) {
        // golden aura; it blinks in the last 1.5 s
        const blink = run.giantTimer > 0 && run.giantTimer < 1.5 && Math.floor(this.time * 8) % 2 === 0;
        const r0 = s * 1.3 * gv;
        const gr = ctx.createRadialGradient(toX(run.x), toY(run.y), 0, toX(run.x), toY(run.y), r0);
        gr.addColorStop(0, `rgba(255,210,63,${blink ? 0.15 : 0.5})`);
        gr.addColorStop(1, 'rgba(255,176,32,0)');
        ctx.fillStyle = gr;
        ctx.fillRect(toX(run.x) - r0, toY(run.y) - r0, r0 * 2, r0 * 2);
      }
      for (let i = 0; i < this.trail.length - 1; i++) {
        const t = this.trail[i];
        ctx.globalAlpha = ((i + 1) / this.trail.length) * 0.25;
        this.drawPick(pick, toX(t.x), toY(t.y), run.angle - (this.trail.length - i) * 0.05, s, this.giantVis);
      }
      ctx.globalAlpha = 1;
      if (run.fever) {
        const hue = (this.time * 360) % 360;
        const gr = ctx.createRadialGradient(toX(run.x), toY(run.y), 0, toX(run.x), toY(run.y), s * 1.4);
        gr.addColorStop(0, `hsla(${hue},100%,70%,0.75)`);
        gr.addColorStop(1, `hsla(${hue},100%,60%,0)`);
        ctx.fillStyle = gr;
        ctx.fillRect(toX(run.x) - s * 1.5, toY(run.y) - s * 1.5, s * 3, s * 3);
        if (Math.random() < 0.6) this.fx.burst(run.x, run.y, RAINBOW, 1, 2, 0.12, 0, true);
      }
      this.drawPick(pick, toX(run.x), toY(run.y), run.angle, s, gv);
      if (run.shieldTimer > 0) this.drawShield(toX(run.x), toY(run.y), run.shieldTimer, s * PICK_SIZE * this.pickScale * gv * 0.62);
    }

    // particles
    for (const p of this.fx.parts) {
      ctx.globalAlpha = Math.min(1, p.life / p.max + 0.2);
      ctx.fillStyle = p.color;
      const ps = Math.max(2, p.size * s);
      ctx.fillRect(toX(p.x) - ps / 2, toY(p.y) - ps / 2, ps, ps);
    }
    ctx.globalAlpha = 1;
    for (const r of this.fx.rings) {
      const k = 1 - r.life / r.max;
      ctx.strokeStyle = r.color;
      ctx.globalAlpha = 1 - k;
      ctx.lineWidth = s * 0.25 * (1 - k) + 1;
      ctx.beginPath();
      ctx.arc(toX(r.x), toY(r.y), r.r * s * (0.3 + k), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // darkness grows with depth; the pickaxe carries a light
    const bi = biomeIndex(Math.max(0, Math.floor(run.y)));
    const dark = [0.0, 0.25, 0.4, 0.3, 0.45, 0.6][bi] ?? 0.6;
    if (dark > 0) {
      const lx = toX(run.x);
      const ly = toY(run.y);
      const rg = ctx.createRadialGradient(lx, ly, s * 1.5, lx, ly, s * 7);
      rg.addColorStop(0, 'rgba(0,0,0,0)');
      rg.addColorStop(1, `rgba(0,0,0,${dark})`);
      ctx.fillStyle = rg;
      ctx.fillRect(0, 0, W, H);
    }

    // floating texts on top of the darkness
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const t of this.fx.texts) {
      const a = Math.min(1, (t.life / t.max) * 2);
      ctx.globalAlpha = a;
      const size = Math.round(t.size * s);
      ctx.font = `900 ${size}px Rubik, sans-serif`;
      ctx.lineWidth = Math.max(3, size * 0.32);
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#170f24';
      ctx.strokeText(t.text, toX(t.x), toY(t.y));
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, toX(t.x), toY(t.y));
    }
    ctx.globalAlpha = 1;

    if (this.flash > 0) {
      ctx.globalAlpha = Math.min(1, this.flash);
      ctx.fillStyle = this.flashColor;
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    }
  }

  /** Visual size grows with the pickaxe-size upgrade. */
  pickScale = 1;

  /** Bubble with a moving shimmer; blinks when it is about to pop. */
  private drawShield(x: number, y: number, left: number, r: number): void {
    const ctx = this.ctx;
    if (left < 1.5 && Math.floor(this.time * 10) % 2 === 0) return;
    const total = BOOSTS.shield.time ?? 8;
    const wob = 1 + 0.04 * Math.sin(this.time * 9);
    const R = r * wob;
    const gr = ctx.createRadialGradient(x - R * 0.3, y - R * 0.35, R * 0.1, x, y, R);
    gr.addColorStop(0, 'rgba(255,255,255,0.35)');
    gr.addColorStop(0.7, 'rgba(90,176,255,0.12)');
    gr.addColorStop(1, 'rgba(90,176,255,0.45)');
    ctx.fillStyle = gr;
    ctx.beginPath();
    ctx.arc(x, y, R, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = Math.max(2, R * 0.08);
    ctx.strokeStyle = 'rgba(191,227,255,0.9)';
    ctx.stroke();
    // a bright arc runs around the bubble; it shrinks as time runs out
    const a0 = this.time * 4;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.max(2, R * 0.12);
    ctx.beginPath();
    ctx.arc(x, y, R, a0, a0 + Math.PI * 2 * Math.max(0.08, left / total));
    ctx.stroke();
  }

  private drawPortal(x: number, y: number, life: number, color: string, s: number): void {
    const ctx = this.ctx;
    const k = Math.min(1, life / 0.4);
    ctx.save();
    ctx.translate(x, y);
    for (let i = 0; i < 3; i++) {
      ctx.globalAlpha = k * (0.9 - i * 0.25);
      ctx.strokeStyle = i === 1 ? '#ffffff' : color;
      ctx.lineWidth = Math.max(2, s * (0.16 - i * 0.03));
      ctx.beginPath();
      const rx = s * (0.95 + i * 0.35) * (0.6 + 0.4 * k);
      ctx.ellipse(0, 0, rx, rx * 0.38, 0, this.time * (6 + i * 3), this.time * (6 + i * 3) + Math.PI * 1.5);
      ctx.stroke();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  private drawPick(img: HTMLCanvasElement, x: number, y: number, angle: number, s: number, mult = 1): void {
    const size = PICK_SIZE * this.pickScale * s * mult;
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.drawImage(img, -size / 2, -size / 2, size, size);
    ctx.restore();
  }
}

