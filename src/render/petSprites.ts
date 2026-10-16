/**
 * Pixel-art pets, 12×12, drawn from character maps (original art).
 * Legend per pet: '.' = empty, other chars map to colours.
 */
import type { PetId } from '../game/pets';

type Canvas = HTMLCanvasElement;

const ART: Record<PetId, { map: string[]; pal: Record<string, string> }> = {
  mole: {
    map: [
      '............',
      '....KKKK....',
      '...KMMMMK...',
      '..KMMMMMMK..',
      '..KMwMMwMK..',
      '..KMkMMkMK..',
      '.KMMMppMMMK.',
      '.KMMMppMMMK.',
      '.KMMMMMMMMK.',
      'KcKMMMMMMKcK',
      'KccKKKKKKccK',
      '.KK......KK.',
    ],
    pal: { K: '#2a1a12', M: '#7a5a44', w: '#ffffff', k: '#111111', p: '#ff8fa3', c: '#f2c6a0' },
  },
  cat: {
    map: [
      '.K........K.',
      'KoK......KoK',
      'KooKKKKKKooK',
      'KooooooooooK',
      'KoGkooooGkoK',
      'KoGGooooGGoK',
      'Kooooppoooo.',
      '.KoowwwwooK.',
      '..KoooooooK.',
      '..KoOoOoOoK.',
      '..KooooooKoK',
      '...KKKKKK.KK',
    ],
    pal: { K: '#3a1f0a', o: '#ffb347', O: '#e08a1f', G: '#7cff7a', k: '#111', p: '#ff6f91', w: '#fff3e0' },
  },
  turtle: {
    map: [
      '............',
      '....KKKK....',
      '...KsSSsK...',
      '..KSsSSsSK..',
      '.KsSSssSSsKK',
      '.KSSssssSSKgK',
      '.KsSSssSSsKgk',
      'KKKKKKKKKKgK',
      'KgK.KgK.KgK.',
      '.K...K...K..',
      '............',
      '............',
    ],
    pal: { K: '#16361b', S: '#5ec46a', s: '#3d8f48', g: '#9be37a', k: '#111' },
  },
  magpie: {
    map: [
      '............',
      '...KKKK.....',
      '..KbbbbK....',
      '.KbwkbbKK...',
      'KyybbbbbbK..',
      '.KKbbWWbbbK.',
      '...KbWWWbbbK',
      '...KbbWWbbbbK',
      '....KbbbbbKbK',
      '.....KKKKK.KK',
      '......y.y...',
      '............',
    ],
    pal: { K: '#0d1530', b: '#2d3a6e', W: '#ffffff', w: '#ffffff', k: '#111', y: '#ffd23f' },
  },
  fairy: {
    map: [
      '.aa......aa.',
      'aAAa....aAAa',
      'aAAAa..aAAAa',
      '.aAAaKKaAAa.',
      '..aaKffKaa..',
      '....KfkfK...',
      '....KffffK..',
      '.....KppK...',
      '....KpPPpK..',
      '....KpPPpK..',
      '.....KffK...',
      '......yy....',
    ],
    pal: { a: '#ffb3ec', A: '#ffe6fa', K: '#5a1a4a', f: '#ffe0c7', k: '#111', p: '#ff7ad9', P: '#ffb3ec', y: '#fff6a8' },
  },
  dragon: {
    map: [
      '.H.H........',
      'KRRRK.....KK',
      'KRkRRK...KWWK',
      'KRRRRRK.KWWK.',
      '.KyyRRRKRWK..',
      '..KKRRRRRRK..',
      '....KRRrrRRK.',
      '....KRrrrRRKK',
      '...KRRRrRRKRK',
      '...KRRKKRRK.K',
      '...KK...KK...',
      '............',
    ],
    pal: { K: '#3a0a06', R: '#ff5a3c', r: '#ffb347', k: '#ffd23f', y: '#ffe9a8', W: '#ff9a3c', H: '#e8e0d0' },
  },
};

/** A pet sprite, `scale` pixels per art pixel. */
export function makePet(id: PetId, scale = 1): Canvas {
  const art = ART[id];
  const c = document.createElement('canvas');
  c.width = c.height = 13 * scale;
  const ctx = c.getContext('2d')!;
  art.map.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const col = art.pal[row[x]];
      if (!col) continue;
      ctx.fillStyle = col;
      ctx.fillRect(x * scale, y * scale, scale, scale);
    }
  });
  return c;
}
