import type { Reward } from '../game/meta';
import { fmt } from './format';
import { icon } from './icons';

export const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

/** Short-lived notification at the top of the screen. */
export function toast(html: string): void {
  const host = $('toasts');
  while (host.children.length >= 3) host.firstElementChild?.remove();
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = html;
  host.appendChild(el);
  setTimeout(() => el.remove(), 2700);
}

export function openModal(html: string): HTMLElement {
  const host = $('modal');
  host.innerHTML = html;
  return host;
}

export function closeModal(): void {
  $('modal').innerHTML = '';
}

export function modalOpen(): boolean {
  return $('modal').childElementCount > 0;
}

/** Reward tiles; each pops in with a small stagger. */
export function rewardTiles(r: Reward, labels: { totem: string; dynamite: string }): string {
  const items: string[] = [];
  const tile = (ic: string, txt: string) =>
    `<div class="reward" style="animation-delay:${items.length * 0.12}s">${icon(ic, 40)}<span>${txt}</span></div>`;
  if (r.coins) items.push(tile('coin', fmt(r.coins)));
  if (r.gems) items.push(tile('gem', '+' + r.gems));
  if (r.dynamite) items.push(tile('bomb', '+' + r.dynamite));
  if (r.totems) items.push(tile('totem', '+' + r.totems));
  void labels;
  return `<div class="rewards">${items.join('')}</div>`;
}

export function bar(frac: number, cls = '', label = ''): string {
  const p = Math.max(0, Math.min(1, frac)) * 100;
  return `<div class="bar ${cls}"><i style="--p:${p.toFixed(1)}%"></i>${label ? `<span>${label}</span>` : ''}</div>`;
}

export function hms(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}

export function msToMidnight(now: number): number {
  const d = new Date(now);
  d.setHours(24, 0, 0, 0);
  return d.getTime() - now;
}
