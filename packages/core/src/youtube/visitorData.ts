/**
 * Anonymous visitorData token, sent with player requests.
 * Ported from Riff server.js getYtVisitorData (L1095).
 */
import type { Platform } from '../platform/types';
import type { ClientsConfig } from './clientsConfig';

let cached: { value: string; at: number } | null = null;

export function clearVisitorDataCache(): void {
  cached = null;
}

/** Returns '' when unavailable; player requests still work without it, just less reliably. */
export async function getVisitorData(platform: Platform, config: ClientsConfig): Promise<string> {
  const now = platform.now();
  if (cached && now - cached.at < config.visitorData.maxAgeMs) return cached.value;
  try {
    const res = await platform.fetch(config.visitorData.url, {
      headers: { 'User-Agent': config.visitorData.userAgent },
      timeoutMs: config.timeouts.visitorDataMs,
    });
    if (res.ok) {
      const text = await res.text();
      const m = text.match(/["']([Cgt][a-zA-Z0-9_%-]{10,60})["']/);
      if (m?.[1]) {
        cached = { value: m[1], at: now };
        return m[1];
      }
    }
    platform.logger.warn('youtube', `visitorData not found (HTTP ${res.status})`);
  } catch (e) {
    platform.logger.warn('youtube', 'visitorData request failed', String(e));
  }
  return cached?.value ?? '';
}
