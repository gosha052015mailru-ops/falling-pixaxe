import { BLOCKS, B, type BlockDef } from '../game/blocks';
import { TIERS } from '../game/config';
import { hash2 } from '../game/rng';

export const TEX = 16;

type Canvas = HTMLCanvasElement;

function canvas(w = TEX, h = TEX): [Canvas, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  return [c, ctx];
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function shade(hex: string, k: number): string {
  const [r, g, b] = hexToRgb(hex);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(k >= 0 ? v + (255 - v) * k : v * (1 + k))));
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}

function px(ctx: CanvasRenderingContext2D, x: number, y: number, color: string): void {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, 1, 1);
}

/** Speckled base fill shared by most blocks. */
function fillNoise(ctx: CanvasRenderingContext2D, base: string, accent: string, seed: number, density = 0.22): void {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, TEX, TEX);
  for (let y = 0; y < TEX; y++) {
    for (let x = 0; x < TEX; x++) {
      const h = hash2(x, y, seed);
      if (h < density) px(ctx, x, y, accent);
      else if (h > 0.93) px(ctx, x, y, shade(base, 0.12));
    }
  }
}

function bevel(ctx: CanvasRenderingContext2D, base: string): void {
  ctx.fillStyle = shade(base, 0.18);
  ctx.fillRect(0, 0, TEX, 1);
  ctx.fillRect(0, 0, 1, TEX);
  ctx.fillStyle = shade(base, -0.3);
  ctx.fillRect(0, TEX - 1, TEX, 1);
  ctx.fillRect(TEX - 1, 0, 1, TEX);
}

function drawOre(ctx: CanvasRenderingContext2D, def: BlockDef, gem: boolean): void {
  const [base, a, b = a] = def.colors;
  fillNoise(ctx, base, shade(base, -0.15), def.id * 13);
  const spots = [
    [3, 3], [10, 4], [5, 10], [11, 11], [7, 7],
  ];
  spots.forEach(([sx, sy], i) => {
    if (gem) {
      // diamond-shaped gems with a highlight
      px(ctx, sx + 1, sy, a);
      px(ctx, sx, sy + 1, a);
      px(ctx, sx + 1, sy + 1, b);
      px(ctx, sx + 2, sy + 1, a);
      px(ctx, sx + 1, sy + 2, b);
      px(ctx, sx + 1, sy, '#ffffff');
    } else {
      const shape = i % 2 === 0 ? [[0, 0], [1, 0], [0, 1], [1, 1], [2, 1]] : [[1, 0], [0, 1], [1, 1], [2, 1], [1, 2]];
      shape.forEach(([dx, dy], j) => px(ctx, sx + dx, sy + dy, j === 0 ? shade(a, 0.3) : j % 2 ? a : b));
    }
  });
}

