import { describe, expect, it } from 'vitest';
import { computeExpiresAt, isStreamExpired } from '../../src/stream/probe';
import { OnDeviceResolver } from '../../src/stream/onDeviceResolver';
import { MAX_STREAM_AGE_MS, ResolveError } from '../../src/stream/types';
import { BUNDLED_CLIENTS_CONFIG } from '../../src/youtube/clientsConfig';
import { clearVisitorDataCache } from '../../src/youtube/visitorData';
import { createNodePlatform } from '../support/nodePlatform';
import { playerResponse } from '../support/fixtures';

type Probe = (client: string, ua: string | null) => number;

function fakeYouTube(probe: Probe, playerStatus: Record<string, number> = {}) {
  const calls: string[] = [];
  const fetchImpl = async (url: string, init?: RequestInit): Promise<Response> => {
    const headers = new Headers(init?.headers);
    calls.push(url);
    if (url.includes('sw.js_data')) return new Response(')]}\'\n[["CgtTESTVISITOR1"]]');
    const m = url.match(/^https:\/\/([^/]+)\/youtubei\/v1\/player/);
    if (m) {
      const client = m[1] === 'music.youtube.com' ? 'ANDROID_MUSIC' : 'IOS';
      const status = playerStatus[client] ?? 200;
      if (status !== 200) return new Response('nope', { status });
      return Response.json(playerResponse(client));
    }
    if (url.includes('googlevideo.com')) {
      const client = url.match(/[?&]c=([A-Z_]+)/)?.[1] ?? '';
      expect(headers.get('Range')).toBe('bytes=0-0');
      return new Response('x', { status: probe(client, headers.get('User-Agent')) });
    }
    return new Response('unexpected', { status: 500 });
  };
  return { fetchImpl, calls };
}

// Every profile enabled, so fallback between clients is exercised regardless of
// which ones the bundled clients.json currently enables.
const ALL_ENABLED = {
  ...BUNDLED_CLIENTS_CONFIG,
  player: BUNDLED_CLIENTS_CONFIG.player.map((p) => ({ ...p, enabled: true })),
};

const make = (fetchImpl: (u: string, i?: RequestInit) => Promise<Response>, verify = true) => {
  clearVisitorDataCache();
  const platform = createNodePlatform({ fetchImpl, quiet: true });
  return { platform, resolver: new OnDeviceResolver(platform, { getConfig: () => ALL_ENABLED, verify }) };
};

describe('OnDeviceResolver', () => {
  it('returns itag 140 with the googlevideo User-Agent for the winning client', async () => {
    const { fetchImpl } = fakeYouTube((client, ua) => (ua?.includes('ios.youtube') && client === 'IOS' ? 206 : 403));
    const { resolver } = make(fetchImpl);
    const s = await resolver.resolve({ source: 'youtube', id: 'dQw4w9WgXcQ' });
    expect(s.client).toBe('IOS');
    expect(s.itag).toBe(140);
    expect(s.mimeType).toContain('audio/mp4');
    expect(s.headers['User-Agent']).toContain('com.google.ios.youtube');
    expect(s.title).toBe('Test title');
  });

  it('falls through to the next client when a probe returns 403', async () => {
    const { fetchImpl } = fakeYouTube((client) => (client === 'IOS' ? 403 : 206));
    const { resolver } = make(fetchImpl);
    const s = await resolver.resolve({ source: 'youtube', id: 'https://youtu.be/dQw4w9WgXcQ' });
    expect(s.client).toBe('ANDROID_MUSIC');
    expect(s.headers['User-Agent']).toContain('youtube.music');
  });

  it('honours quality=low (itag 139)', async () => {
    const { fetchImpl } = fakeYouTube(() => 206);
    const { resolver } = make(fetchImpl);
    const s = await resolver.resolve({ source: 'youtube', id: 'dQw4w9WgXcQ' }, { quality: 'low', clients: ['IOS'] });
    expect(s.itag).toBe(139);
  });

  it('throws ResolveError naming every client when all fail', async () => {
    const { fetchImpl } = fakeYouTube(() => 403, { IOS: 400 });
    const { resolver, platform } = make(fetchImpl);
    const err = await resolver.resolve({ source: 'youtube', id: 'dQw4w9WgXcQ' }).catch((e) => e);
    expect(err).toBeInstanceOf(ResolveError);
    expect(err.attempts).toEqual([
      { client: 'IOS', error: 'player HTTP 400' },
      { client: 'ANDROID_MUSIC', error: 'probe 403' },
    ]);
    expect(platform.logs.some((l) => l.startsWith('[error] stream'))).toBe(true);
  });

  it('rejects non-YouTube ids without any network call', async () => {
    const { fetchImpl, calls } = fakeYouTube(() => 206);
    const { resolver } = make(fetchImpl);
    await expect(resolver.resolve({ source: 'youtube', id: 'dz_123' })).rejects.toBeInstanceOf(ResolveError);
    expect(calls).toHaveLength(0);
  });

  it('skips the probe when verify is false', async () => {
    const { fetchImpl, calls } = fakeYouTube(() => 403);
    const { resolver } = make(fetchImpl, false);
    await resolver.resolve({ source: 'youtube', id: 'dQw4w9WgXcQ' }, { clients: ['IOS'] });
    expect(calls.some((u) => u.includes('googlevideo'))).toBe(false);
  });
});

describe('stream age rule (D6)', () => {
  const t0 = 1_800_000_000_000;
  it('caps expiry at 5 hours even if the URL allows 6', () => {
    const url = `https://x.googlevideo.com/videoplayback?expire=${t0 / 1000 + 6 * 3600}&c=IOS`;
    expect(computeExpiresAt(url, t0)).toBe(t0 + MAX_STREAM_AGE_MS);
  });
  it('uses the URL expiry when it is sooner', () => {
    const url = `https://x.googlevideo.com/videoplayback?itag=140&expire=${t0 / 1000 + 3600}`;
    expect(computeExpiresAt(url, t0)).toBe(t0 + 3600_000);
  });
  it('treats a URL as expired one minute before its deadline', () => {
    expect(isStreamExpired({ expiresAt: t0 }, t0 - 61_000)).toBe(false);
    expect(isStreamExpired({ expiresAt: t0 }, t0 - 59_000)).toBe(true);
  });
});
