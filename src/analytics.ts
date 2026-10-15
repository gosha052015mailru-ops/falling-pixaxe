/**
 * Analytics facade. Gameplay code only calls track(); every event carries the
 * player's user properties (level, segment, days since install…).
 *
 * Sinks:
 *  - local journal (last 400 events in localStorage) — visible in Profile → "For developers";
 *  - HTTP batch sink when VITE_ANALYTICS_URL is set at build time (POST JSON, sendBeacon on background);
 *  - any SDK (Firebase, AppMetrica, GameAnalytics) via setAnalyticsSink().
 * Event names are snake_case funnels: tutorial_*, run_*, session_*, retention_dN,
 * level_up, purchase_*, ad_*, push_*, quest_claim…
 */
export type Params = Record<string, string | number | boolean>;

export interface Logged {
  name: string;
  params: Params;
  t: number;
  /** Session number at the time of the event. */
  s: number;
}

const LOG_KEY = 'falling-pickaxe-analytics';
const LOG_MAX = 400;
const BATCH_MS = 30_000;
const ENDPOINT: string = (import.meta.env?.VITE_ANALYTICS_URL as string | undefined) ?? '';
const APP_VERSION = '0.3.0';

let userProps: Params = {};
let session = 0;
let log: Logged[] = loadLog();
let outbox: Logged[] = [];
let sink: ((e: Logged, user: Params) => void) | null = null;
let batchTimer: ReturnType<typeof setInterval> | null = null;

function loadLog(): Logged[] {
  try {
    const raw = globalThis.localStorage?.getItem(LOG_KEY);
    return raw ? (JSON.parse(raw) as Logged[]) : [];
  } catch {
    return [];
  }
}

function saveLog(): void {
  try {
    globalThis.localStorage?.setItem(LOG_KEY, JSON.stringify(log.slice(-LOG_MAX)));
  } catch {
    /* storage full */
  }
}

export function setUserProps(props: Params, sessionN?: number): void {
  userProps = { ...props, app_version: APP_VERSION };
  if (sessionN !== undefined) session = sessionN;
}

export function setAnalyticsSink(fn: (e: Logged, user: Params) => void): void {
  sink = fn;
}

export function track(name: string, params: Params = {}): void {
  const e: Logged = { name, params, t: Date.now(), s: session };
  if (import.meta.env?.DEV) console.debug('[analytics]', name, params);
  log.push(e);
  if (log.length > LOG_MAX) log = log.slice(-LOG_MAX);
  if (ENDPOINT) outbox.push(e);
  try {
    sink?.(e, userProps);
  } catch {
    /* never let analytics break the game */
  }
}

/** Persist the journal and send the outbox (call on background / periodically). */
export function flush(): void {
  saveLog();
  if (!ENDPOINT || !outbox.length) return;
  const body = JSON.stringify({ user: userProps, events: outbox });
  outbox = [];
  try {
    const sent = navigator.sendBeacon?.(ENDPOINT, new Blob([body], { type: 'application/json' }));
    if (!sent) void fetch(ENDPOINT, { method: 'POST', body, headers: { 'content-type': 'application/json' }, keepalive: true }).catch(() => undefined);
  } catch {
    /* offline — events stay in the local journal */
  }
}

export function startAnalytics(): void {
  if (batchTimer) return;
  batchTimer = setInterval(flush, BATCH_MS);
}

export function analyticsLog(): readonly Logged[] {
  return log;
}

export function analyticsExport(): string {
  return JSON.stringify({ user: userProps, events: log }, null, 1);
}

/** Event counts by name, most frequent first (for the developer panel). */
export function eventCounts(): [string, number][] {
  const m = new Map<string, number>();
  for (const e of log) m.set(e.name, (m.get(e.name) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

export function installErrorReporting(): void {
  window.addEventListener('error', (ev) => track('error', { msg: String(ev.message).slice(0, 120), src: String(ev.filename ?? '').slice(-60), line: ev.lineno ?? 0 }));
  window.addEventListener('unhandledrejection', (ev) => track('error', { msg: String(ev.reason).slice(0, 120), src: 'promise', line: 0 }));
}
