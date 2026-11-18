// React Native implementation of @bb/core's Platform (PLAN.md D10).
// Crypto lands in Phase 3 (@noble/*); nothing in the spike needs it.
import type { Platform, PlatformFetchInit } from '@bb/core';
import { createMMKV } from 'react-native-mmkv';
import { eventLog } from '../log/eventLog';

const notYet = (name: string) => () => {
  throw new Error(`Platform.crypto.${name} is not implemented yet (Phase 3)`);
};

function toBase64(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

export function createRnPlatform(): Platform {
  const kv = createMMKV({ id: 'bb.core' });
  return {
    async fetch(url: string, init: PlatformFetchInit = {}) {
      const { timeoutMs, signal, ...rest } = init;
      const ac = new AbortController();
      const onAbort = () => ac.abort();
      if (signal) {
        if (signal.aborted) ac.abort();
        else signal.addEventListener('abort', onAbort);
      }
      const timer = timeoutMs ? setTimeout(() => ac.abort(), timeoutMs) : undefined;
      try {
        return await fetch(url, { ...rest, signal: ac.signal });
      } finally {
        if (timer) clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
      }
    },
    crypto: {
      md5Hex: notYet('md5Hex'),
      sha1Hex: notYet('sha1Hex'),
      sha256: notYet('sha256'),
      randomBytes: notYet('randomBytes'),
      aesGcmDecrypt: notYet('aesGcmDecrypt'),
    },
    bytes: {
      toBase64,
      fromBase64: (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)),
      utf8Encode: (s) => new TextEncoder().encode(s),
      utf8Decode: (b) => new TextDecoder().decode(b),
    },
    storage: {
      getString: (k) => kv.getString(k),
      set: (k, v) => kv.set(k, v),
      delete: (k) => void kv.remove(k),
      keys: () => kv.getAllKeys(),
    },
    logger: {
      debug: (t, m, d) => eventLog.debug(t, m, d),
      info: (t, m, d) => eventLog.info(t, m, d),
      warn: (t, m, d) => eventLog.warn(t, m, d),
      error: (t, m, d) => eventLog.error(t, m, d),
    },
    now: () => Date.now(),
  };
}

export const platform = createRnPlatform();
