/**
 * Own SVG icon set: chunky outline + fill + highlight, identical on every device
 * (emoji differ between Android vendors). 32×32 grid.
 */
const O = '#1a1026';
const SW = 'stroke="' + O + '" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"';

const paths: Record<string, string> = {
  coin: `<circle cx="16" cy="16" r="12" fill="#ffc83d" ${SW}/><circle cx="16" cy="16" r="8" fill="#ffdc6b" stroke="#d99400" stroke-width="2"/><path d="M13 12h5M13 16h6M13 20h5" stroke="#c98a00" stroke-width="2" stroke-linecap="round"/><path d="M9 10a9 9 0 0 1 6-4" stroke="#fff6" stroke-width="2.4" fill="none" stroke-linecap="round"/>`,
  gem: `<path d="M8 6h16l5 7-13 15L3 13z" fill="#ff5fd2" ${SW}/><path d="M3 13h26M11 6l-3 7 8 15 8-15-3-7" fill="none" stroke="#b8169a" stroke-width="1.6"/><path d="M9 8l-3 4h5z" fill="#fff9"/>`,
  heart: `<path d="M16 28S3 20 3 11.5A6.5 6.5 0 0 1 16 8a6.5 6.5 0 0 1 13 3.5C29 20 16 28 16 28z" fill="#ff4d6a" ${SW}/><path d="M8 9a3 3 0 0 1 4 0" stroke="#fffa" stroke-width="2.4" fill="none" stroke-linecap="round"/>`,
  bomb: `<circle cx="14" cy="19" r="10" fill="#3b3550" ${SW}/><path d="M20 10l3-3" ${SW}/><path d="M24 4l1 2 2 1-2 1-1 2-1-2-2-1 2-1z" fill="#ffcc33" stroke="#ff6a00" stroke-width="1.2"/><path d="M8 16a6 6 0 0 1 4-4" stroke="#fff6" stroke-width="2.4" fill="none" stroke-linecap="round"/>`,
  gear: `<path d="M14 3h4l1 4 3 1 3-2 3 3-2 3 1 3 4 1v4l-4 1-1 3 2 3-3 3-3-2-3 1-1 4h-4l-1-4-3-1-3 2-3-3 2-3-1-3-4-1v-4l4-1 1-3-2-3 3-3 3 2 3-1z" fill="#b9b4cc" ${SW}/><circle cx="16" cy="16" r="4.5" fill="#5d5675" ${SW}/>`,
  pause: `<rect x="7" y="6" width="6" height="20" rx="2" fill="#fff" ${SW}/><rect x="19" y="6" width="6" height="20" rx="2" fill="#fff" ${SW}/>`,
  play: `<path d="M9 5l18 11L9 27z" fill="#fff" ${SW}/>`,
  back: `<path d="M20 5L9 16l11 11" fill="none" stroke="${O}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/><path d="M20 5L9 16l11 11" fill="none" stroke="#fff" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>`,
  close: `<path d="M8 8l16 16M24 8L8 24" stroke="${O}" stroke-width="7" stroke-linecap="round"/><path d="M8 8l16 16M24 8L8 24" stroke="#fff" stroke-width="3.4" stroke-linecap="round"/>`,
  shard: `<path d="M16 2l4 10 10 4-10 4-4 10-4-10-10-4 10-4z" fill="#b98cff" ${SW}/><path d="M16 7l2 6-2 2z" fill="#fffb"/>`,
  star: `<path d="M16 3l4 8.5 9 1.2-6.6 6.2 1.7 9L16 23.6 7.9 28l1.7-9L3 12.7l9-1.2z" fill="#ffd23f" ${SW}/><path d="M12 12l3-1" stroke="#fff9" stroke-width="2" stroke-linecap="round"/>`,
  trophy: `<path d="M9 4h14v7a7 7 0 0 1-14 0z" fill="#ffc83d" ${SW}/><path d="M9 7H4a5 5 0 0 0 6 6M23 7h5a5 5 0 0 1-6 6" fill="none" ${SW}/><path d="M14 18h4v5h-4z" fill="#e5a100" ${SW}/><rect x="9" y="23" width="14" height="5" rx="1.5" fill="#8a5a2b" ${SW}/><path d="M12 7v4" stroke="#fffa" stroke-width="2.4" stroke-linecap="round"/>`,
  lock: `<rect x="6" y="14" width="20" height="14" rx="3" fill="#ffc83d" ${SW}/><path d="M10 14v-4a6 6 0 0 1 12 0v4" fill="none" ${SW}/><circle cx="16" cy="21" r="2" fill="${O}"/>`,
  chest: `<path d="M4 14h24v13H4z" fill="#b5702f" ${SW}/><path d="M4 14a12 8 0 0 1 24 0z" fill="#d68a3d" ${SW}/><path d="M4 14h24" ${SW}/><rect x="13" y="12" width="6" height="7" rx="1.5" fill="#ffd23f" ${SW}/><path d="M8 18v6M24 18v6" stroke="#8a4f1d" stroke-width="2"/>`,
  scroll: `<path d="M8 4h16v22a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3v-2h5z" fill="#f4e3c1" ${SW}/><path d="M8 4a3 3 0 0 0-3 3v2h3" fill="#e2c98f" ${SW}/><path d="M12 11h8M12 16h8M12 21h5" stroke="#9c7b45" stroke-width="2.2" stroke-linecap="round"/>`,
  gift: `<rect x="4" y="12" width="24" height="16" rx="2" fill="#ff5f7e" ${SW}/><rect x="3" y="8" width="26" height="6" rx="2" fill="#ff7f97" ${SW}/><path d="M16 8v20" stroke="#ffd23f" stroke-width="4"/><path d="M16 8c-3-6-9-4-6 0M16 8c3-6 9-4 6 0" fill="none" ${SW}/>`,
  book: `<path d="M4 6c5-2 9-1 12 2v20c-3-3-7-4-12-2z" fill="#4fb3ff" ${SW}/><path d="M28 6c-5-2-9-1-12 2v20c3-3 7-4 12-2z" fill="#7cc8ff" ${SW}/><path d="M7 11c2-.5 4-.3 6 .8M7 15c2-.5 4-.3 6 .8" stroke="#fff9" stroke-width="1.8" stroke-linecap="round"/>`,
  pickaxe: `<path d="M5 9c6-6 16-6 22 0-6-2-16-2-22 0z" fill="#9ff3f0" ${SW}/><path d="M15 8l3 0-2 21h-2z" fill="#a8723a" ${SW}/>`,
  hammer: `<rect x="5" y="5" width="18" height="9" rx="2" fill="#b9b4cc" ${SW} transform="rotate(-30 14 9)"/><path d="M15 13l9 15" stroke="${O}" stroke-width="6" stroke-linecap="round"/><path d="M15 13l9 15" stroke="#a8723a" stroke-width="3" stroke-linecap="round"/>`,
  check: `<path d="M6 17l6 6 14-14" fill="none" stroke="${O}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/><path d="M6 17l6 6 14-14" fill="none" stroke="#5ee06f" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`,
  ad: `<rect x="3" y="7" width="26" height="18" rx="4" fill="#ffd23f" ${SW}/><path d="M13 11l8 5-8 5z" fill="${O}"/>`,
  bolt: `<path d="M18 3L6 18h8l-2 11 12-15h-8z" fill="#ffe14d" ${SW}/>`,
  clover: `<circle cx="11" cy="11" r="6" fill="#4cd964" ${SW}/><circle cx="21" cy="11" r="6" fill="#4cd964" ${SW}/><circle cx="11" cy="21" r="6" fill="#4cd964" ${SW}/><circle cx="21" cy="21" r="6" fill="#4cd964" ${SW}/><path d="M16 16l6 12" ${SW}/>`,
  crit: `<path d="M16 2l3 9 9-3-6 8 6 8-9-3-3 9-3-9-9 3 6-8-6-8 9 3z" fill="#ff5f7e" ${SW}/><circle cx="16" cy="16" r="3" fill="#fff"/>`,
  arrows: `<path d="M3 16l8-8v5h10V8l8 8-8 8v-5H11v5z" fill="#6ff3f0" ${SW}/>`,
  weight: `<path d="M9 10h14l4 18H5z" fill="#6d6880" ${SW}/><circle cx="16" cy="7" r="4" fill="none" ${SW}/><path d="M12 17h8" stroke="#fff6" stroke-width="2.4" stroke-linecap="round"/>`,
  fire: `<path d="M16 3c2 6 9 8 9 16a9 9 0 0 1-18 0c0-4 2-6 4-8 0 3 1 5 3 5-1-5 0-9 2-13z" fill="#ff8a1f" ${SW}/><path d="M16 15c1 3 4 4 4 8a4 4 0 0 1-8 0c0-2 1-3 2-4 .5 2 1.5 2 2 2-.5-2 0-4 0-6z" fill="#ffe14d"/>`,
  totem: `<rect x="8" y="3" width="16" height="26" rx="4" fill="#e8c35a" ${SW}/><circle cx="12.5" cy="12" r="2" fill="${O}"/><circle cx="19.5" cy="12" r="2" fill="${O}"/><path d="M12 20h8" ${SW}/><path d="M4 14l4-2v6zM28 14l-4-2v6z" fill="#5ee06f" ${SW}/>`,
  home: `<path d="M4 15L16 4l12 11v13H4z" fill="#ffd23f" ${SW}/><rect x="13" y="19" width="6" height="9" fill="#a8723a" ${SW}/>`,
  cart: `<path d="M4 10h24l-3 13H7z" fill="#a0a3b5" ${SW}/><circle cx="10" cy="26" r="3" fill="#3b3550" ${SW}/><circle cx="22" cy="26" r="3" fill="#3b3550" ${SW}/><path d="M8 10l3-5 4 4 5-5 3 6" fill="#ffc83d" ${SW}/>`,
  down: `<path d="M16 29L5 17h7V4h8v13h7z" fill="#6ff3f0" ${SW}/>`,
  sound: `<path d="M4 12h6l8-7v22l-8-7H4z" fill="#fff" ${SW}/><path d="M22 11a7 7 0 0 1 0 10M25 7a12 12 0 0 1 0 18" fill="none" ${SW}/>`,
  vibrate: `<rect x="10" y="4" width="12" height="24" rx="3" fill="#fff" ${SW}/><path d="M5 10v12M27 10v12" ${SW}/>`,
  globe: `<circle cx="16" cy="16" r="12" fill="#4fb3ff" ${SW}/><path d="M4 16h24M16 4c-6 7-6 17 0 24M16 4c6 7 6 17 0 24" fill="none" stroke="${O}" stroke-width="2"/>`,
  refresh: `<path d="M25 13A10 10 0 1 0 26 19" fill="none" stroke="${O}" stroke-width="6" stroke-linecap="round"/><path d="M25 13A10 10 0 1 0 26 19" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/><path d="M27 5v9h-9z" fill="#fff" ${SW}/>`,
  bag: `<path d="M6 11h20l-2 17H8z" fill="#b98cff" ${SW}/><path d="M11 11a5 5 0 0 1 10 0" fill="none" ${SW}/>`,
  shake: `<rect x="6" y="6" width="20" height="20" rx="3" fill="#fff" ${SW}/><path d="M2 12v8M30 12v8" ${SW}/>`,
  hand: `<path d="M12 4a2.5 2.5 0 0 1 5 0v9l7 1.5a3 3 0 0 1 2.3 3.4L25 26a4 4 0 0 1-4 3h-6a4 4 0 0 1-3.2-1.6L5.5 19a2.5 2.5 0 0 1 3.8-3.2L12 18z" fill="#fff" ${SW}/><path d="M17 13v5M21 14v4" stroke="#c9bfe0" stroke-width="2" stroke-linecap="round"/>`,
  giant: `<path d="M3 10c8-8 18-8 26 0-8-3-18-3-26 0z" fill="#ffd23f" ${SW}/><path d="M14 8h4l-1 21h-2z" fill="#a8723a" ${SW}/><path d="M5 20l-2 5 5-2M27 20l2 5-5-2" fill="none" stroke="${O}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`,
  twin: `<g opacity=".55"><path d="M2 12c5-5 12-5 17 0-5-2-12-2-17 0z" fill="#9ff3f0" ${SW}/><path d="M9 11h3l-1 15h-2z" fill="#a8723a" ${SW}/></g><path d="M13 9c5-5 12-5 17 0-5-2-12-2-17 0z" fill="#9ff3f0" ${SW}/><path d="M20 8h3l-1 21h-2z" fill="#a8723a" ${SW}/>`,
  teleport: `<ellipse cx="16" cy="9" rx="11" ry="4.5" fill="#c77dff" ${SW}/><ellipse cx="16" cy="9" rx="6" ry="2" fill="#2a1240"/><ellipse cx="16" cy="25" rx="11" ry="4.5" fill="#6ff3f0" ${SW}/><ellipse cx="16" cy="25" rx="6" ry="2" fill="#123a4a"/><path d="M16 12v9" stroke="#fff" stroke-width="3" stroke-dasharray="2 2.5" stroke-linecap="round"/>`,
  shield: `<path d="M16 3l11 4v8c0 7-5 12-11 14C10 27 5 22 5 15V7z" fill="#5ab0ff" ${SW}/><path d="M16 7l7 2.6V15c0 4.6-3 8-7 9.6z" fill="#8fd0ff"/><path d="M10 10v5" stroke="#fffa" stroke-width="2.4" stroke-linecap="round"/>`,
  chevron: `<path d="M8 20l8-8 8 8" fill="none" stroke="${O}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/><path d="M8 20l8-8 8 8" fill="none" stroke="#fff" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>`,
  sparkle: `<path d="M16 3l3 10 10 3-10 3-3 10-3-10-10-3 10-3z" fill="#fff6a8" ${SW}/>`,
};

export function icon(name: string, size = 24, cls = ''): string {
  return `<svg class="ico ${cls}" width="${size}" height="${size}" viewBox="0 0 32 32" aria-hidden="true">${paths[name] ?? paths.star}</svg>`;
}

export const UPGRADE_ICON: Record<string, string> = {
  durability: 'heart',
  power: 'hammer',
  fortune: 'coin',
  luck: 'clover',
  crit: 'crit',
  control: 'arrows',
  blast: 'bomb',
  weight: 'weight',
};

export const BOOST_ICON: Record<string, string> = { dynamite: 'bomb', giant: 'giant', twin: 'twin', teleport: 'teleport', shield: 'shield' };
