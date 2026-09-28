'use client';

import { webPlatform } from './web';

// Pick the host adapter. The env compare is inlined, so a website build never loads `yandex.js`.
function selectPlatform() {
  if (process.env.NEXT_PUBLIC_PLATFORM === 'yandex') {
    return require('./yandex').yandexPlatform;
  }
  return webPlatform;
}

// Adapter used by the match and the language provider.
export const platform = selectPlatform();
