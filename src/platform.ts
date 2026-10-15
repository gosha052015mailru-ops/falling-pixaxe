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

/**
 * Rewarded ad. Placeholder until AdMob is wired in (roadmap v0.3):
 * shows a short fake break and always rewards.
 */
export async function showRewardedAd(label: string): Promise<boolean> {
  const el = document.createElement('div');
  el.className = 'ad-overlay';
  el.innerHTML = `<div class="ad-box panel"><div class="ribbon">AD</div><div style="margin-top:10px">${label}</div><div class="ad-bar"><i></i></div></div>`;
  document.body.appendChild(el);
  await new Promise((r) => setTimeout(r, 1500));
  el.remove();
  return true;
}
