import '@fontsource/rubik/500.css';
import '@fontsource/rubik/600.css';
import '@fontsource/rubik/700.css';
import '@fontsource/rubik/800.css';
import '@fontsource/rubik/900.css';
import './styles.css';
import { installErrorReporting } from './analytics';
import { sfx } from './audio/sfx';
import { wipeStorage } from './game/save';
import { App } from './ui/app';
import { gameReady, initPlatform } from './platform';

// Open the game with ?reset in the address to start from scratch (handy while testing).
const url = new URL(location.href);
if (url.searchParams.has('reset')) {
  wipeStorage();
  url.searchParams.delete('reset');
  history.replaceState(null, '', url.pathname + url.search + url.hash);
}

installErrorReporting();
void Promise.all([document.fonts?.ready, initPlatform()]).finally(() => {
  const app = new App();
  gameReady();
  // Console helpers for testers: game.reset(), game.cheat({ coins, gems, level, depth, forge, down, boosts, world })
  const api = {
    reset: () => app.resetProgress(),
    /** The live app (save, run, screens) for automated checks. */
    app,
    cheat: (o?: Parameters<App['cheat']>[0]) => app.cheat(o),
    /** Preview a sound effect, e.g. game.sound('ohYes'). */
    sound: (name: string) => {
      sfx.unlock();
      (sfx as unknown as Record<string, (() => void) | undefined>)[name]?.();
    },
  };
  Object.assign(window, { game: api, resetGame: api.reset });
});
