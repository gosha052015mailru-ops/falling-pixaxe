export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: string;
  gravity: number;
  glow?: boolean;
}

export interface FloatText {
  x: number;
  y: number;
  vy: number;
  life: number;
  max: number;
  text: string;
  color: string;
  size: number;
}

export interface Ring {
  x: number;
  y: number;
  r: number;
  life: number;
  max: number;
  color: string;
}

const MAX_PARTICLES = 700;

/** World-space particle system (units = blocks). */
export class Particles {
  parts: Particle[] = [];
  texts: FloatText[] = [];
  rings: Ring[] = [];
  /** Particle count multiplier (settings: high = 1, low = 0.35). */
  density = 1;

  burst(x: number, y: number, colors: string[], n: number, speed = 6, size = 0.14, gravity = 25, glow = false): void {
    n = Math.max(1, Math.round(n * this.density));
    for (let i = 0; i < n; i++) {
      if (this.parts.length >= MAX_PARTICLES) this.parts.shift();
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.3 + Math.random() * 0.9);
      const life = 0.35 + Math.random() * 0.5;
      this.parts.push({
        x: x + (Math.random() - 0.5) * 0.6,
        y: y + (Math.random() - 0.5) * 0.6,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s - speed * 0.4,
        life,
        max: life,
        size: size * (0.6 + Math.random() * 0.8),
        color: colors[i % colors.length],
        gravity,
        glow,
      });
    }
  }

  text(x: number, y: number, text: string, color = '#ffd23f', size = 0.5): void {
    if (this.texts.length > 40) this.texts.shift();
    this.texts.push({ x, y, vy: -2.2, life: 0.9, max: 0.9, text, color, size });
  }

  ring(x: number, y: number, r: number, color = '#ffd27a'): void {
    this.rings.push({ x, y, r, life: 0.35, max: 0.35, color });
  }

  update(dt: number): void {
    for (const p of this.parts) {
      p.vy += p.gravity * dt;
      p.vx *= 1 - 1.5 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
    }
    this.parts = this.parts.filter((p) => p.life > 0);
    for (const t of this.texts) {
      t.y += t.vy * dt;
      t.vy *= 1 - 2 * dt;
      t.life -= dt;
    }
    this.texts = this.texts.filter((t) => t.life > 0);
    for (const r of this.rings) r.life -= dt;
    this.rings = this.rings.filter((r) => r.life > 0);
  }

  clear(): void {
    this.parts = [];
    this.texts = [];
    this.rings = [];
  }
}
