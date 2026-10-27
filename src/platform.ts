import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle } from '@capacitor/haptics';

export const isNative = Capacitor.isNativePlatform();

let vibrationOn = true;
export function setVibration(on: boolean): void {
  vibrationOn = on;
}

/** Light / medium / heavy feedback; native haptics on Android, Vibration API on web. */
export function vibrate(strength: 'light' | 'medium' | 'heavy'): void {
  if (!vibrationOn) return;
  if (isNative) {
    const style = strength === 'light' ? ImpactStyle.Light : strength === 'medium' ? ImpactStyle.Medium : ImpactStyle.Heavy;
    void Haptics.impact({ style }).catch(() => undefined);
  } else if (navigator.vibrate) {
    navigator.vibrate(strength === 'light' ? 8 : strength === 'medium' ? 20 : 45);
  }
}

/** Build for Yandex Games (`npm run build:yandex`): ads, language and lifecycle go through the Yandex SDK. */
export const isYandex = import.meta.env.VITE_PLATFORM === 'yandex';

interface YaSdk {
  environment: { i18n: { lang: string } };
  features: { LoadingAPI?: { ready(): void }; GameplayAPI?: { start(): void; stop(): void } };
  adv: {
    showFullscreenAdv(o: { callbacks: Record<string, (...a: never[]) => void> }): void;
    showRewardedVideo(o: { callbacks: Record<string, (...a: never[]) => void> }): void;
  };
}
let ysdk: YaSdk | null = null;
let audioHook: (paused: boolean) => void = () => undefined;

/** The game mutes itself while an ad plays (platform requirement). */
export function onAdAudio(fn: (paused: boolean) => void): void {
  audioHook = fn;
}

/** Loads the platform SDK (no-op outside Yandex). Never rejects: the game works without it. */
export async function initPlatform(): Promise<void> {
  if (!isYandex) return;
  try {
    await new Promise<void>((ok, fail) => {
      const s = document.createElement('script');
      s.src = '/sdk.js';
      s.onload = () => ok();
      s.onerror = () => fail(new Error('sdk.js'));
      document.head.appendChild(s);
    });
    const YaGames = (window as unknown as { YaGames: { init(): Promise<YaSdk> } }).YaGames;
    ysdk = await YaGames.init();
  } catch {
    ysdk = null;
  }
}

/** Language the platform asks for, or null to follow the browser. */
export function platformLang(): 'ru' | 'en' | null {
  const l = ysdk?.environment.i18n.lang;
  if (!l) return null;
  return ['ru', 'be', 'kk', 'uk', 'uz'].includes(l) ? 'ru' : 'en';
}

/** Game finished loading and is playable. */
export function gameReady(): void {
  ysdk?.features.LoadingAPI?.ready();
}

/** Active gameplay started / stopped (runs, pauses, menus). */
export function gameplay(active: boolean): void {
  const g = ysdk?.features.GameplayAPI;
  if (active) g?.start();
  else g?.stop();
}

/** Interstitial between runs; the platform enforces its own frequency cap. */
export function showInterstitial(): Promise<void> {
  if (!ysdk) return Promise.resolve();
  const sdk = ysdk;
  return new Promise((done) => {
    sdk.adv.showFullscreenAdv({
      callbacks: {
        onOpen: () => audioHook(true),
        onClose: () => {
          audioHook(false);
          done();
        },
        onError: () => {
          audioHook(false);
          done();
        },
        onOffline: () => done(),
      },
    });
  });
}

/**
 * Rewarded ad. Yandex rewarded video on Yandex; elsewhere a placeholder until AdMob is wired in
 * (roadmap v0.3) that shows a short fake break and always rewards.
 */
export async function showRewardedAd(label: string): Promise<boolean> {
  if (isYandex) {
    if (!ysdk) return false;
    const sdk = ysdk;
    return new Promise((done) => {
      let rewarded = false;
      sdk.adv.showRewardedVideo({
        callbacks: {
          onOpen: () => audioHook(true),
          onRewarded: () => (rewarded = true),
          onClose: () => {
            audioHook(false);
            done(rewarded);
          },
          onError: () => {
            audioHook(false);
            done(false);
          },
        },
      });
    });
  }
  const el = document.createElement('div');
  el.className = 'ad-overlay';
  el.innerHTML = `<div class="ad-box panel"><div class="ribbon">AD</div><div style="margin-top:10px">${label}</div><div class="ad-bar"><i></i></div></div>`;
  document.body.appendChild(el);
  await new Promise((r) => setTimeout(r, 1500));
  el.remove();
  return true;
}
