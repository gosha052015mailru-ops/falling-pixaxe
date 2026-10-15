/**
 * Analytics facade. Gameplay code only calls track(); the backend (Firebase,
 * GameAnalytics, AppMetrica…) is plugged in later by replacing `sink`.
 * Event names follow snake_case funnels: tutorial_*, run_*, level_up, purchase_*, ad_*.
 */
export type Params = Record<string, string | number | boolean>;

interface Logged {
  name: string;
  params: Params;
  t: number;
}

const MAX_QUEUE = 300;
const queue: Logged[] = [];
let sink: ((e: Logged) => void) | null = null;

export function setAnalyticsSink(fn: (e: Logged) => void): void {
  sink = fn;
  for (const e of queue.splice(0)) fn(e);
}

export function track(name: string, params: Params = {}): void {
  const e = { name, params, t: Date.now() };
  if (import.meta.env?.DEV) console.debug('[analytics]', name, params);
  if (sink) {
    try {
      sink(e);
    } catch {
      /* never let analytics break the game */
    }
    return;
  }
  queue.push(e);
  if (queue.length > MAX_QUEUE) queue.shift();
}

export function installErrorReporting(): void {
  window.addEventListener('error', (ev) => track('error', { msg: String(ev.message).slice(0, 120), src: String(ev.filename ?? '').slice(-60), line: ev.lineno ?? 0 }));
  window.addEventListener('unhandledrejection', (ev) => track('error', { msg: String(ev.reason).slice(0, 120), src: 'promise', line: 0 }));
}