function drawSpecial(ctx: CanvasRenderingContext2D, def: BlockDef): void {
  const [base, a, b = '#000'] = def.colors;
  switch (def.special) {
    case 'workbench': {
      fillNoise(ctx, base, shade(base, -0.15), 21, 0.15);
      ctx.fillStyle = a;
      ctx.fillRect(0, 0, TEX, 4);
      ctx.fillStyle = b;
      ctx.fillRect(0, 4, TEX, 1);
      // grid on top
      ctx.fillStyle = shade(a, -0.25);
      for (let i = 2; i < TEX; i += 4) ctx.fillRect(i, 0, 1, 4);
      // tools: saw + hammer
      ctx.fillStyle = '#c8c8d0';
      ctx.fillRect(2, 7, 5, 2);
      ctx.fillStyle = '#3d2814';
      ctx.fillRect(7, 7, 2, 2);
      ctx.fillStyle = '#9da0ad';
      ctx.fillRect(10, 6, 4, 2);
      ctx.fillStyle = '#6b4423';
      ctx.fillRect(11, 8, 1, 5);
      ctx.fillStyle = b;
      ctx.fillRect(1, 12, 2, 4);
      ctx.fillRect(13, 12, 2, 4);
      break;
    }
    case 'anvil': {
      ctx.fillStyle = '#2b2b33';
      ctx.fillRect(0, 0, TEX, TEX);
      ctx.fillStyle = a;
      ctx.fillRect(1, 3, 14, 3);
      ctx.fillRect(5, 6, 6, 4);
      ctx.fillRect(3, 10, 10, 3);
      ctx.fillStyle = shade(a, 0.35);
      ctx.fillRect(1, 3, 14, 1);
      ctx.fillStyle = base;
      ctx.fillRect(3, 12, 10, 1);
      ctx.fillRect(1, 5, 14, 1);
      break;
    }
    case 'tnt': {
      ctx.fillStyle = base;
      ctx.fillRect(0, 0, TEX, TEX);
      ctx.fillStyle = shade(base, -0.25);
      for (let x = 1; x < TEX; x += 3) ctx.fillRect(x, 0, 1, TEX);
      ctx.fillStyle = a;
      ctx.fillRect(0, 5, TEX, 7);
      ctx.fillStyle = b;
      // "TNT" in 3x5 pixel font
      const T = ['111', '010', '010', '010', '010'];
      const N = ['101', '111', '111', '111', '101'];
      [T, N, T].forEach((g, i) => g.forEach((row, ry) => [...row].forEach((c, rx) => c === '1' && px(ctx, 2 + i * 4 + rx, 6 + ry, b))));
      ctx.fillStyle = '#888';
      ctx.fillRect(7, 0, 2, 2);
      break;
    }
    case 'chest': {
      ctx.fillStyle = '#20140a';
      ctx.fillRect(0, 0, TEX, TEX);
      ctx.fillStyle = base;
      ctx.fillRect(1, 2, 14, 13);
      ctx.fillStyle = shade(base, 0.2);
      ctx.fillRect(1, 2, 14, 1);
      ctx.fillStyle = b;
      ctx.fillRect(1, 7, 14, 1);
      ctx.fillStyle = a;
      ctx.fillRect(7, 6, 2, 4);
      ctx.fillStyle = shade(a, 0.5);
      px(ctx, 7, 6, shade(a, 0.5));
      ctx.fillStyle = shade(base, -0.3);
      ctx.fillRect(1, 14, 14, 1);
      break;
    }
    case 'furnace': {
      fillNoise(ctx, base, shade(base, -0.2), 25, 0.2);
      bevel(ctx, base);
      ctx.fillStyle = b;
      ctx.fillRect(3, 8, 10, 6);
      ctx.fillStyle = a;
      ctx.fillRect(4, 11, 8, 3);
      ctx.fillStyle = '#ffe066';
      ctx.fillRect(6, 12, 4, 2);
      ctx.fillStyle = shade(base, -0.4);
      ctx.fillRect(3, 3, 10, 2);
      break;
    }
    case 'enchant': {
      ctx.fillStyle = base;
      ctx.fillRect(0, 0, TEX, TEX);
      ctx.fillStyle = b;
      ctx.fillRect(0, 0, TEX, 3);
      ctx.fillStyle = '#e8e0d0';
      ctx.fillRect(3, 4, 10, 6);
      ctx.fillStyle = '#7b2cbf';
      ctx.fillRect(8, 4, 1, 6);
      ctx.fillStyle = a;
      [[1, 12], [5, 13], [10, 12], [14, 13], [2, 1], [12, 1]].forEach(([x, y]) => px(ctx, x, y, a));
      ctx.fillStyle = shade(base, 0.2);
      ctx.fillRect(0, 15, TEX, 1);
      break;
    }
    case 'slime': {
      ctx.fillStyle = a;
      ctx.fillRect(0, 0, TEX, TEX);
      ctx.fillStyle = base;
      ctx.fillRect(1, 1, 14, 14);
      ctx.fillStyle = shade(base, -0.2);
      ctx.fillRect(4, 4, 8, 8);
      ctx.fillStyle = b;
      ctx.fillRect(5, 6, 2, 2);
      ctx.fillRect(9, 6, 2, 2);
      ctx.fillRect(7, 10, 2, 1);
      px(ctx, 2, 2, '#ffffff');
      px(ctx, 3, 2, '#ffffff');
      break;
    }
    case 'core': {
      const g = ctx.createRadialGradient(8, 8, 1, 8, 8, 11);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(0.4, base);
      g.addColorStop(1, a);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, TEX, TEX);
      break;
    }
    default:
      fillNoise(ctx, base, a, def.id);
  }
}

function drawGrass(ctx: CanvasRenderingContext2D, def: BlockDef): void {
  const [base, a, b = a] = def.colors;
  fillNoise(ctx, base, shade(base, -0.18), 1);
  for (let x = 0; x < TEX; x++) {
    const h = 3 + Math.floor(hash2(x, 0, 5) * 3);
    for (let y = 0; y < h; y++) px(ctx, x, y, y === h - 1 ? b : hash2(x, y, 9) > 0.7 ? shade(a, 0.15) : a);
  }
}

function drawBricks(ctx: CanvasRenderingContext2D, def: BlockDef): void {
  const [base, a] = def.colors;
  fillNoise(ctx, base, shade(base, 0.06), def.id * 7, 0.18);
  ctx.fillStyle = a;
  for (let row = 0; row < 4; row++) {
    ctx.fillRect(0, row * 4 + 3, TEX, 1);
    const off = row % 2 ? 4 : 0;
    for (let x = off; x < TEX; x += 8) ctx.fillRect(x, row * 4, 1, 3);
  }
}

