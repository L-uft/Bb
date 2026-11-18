/**
 * Everything @bb/core needs from its host, injected so the same code runs in
 * Node (tests: test/support/nodePlatform.ts) and Hermes (the app's React Native
 * implementation). See docs/mobile/PLAN.md D10.
 */
export interface PlatformFetchInit extends RequestInit {
  /** Abort the request after this many milliseconds. Implementations must not rely on AbortSignal.timeout. */
  timeoutMs?: number;
}

export interface Logger {
  debug(tag: string, msg: string, data?: unknown): void;
  info(tag: string, msg: string, data?: unknown): void;
  warn(tag: string, msg: string, data?: unknown): void;
  error(tag: string, msg: string, data?: unknown): void;
}

export interface KeyValueStore {
  getString(key: string): string | undefined;
  set(key: string, value: string): void;
  delete(key: string): void;
  keys(): string[];
}

export interface Platform {
  fetch(url: string, init?: PlatformFetchInit): Promise<Response>;
  crypto: {
    md5Hex(data: Uint8Array | string): string;
    sha1Hex(data: Uint8Array | string): string;
    sha256(data: Uint8Array | string): Uint8Array;
    randomBytes(n: number): Uint8Array;
    aesGcmDecrypt(key: Uint8Array, iv: Uint8Array, cipherText: Uint8Array, tag: Uint8Array): Uint8Array;
  };
  bytes: {
    toBase64(b: Uint8Array): string;
    fromBase64(s: string): Uint8Array;
    utf8Encode(s: string): Uint8Array;
    utf8Decode(b: Uint8Array): string;
  };
  storage: KeyValueStore;
  logger: Logger;
  now(): number;
}
