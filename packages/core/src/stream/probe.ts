/**
 * One-byte range request to check a stream URL is actually playable.
 * Ported from Riff server.js verifyStreamPlayable (L1040).
 */
import type { Platform } from '../platform/types';
import { getQueryParam } from '../util/url';
import { MAX_STREAM_AGE_MS } from './types';

export interface ProbeResult {
  ok: boolean;
  status: number;
  ms: number;
  error?: string;
}

/**
 * GET with `Range: bytes=0-0`. 200 or 206 means playable. The request is aborted as
 * soon as headers arrive, so a server that ignores Range doesn't send the whole file.
 * Pass `headers: {}` to probe without any custom header (diagnostics).
 */
export async function probeStream(
  platform: Platform,
  url: string,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<ProbeResult> {
  const started = platform.now();
  const ac = new AbortController();
  try {
    const res = await platform.fetch(url, {
      method: 'GET',
      headers: { ...headers, Range: 'bytes=0-0' },
      signal: ac.signal,
      timeoutMs,
    });
    const status = res.status;
    ac.abort();
    return { ok: status === 200 || status === 206, status, ms: platform.now() - started };
  } catch (e) {
    return { ok: false, status: 0, ms: platform.now() - started, error: e instanceof Error ? e.message : String(e) };
  }
}

/** D6: min(expire= param, resolvedAt + 5 h). */
export function computeExpiresAt(url: string, resolvedAt: number): number {
  const cap = resolvedAt + MAX_STREAM_AGE_MS;
  const expire = Number(getQueryParam(url, 'expire'));
  if (Number.isFinite(expire) && expire > 0) return Math.min(expire * 1000, cap);
  return cap;
}

export function isStreamExpired(stream: { expiresAt: number }, now: number, safetyMs = 60_000): boolean {
  return now >= stream.expiresAt - safetyMs;
}
