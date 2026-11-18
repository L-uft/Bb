// LIVE network test (npm run test:live). Spike S1:
//  1. resolve 3 public videos to audio/mp4 (itag 140 preferred) through OnDeviceResolver;
//  2. header matrix: does googlevideo require the client User-Agent, or would the
//     default iOS media User-Agent (AppleCoreMedia) also work?
import { describe, expect, it } from 'vitest';
import { probeStream } from '../../src/stream/probe';
import { OnDeviceResolver } from '../../src/stream/onDeviceResolver';
import { BUNDLED_CLIENTS_CONFIG } from '../../src/youtube/clientsConfig';
import { createNodePlatform } from '../support/nodePlatform';

const VIDEOS = [
  { id: 'dQw4w9WgXcQ', label: 'Rick Astley - Never Gonna Give You Up' },
  { id: 'kJQP7kiw5Fk', label: 'Luis Fonsi - Despacito' },
  { id: 'fJ9rUzIMcZQ', label: 'Queen - Bohemian Rhapsody' },
];

const UA_VARIANTS: Record<string, (clientUa: string) => Record<string, string>> = {
  'client UA': (ua) => ({ 'User-Agent': ua }),
  AppleCoreMedia: () => ({ 'User-Agent': 'AppleCoreMedia/1.0.0.22D60 (iPhone; U; CPU OS 18_3_2 like Mac OS X; en_us)' }),
  Safari: () => ({
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Mobile/15E148 Safari/604.1',
  }),
  'no UA header': () => ({}),
};

const platform = createNodePlatform();
const resolver = new OnDeviceResolver(platform, { getConfig: () => BUNDLED_CLIENTS_CONFIG });
const rows: Record<string, string | number>[] = [];

describe('S1 live: OnDeviceResolver', () => {
  for (const v of VIDEOS) {
    it(`resolves ${v.label}`, async () => {
      const t0 = Date.now();
      const s = await resolver.resolve({ source: 'youtube', id: v.id });
      rows.push({
        video: v.id,
        winner: s.client,
        itag: s.itag ?? '?',
        mime: s.mimeType.split(';')[0] ?? '',
        kbps: Math.round((s.bitrate ?? 0) / 1000),
        MB: +((s.contentLength ?? 0) / 1048576).toFixed(2),
        'resolve ms': Date.now() - t0,
        'valid for h': +((s.expiresAt - s.resolvedAt) / 3600_000).toFixed(2),
      });
      expect(s.mimeType).toMatch(/^audio\/mp4/);
      expect(s.url).toContain('googlevideo.com');
    });
  }

  it('prints the summary', () => {
    console.table(rows);
    expect(rows).toHaveLength(VIDEOS.length);
  });
});

describe('S1 live: User-Agent matrix per client', () => {
  const matrix: Record<string, string | number>[] = [];
  for (const client of BUNDLED_CLIENTS_CONFIG.player.filter((c) => c.enabled)) {
    it(`probes ${client.name} URLs with different User-Agents`, async () => {
      for (const v of VIDEOS) {
        let s;
        try {
          s = await resolver.resolve({ source: 'youtube', id: v.id }, { clients: [client.name] });
        } catch (e) {
          matrix.push({ client: client.name, video: v.id, result: `resolve failed: ${String(e).slice(0, 80)}` });
          continue;
        }
        const row: Record<string, string | number> = { client: client.name, video: v.id, itag: s.itag ?? '?' };
        for (const [name, make] of Object.entries(UA_VARIANTS)) {
          const r = await probeStream(platform, s.url, make(s.headers['User-Agent'] ?? ''), 8000);
          row[name] = r.status || (r.error ?? 'err');
        }
        matrix.push(row);
      }
      expect(matrix.length).toBeGreaterThan(0);
    });
  }
  it('prints the matrix', () => {
    console.table(matrix);
  });
});
