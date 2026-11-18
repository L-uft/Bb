// Node implementation of Platform, for tests only (Node built-ins are allowed under test/).
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { Logger, Platform, PlatformFetchInit } from '../../src/platform/types';

export interface NodePlatformOptions {
  fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>;
  now?: () => number;
  quiet?: boolean;
}

export function createNodePlatform(opts: NodePlatformOptions = {}): Platform & { logs: string[] } {
  const logs: string[] = [];
  const log = (level: string) => (tag: string, msg: string, data?: unknown) => {
    const line = `[${level}] ${tag}: ${msg}${data === undefined ? '' : ` ${JSON.stringify(data)}`}`;
    logs.push(line);
    if (!opts.quiet && level !== 'debug') console.log(line);
  };
  const logger: Logger = { debug: log('debug'), info: log('info'), warn: log('warn'), error: log('error') };
  const kv = new Map<string, string>();
  const fetchImpl = opts.fetchImpl ?? ((url: string, init?: RequestInit) => fetch(url, init));
  const bytes = (d: Uint8Array | string) => (typeof d === 'string' ? Buffer.from(d, 'utf8') : Buffer.from(d));

  return {
    logs,
    async fetch(url: string, init: PlatformFetchInit = {}) {
      const { timeoutMs, signal, ...rest } = init;
      const ac = new AbortController();
      const onAbort = () => ac.abort();
      if (signal) {
        if (signal.aborted) ac.abort();
        else signal.addEventListener('abort', onAbort, { once: true });
      }
      const timer = timeoutMs ? setTimeout(() => ac.abort(), timeoutMs) : undefined;
      try {
        return await fetchImpl(url, { ...rest, signal: ac.signal });
      } finally {
        if (timer) clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
      }
    },
    crypto: {
      md5Hex: (d) => createHash('md5').update(bytes(d)).digest('hex'),
      sha1Hex: (d) => createHash('sha1').update(bytes(d)).digest('hex'),
      sha256: (d) => new Uint8Array(createHash('sha256').update(bytes(d)).digest()),
      randomBytes: (n) => new Uint8Array(randomBytes(n)),
      aesGcmDecrypt: (key, iv, cipherText, tag) => {
        const d = createDecipheriv('aes-256-gcm', key, iv);
        d.setAuthTag(tag);
        return new Uint8Array(Buffer.concat([d.update(cipherText), d.final()]));
      },
    },
    bytes: {
      toBase64: (b) => Buffer.from(b).toString('base64'),
      fromBase64: (s) => new Uint8Array(Buffer.from(s, 'base64')),
      utf8Encode: (s) => new Uint8Array(Buffer.from(s, 'utf8')),
      utf8Decode: (b) => Buffer.from(b).toString('utf8'),
    },
    storage: {
      getString: (k) => kv.get(k),
      set: (k, v) => void kv.set(k, v),
      delete: (k) => void kv.delete(k),
      keys: () => [...kv.keys()],
    },
    logger,
    now: opts.now ?? (() => Date.now()),
  };
}

// Kept for future .rfacc tests (encrypt side of the codec).
export function aesGcmEncryptForTest(key: Uint8Array, iv: Uint8Array, plain: Uint8Array) {
  const c = createCipheriv('aes-256-gcm', key, iv);
  const out = Buffer.concat([c.update(plain), c.final()]);
  return { cipherText: new Uint8Array(out), tag: new Uint8Array(c.getAuthTag()) };
}
