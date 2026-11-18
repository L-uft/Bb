import { describe, expect, it } from 'vitest';
import bundledJson from '../../src/youtube/clients.json';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  BUNDLED_CLIENTS_CONFIG,
  REMOTE_CLIENTS_CONFIG_URL,
  googlevideoUserAgentFor,
  parseClientsConfig,
} from '../../src/youtube/clientsConfig';

describe('remote clients.json location (D15)', () => {
  it('points at the L-uft/Bb fork, mobile branch, and the real file path', () => {
    const prefix = 'https://raw.githubusercontent.com/L-uft/Bb/mobile/';
    expect(REMOTE_CLIENTS_CONFIG_URL.startsWith(prefix)).toBe(true);
    const repoPath = REMOTE_CLIENTS_CONFIG_URL.slice(prefix.length);
    expect(existsSync(resolve(__dirname, '../../../..', repoPath))).toBe(true);
  });
});

const clone = () => JSON.parse(JSON.stringify(bundledJson));

describe('clients.json schema (D15)', () => {
  it('accepts the bundled file', () => {
    expect(parseClientsConfig(bundledJson).ok).toBe(true);
    expect(BUNDLED_CLIENTS_CONFIG.player.map((p) => p.name)).toEqual(['IOS', 'ANDROID_MUSIC']);
  });

  it('rejects unknown top-level fields', () => {
    const c = clone();
    c.script = 'alert(1)';
    expect(parseClientsConfig(c)).toMatchObject({ ok: false });
  });

  it('rejects unknown fields inside a client', () => {
    const c = clone();
    c.player[0].eval = 'x';
    expect(parseClientsConfig(c)).toMatchObject({ ok: false });
  });

  it('rejects a non-YouTube player host', () => {
    const c = clone();
    c.player[0].host = 'evil.example.com';
    const r = parseClientsConfig(c);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('player.0.host');
  });

  it('rejects a config with every client disabled', () => {
    const c = clone();
    for (const p of c.player) p.enabled = false;
    expect(parseClientsConfig(c).ok).toBe(false);
  });

  it('rejects wrong types and non-https visitorData url', () => {
    const a = clone();
    a.version = '2';
    expect(parseClientsConfig(a).ok).toBe(false);
    const b = clone();
    b.visitorData.url = 'http://www.youtube.com/sw.js_data';
    expect(parseClientsConfig(b).ok).toBe(false);
  });

  it('rejects non-objects', () => {
    expect(parseClientsConfig(null).ok).toBe(false);
    expect(parseClientsConfig('{}').ok).toBe(false);
  });
});

describe('googlevideoUserAgentFor', () => {
  const cfg = BUNDLED_CLIENTS_CONFIG;
  it('maps the c= client param like the desktop GV_UA table', () => {
    expect(googlevideoUserAgentFor(cfg, 'IOS')).toContain('com.google.ios.youtube');
    expect(googlevideoUserAgentFor(cfg, 'android_music')).toContain('youtube.music');
    expect(googlevideoUserAgentFor(cfg, 'ANDROID_CREATOR')).toContain('com.google.android.youtube/');
    expect(googlevideoUserAgentFor(cfg, 'WEB_REMIX')).toContain('Chrome');
  });
  it('falls back to the IOS user agent', () => {
    expect(googlevideoUserAgentFor(cfg, undefined)).toBe(cfg.googlevideoUserAgents.IOS);
    expect(googlevideoUserAgentFor(cfg, 'SOMETHING_NEW')).toBe(cfg.googlevideoUserAgents.IOS);
  });
});
