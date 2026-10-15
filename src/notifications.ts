/**
 * Local push notifications (no server needed): scheduled when the app goes to
 * the background, cancelled when it comes back.
 * Best practices: soft-ask before the OS prompt, no night pings (22:00–09:00),
 * at most a few notifications, each one about a concrete reward.
 */
import { LocalNotifications } from '@capacitor/local-notifications';
import { track } from './analytics';
import { FREE_CHEST_COOLDOWN, IDLE_CAP_HOURS, dailyStatus, idleRatePerHour, unlocked } from './game/meta';
import type { SaveData } from './game/save';
import { isNative } from './platform';
import { t } from './ui/i18n';

const HOUR = 3600_000;
const IDS = { chest: 101, idle: 102, daily: 103, comeback1: 104, comeback3: 105 };

export interface PlannedNotification {
  id: number;
  at: number;
  title: string;
  body: string;
  kind: keyof typeof IDS;
}

/** Moves a time out of quiet hours (22:00–09:00 local) to 10:00. */
export function outOfQuietHours(at: number): number {
  const d = new Date(at);
  const h = d.getHours();
  if (h >= 22) {
    d.setDate(d.getDate() + 1);
    d.setHours(10, 0, 0, 0);
  } else if (h < 9) d.setHours(10, 0, 0, 0);
  return d.getTime();
}

function nextDayAt(now: number, hour: number): number {
  const d = new Date(now);
  d.setDate(d.getDate() + 1);
  d.setHours(hour, 0, 0, 0);
  return d.getTime();
}

/** Pure planner (unit-tested): what to schedule for this save at `now`. */
export function planNotifications(save: SaveData, now: number): PlannedNotification[] {
  const out: PlannedNotification[] = [];
  const add = (kind: keyof typeof IDS, at: number, title: string, body: string) => {
    if (at > now + 60_000) out.push({ id: IDS[kind], kind, at: outOfQuietHours(at), title, body });
  };
  if (unlocked(save, 'freeChest') && save.freeChestAt > now && save.freeChestAt - now <= FREE_CHEST_COOLDOWN) {
    add('chest', save.freeChestAt, t('pushChestTitle'), t('pushChestBody'));
  }
  if (unlocked(save, 'idle') && save.idleLast && idleRatePerHour(save) > 0) {
    add('idle', save.idleLast + IDLE_CAP_HOURS * HOUR, t('pushIdleTitle'), t('pushIdleBody'));
  }
  if (unlocked(save, 'daily')) {
    const claimedToday = !dailyStatus(save, now).canClaim;
    const day = Math.min(7, (claimedToday ? save.dailyStreak : save.dailyStreak) + 1);
    add('daily', nextDayAt(now, 18), t('pushDailyTitle', { n: day > 7 ? 1 : day }), t('pushDailyBody'));
  }
  add('comeback1', now + 26 * HOUR, t('pushBackTitle'), t('pushBackBody', { d: save.bestDepth }));
  add('comeback3', now + 72 * HOUR, t('pushBack3Title'), t('pushBack3Body'));
  // never more than one notification within 2 hours of another
  out.sort((a, b) => a.at - b.at);
  const spaced: PlannedNotification[] = [];
  for (const n of out) if (!spaced.length || n.at - spaced[spaced.length - 1].at >= 2 * HOUR) spaced.push(n);
  return spaced;
}

export type PushPermission = 'granted' | 'denied' | 'prompt' | 'unsupported';

export async function pushPermission(): Promise<PushPermission> {
  if (!isNative) return 'unsupported';
  try {
    const p = await LocalNotifications.checkPermissions();
    return p.display === 'granted' ? 'granted' : p.display === 'denied' ? 'denied' : 'prompt';
  } catch {
    return 'unsupported';
  }
}

export async function requestPush(): Promise<boolean> {
  if (!isNative) return false;
  try {
    const p = await LocalNotifications.requestPermissions();
    track('push_permission', { granted: p.display === 'granted' });
    return p.display === 'granted';
  } catch {
    return false;
  }
}

/** Called when the app goes to the background. */
export async function schedulePush(save: SaveData, now: number): Promise<number> {
  if (!isNative || !save.settings.notifications) return 0;
  if ((await pushPermission()) !== 'granted') return 0;
  const plan = planNotifications(save, now);
  try {
    await LocalNotifications.cancel({ notifications: Object.values(IDS).map((id) => ({ id })) });
    if (plan.length) {
      await LocalNotifications.schedule({
        notifications: plan.map((n) => ({
          id: n.id,
          title: n.title,
          body: n.body,
          schedule: { at: new Date(n.at), allowWhileIdle: true },
          extra: { kind: n.kind },
        })),
      });
    }
  } catch {
    return 0;
  }
  return plan.length;
}

/** Called when the app returns to the foreground. */
export async function clearPush(): Promise<void> {
  if (!isNative) return;
  try {
    await LocalNotifications.cancel({ notifications: Object.values(IDS).map((id) => ({ id })) });
    await LocalNotifications.removeAllDeliveredNotifications();
  } catch {
    /* ignore */
  }
}

export function listenPushOpens(): void {
  if (!isNative) return;
  void LocalNotifications.addListener('localNotificationActionPerformed', (a) => {
    track('push_open', { kind: String(a.notification.extra?.kind ?? 'unknown') });
  });
}