function drawLava(ctx: CanvasRenderingContext2D, def: BlockDef, frame: number): void {
  const [base, a] = def.colors;
  for (let y = 0; y < TEX; y++) {
    for (let x = 0; x < TEX; x++) {
      const h = hash2(x + frame * 3, y + frame * 5, 77);
      px(ctx, x, y, h > 0.75 ? a : h < 0.15 ? shade(base, -0.25) : base);
    }
  }
}

export interface Textures {
  blocks: Canvas[];
  /** Darkened versions used as the cave back wall. */
  back: Canvas[];
  lava: Canvas[];
  cracks: Canvas[];
  pickaxes: Canvas[];
}

function makeBlock(def: BlockDef): Canvas {
  const [c, ctx] = canvas();
  switch (def.style) {
    case 'grass':
      drawGrass(ctx, def);
      break;
    case 'ore':
      drawOre(ctx, def, false);
      break;
    case 'gem':
      drawOre(ctx, def, true);
      break;
    case 'bricks':
      drawBricks(ctx, def);
      break;
    case 'special':
      drawSpecial(ctx, def);
      break;
    case 'liquid':
      drawLava(ctx, def, 0);
      break;
    default:
      fillNoise(ctx, def.colors[0], def.colors[1], def.id * 31);
      if (def.id === B.OBSIDIAN) {
        [[3, 4], [10, 9], [6, 12]].forEach(([x, y]) => px(ctx, x, y, '#a070ff'));
      }
  }
  if (def.style !== 'special' && def.style !== 'liquid' && def.style !== 'grass') bevel(ctx, def.colors[0]);
  return c;
}

function makeBack(src: Canvas): Canvas {
  const [c, ctx] = canvas();
  ctx.drawImage(src, 0, 0);
  ctx.fillStyle = 'rgba(8,6,14,0.68)';
  ctx.fillRect(0, 0, TEX, TEX);
  return c;
}

function makeCracks(stage: number): Canvas {
  const [c, ctx] = canvas();
  ctx.fillStyle = 'rgba(0,0,0,0.75)';
  const lines: number[][] = [
    [8, 8, 11, 5], [8, 8, 4, 10], [8, 8, 9, 13], [8, 8, 3, 4], [8, 8, 14, 11], [11, 5, 14, 2], [4, 10, 1, 13], [3, 4, 5, 1],
  ];
  const n = 2 + stage * 2;
  for (let i = 0; i < n && i < lines.length; i++) {
    const [x0, y0, x1, y1] = lines[i];
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    for (let s = 0; s <= steps; s++) {
      ctx.fillRect(Math.round(x0 + ((x1 - x0) * s) / steps), Math.round(y0 + ((y1 - y0) * s) / steps), 1, 1);
    }
  }
  return c;
}

const PICK = [
  '................',
  '....EHHHHHHE....',
  '..EHHHHHHHHHHE..',
  '.EHHHEESSEEHHHE.',
  'EHHE...SD...EHHE',
  'EHE....SD....EHE',
  'EE.....SD.....EE',
  'E......SD......E',
  '.......SD.......',
  '.......SD.......',
  '.......SD.......',
  '.......SD.......',
  '.......SD.......',
  '.......SD.......',
  '.......DD.......',
  '................',
];

export function makePickaxe(tier: number, scale = 1): Canvas {
  const t = TIERS[tier].colors;
  const [c, ctx] = canvas(TEX * scale, TEX * scale);
  const colors: Record<string, string> = {
    H: t.head,
    E: t.edge,
    S: t.handle,
    D: shade(t.handle, -0.35),
  };
  PICK.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      if (ch === '.') return;
      let col = colors[ch];
      if (ch === 'H' && y <= 2) col = shade(col, 0.3);
      ctx.fillStyle = col;
      ctx.fillRect(x * scale, y * scale, scale, scale);
    }),
  );
  return c;
}

export function buildTextures(): Textures {
  const blocks: Canvas[] = [];
  const back: Canvas[] = [];
  for (const def of BLOCKS) {
    if (!def) continue;
    blocks[def.id] = makeBlock(def);
    back[def.id] = makeBack(blocks[def.id]);
  }
  const lavaDef = BLOCKS[B.LAVA];
  const lava = [0, 1, 2, 3].map((f) => {
    const [c, ctx] = canvas();
    drawLava(ctx, lavaDef, f);
    return c;
  });
  return {
    blocks,
    back,
    lava,
    cracks: [0, 1, 2].map(makeCracks),
    pickaxes: TIERS.map((_, i) => makePickaxe(i)),
  };
}
