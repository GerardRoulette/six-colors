'use client';

// Website stand-in for the Yandex adapter. Same method names, no SDK, no ads, no network.

// Finish startup immediately. `done` receives null because this build has no platform language.
function boot(done) {
  done(null);
}

// Game Ready is a Yandex loading signal. The website has nothing to notify.
function signalReady() {}

// Gameplay start/stop markers exist only for the Yandex catalog.
function gameplayStart() {}

// Pair of `gameplayStart`. No-op so call sites can stay unconditional.
function gameplayStop() {}

// `listener` would be called with true when the platform pauses the game. Returns an unsubscribe.
function subscribePause() {
  // Unsubscribe for a subscription that was never created.
  return () => {};
}

// Result-card fullscreen ad. The website build does not show one.
function showResultAd() {}

// Methods the match and the language provider call. Website behavior stays inside the game.
export const webPlatform = {
  boot,
  signalReady,
  gameplayStart,
  gameplayStop,
  subscribePause,
  showResultAd,
};
