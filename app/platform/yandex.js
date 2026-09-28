'use client';

// Yandex Games SDK adapter. Loaded only when `NEXT_PUBLIC_PLATFORM` is `yandex`.
// Promises stay in this file: `YaGames.init()` is asynchronous and the rest of the app stays callback-based.

// Archive builds must load the SDK from the game origin, not from a hard-coded yandex.ru URL.
const SDK_SRC = '/sdk.js';

// SDK instance after `YaGames.init()`, or null when init has not finished or failed.
let ysdk = null;
// True after `LoadingAPI.ready()` so a re-render does not report Game Ready twice.
let readySent = false;
// True between `GameplayAPI.start()` and `stop()`.
let gameplayOn = false;
// True while Yandex has paused the game (startup ad, tab hide, fullscreen ad).
let paused = false;
// `subscribePause` listeners. Each is called with the new paused flag.
const pauseListeners = new Set();

// Notify the match that the platform pause flag changed. `next` is the new paused state.
function setPaused(next) {
  paused = next;
  pauseListeners.forEach((listener) => listener(next));
}

// Resolve when `YaGames` exists. Injects `/sdk.js` if the layout script is not already on the page.
function loadSdk() {
  if (typeof window !== 'undefined' && window.YaGames) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    // Script tag already requested by the layout, or by an earlier boot.
    const existing = document.querySelector(`script[src="${SDK_SRC}"]`);
    // Mark success once the global appears, including when the load event already fired.
    const finish = () => {
      if (window.YaGames) resolve();
      else reject(new Error('Yandex SDK loaded without YaGames'));
    };
    if (existing) {
      existing.addEventListener('load', finish);
      existing.addEventListener('error', () => reject(new Error('Yandex SDK failed to load')));
      return;
    }
    // Fallback when the layout did not emit the script tag.
    const script = document.createElement('script');
    script.src = SDK_SRC;
    script.async = true;
    script.onload = finish;
    script.onerror = () => reject(new Error('Yandex SDK failed to load'));
    document.head.appendChild(script);
  });
}

// Stop the gameplay marker if it is on. Safe to call twice.
function stopGameplay() {
  if (!ysdk || !gameplayOn || !ysdk.features || !ysdk.features.GameplayAPI) return;
  gameplayOn = false;
  ysdk.features.GameplayAPI.stop();
}

// Init the SDK, subscribe to pause/resume, then hand the platform language to `done`.
// `done` receives `{ lang }` or null when the SDK never becomes available (local dev without `/sdk.js`).
function boot(done) {
  loadSdk()
    .then(() => window.YaGames.init())
    .then((sdk) => {
      ysdk = sdk;
      sdk.on('game_api_pause', () => {
        setPaused(true);
        stopGameplay();
      });
      sdk.on('game_api_resume', () => {
        // The match effect calls `gameplayStart` only when a match is actually in play.
        setPaused(false);
      });
      // ISO 639-1 code from the Yandex shell (`en`, `ru`, …). Missing when the field is absent.
      const lang = sdk.environment && sdk.environment.i18n && sdk.environment.i18n.lang;
      done({ lang: typeof lang === 'string' ? lang : null });
    })
    .catch((error) => {
      console.error(error);
      done(null);
    });
}

// Tell Yandex the board can be used. Call once the locale is applied and the match is on screen.
function signalReady() {
  if (readySent || !ysdk || !ysdk.features || !ysdk.features.LoadingAPI) return;
  readySent = true;
  ysdk.features.LoadingAPI.ready();
}

// Mark an active match. No-op while the platform has the game paused.
function gameplayStart() {
  if (!ysdk || gameplayOn || paused || !ysdk.features || !ysdk.features.GameplayAPI) return;
  gameplayOn = true;
  ysdk.features.GameplayAPI.start();
}

// Mark a pause in play: result card, FAQ, difficulty, or a platform pause.
function gameplayStop() {
  stopGameplay();
}

// `listener` is called with true on pause and false on resume. Returns an unsubscribe.
function subscribePause(listener) {
  pauseListeners.add(listener);
  return () => pauseListeners.delete(listener);
}

// Fullscreen ad on the result card. The platform may skip it when the cooldown has not elapsed.
function showResultAd() {
  stopGameplay();
  if (!ysdk || !ysdk.adv || !ysdk.adv.showFullscreenAdv) return;
  ysdk.adv.showFullscreenAdv({
    callbacks: {
      onError: (error) => {
        console.error(error);
      },
    },
  });
}

// Yandex platform methods. Do not import this module from website-only code.
export const yandexPlatform = {
  boot,
  signalReady,
  gameplayStart,
  gameplayStop,
  subscribePause,
  showResultAd,
};
