/**
 * Player-level analytics (pure, no DOM): sessions, active days, retention,
 * run history, monetization signals, segment and churn risk.
 * Feeds both the in-game "Profile" screen and analytics user properties.
 */
import { dayKey } from './time';
import type { RunResult } from './run';
import type { SaveData } from './save';

const DAY = 86400_000;
export const RETENTION_DAYS = [1, 2, 3, 7, 14, 30];
const HISTORY = 50;

export interface RunRecord {
  d: number;
  c: number;
  t: number;
  at: number;
}

export interface Profile {
  id: string;
  installAt: number;
  sessions: number;
  playSec: number;
  runSec: number;
  activeDays: string[];
  adsOffered: number;
  adsWatched: number;
  gemsSpent: number;
  coinsSpent: number;
  revives: number;
  quits: number;
  pushOpens: number;
  history: RunRecord[];
  retentionSent: number[];
}

function randomId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c?.randomUUID) return c.randomUUID();
  return 'p-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function freshProfile(now = Date.now()): Profile {
  return {
    id: randomId(),
    installAt: now,
    sessions: 0,
    playSec: 0,
    runSec: 0,
    activeDays: [],
    adsOffered: 0,
    adsWatched: 0,
    gemsSpent: 0,
    coinsSpent: 0,
    revives: 0,
    quits: 0,
    pushOpens: 0,
    history: [],
    retentionSent: [],
  };
}

export function daysSinceInstall(p: Profile, now: number): number {
  const a = new Date(p.installAt);
  a.setHours(0, 0, 0, 0);
  const b = new Date(now);
  b.setHours(0, 0, 0, 0);
  return Math.round((b.getTime() - a.getTime()) / DAY);
}

export interface SessionStart {
  session: number;
  day: number;
  newActiveDay: boolean;
  /** Retention milestone reached today (D1, D7…), reported once. */
  retention: number | null;
}

export function startSession(save: SaveData, now: number): SessionStart {
  const p = save.profile;
  p.sessions++;
  const key = dayKey(now);
  const newActiveDay = !p.activeDays.includes(key);
  if (newActiveDay) {
    p.activeDays.push(key);
    if (p.activeDays.length > 120) p.activeDays.shift();
  }
  const day = daysSinceInstall(p, now);
  let retention: number | null = null;
  if (RETENTION_DAYS.includes(day) && !p.retentionSent.includes(day)) {
    p.retentionSent.push(day);
    retention = day;
  }
  return { session: p.sessions, day, newActiveDay, retention };
}

export function addPlayTime(save: SaveData, sec: number): void {
  if (sec > 0 && sec < 6 * 3600) save.profile.playSec += sec;
}

export function recordRun(save: SaveData, r: RunResult, now: number): void {
  const p = save.profile;
  p.runSec += r.time;
  p.history.push({ d: r.depth, c: r.totalCoins, t: Math.round(r.time), at: now });
  if (p.history.length > HISTORY) p.history.shift();
}

export type Segment = 'new' | 'casual' | 'regular' | 'core';
export type ChurnRisk = 'low' | 'medium' | 'high';

export interface PlayerMetrics {
  daysSinceInstall: number;
  activeDays: number;
  activeLast7: number;
  sessions: number;
  avgSessionMin: number;
  playHours: number;
  runs: number;
  avgRunSec: number;
  avgDepth: number;
  medianDepth: number;
  avgCoins: number;
  bestDepth: number;
  /** Change of average depth: last 10 runs vs the 10 before (%, null if not enough runs). */
  depthTrend: number | null;
  adWatchRate: number;
  revives: number;
  quitRate: number;
  retained: Record<number, boolean>;
  segment: Segment;
  churnRisk: ChurnRisk;
}

function avg(a: number[]): number {
  return a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
}

function median(a: number[]): number {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** `liveSec` = time in the current, not yet accounted foreground stretch. */
export function playerMetrics(save: SaveData, now: number, liveSec = 0): PlayerMetrics {
  const p = save.profile;
  const playSec = p.playSec + Math.max(0, liveSec);
  const h = p.history;
  const days = daysSinceInstall(p, now);
  const last7 = new Set(Array.from({ length: 7 }, (_, i) => dayKey(now - i * DAY)));
  const activeLast7 = p.activeDays.filter((d) => last7.has(d)).length;
  const depths = h.map((r) => r.d);
  let depthTrend: number | null = null;
  if (h.length >= 20) {
    const a = avg(depths.slice(-20, -10));
    const b = avg(depths.slice(-10));
    depthTrend = a > 0 ? Math.round(((b - a) / a) * 100) : null;
  }
  const installDay = new Date(p.installAt);
  const retained: Record<number, boolean> = {};
  for (const d of RETENTION_DAYS) {
    const k = new Date(installDay);
    k.setDate(k.getDate() + d);
    retained[d] = p.activeDays.includes(dayKey(k.getTime()));
  }
  const playHours = playSec / 3600;
  let segment: Segment = 'new';
  if (days >= 1 || save.runs >= 10) {
    segment = activeLast7 >= 5 && playHours >= 3 ? 'core' : activeLast7 >= 3 ? 'regular' : 'casual';
  }
  const lastActive = p.activeDays.length ? new Date(p.activeDays[p.activeDays.length - 1]).getTime() : now;
  const idleDays = Math.max(0, Math.round((now - lastActive) / DAY));
  let churnRisk: ChurnRisk = 'low';
  if (idleDays >= 3 || (depthTrend !== null && depthTrend < -30 && activeLast7 <= 2)) churnRisk = 'high';
  else if (activeLast7 <= 1 && days >= 3) churnRisk = 'medium';
  return {
    daysSinceInstall: days,
    activeDays: p.activeDays.length,
    activeLast7,
    sessions: p.sessions,
    avgSessionMin: p.sessions ? playSec / p.sessions / 60 : 0,
    playHours,
    runs: save.runs,
    avgRunSec: save.runs ? p.runSec / save.runs : 0,
    avgDepth: avg(depths),
    medianDepth: median(depths),
    avgCoins: avg(h.map((r) => r.c)),
    bestDepth: save.bestDepth,
    depthTrend,
    adWatchRate: p.adsOffered ? p.adsWatched / p.adsOffered : 0,
    revives: p.revives,
    quitRate: save.runs ? p.quits / save.runs : 0,
    retained,
    segment,
    churnRisk,
  };
}

/** Compact user properties attached to every analytics event. */
export function userProperties(save: SaveData, now: number): Record<string, string | number | boolean> {
  const m = playerMetrics(save, now);
  return {
    player_id: save.profile.id,
    level: save.level,
    best_depth: save.bestDepth,
    forge_tier: save.forgeTier,
    prestiges: save.prestiges,
    difficulty: save.difficulty || 'normal',
    days_since_install: m.daysSinceInstall,
    sessions: m.sessions,
    runs: save.runs,
    segment: m.segment,
    churn_risk: m.churnRisk,
    ads_watched: save.profile.adsWatched,
  };
}
