import { describe, expect, it } from 'vitest';
import { BUNDLED_CLIENTS_CONFIG } from '../../src/youtube/clientsConfig';
import {
  PlayabilityError,
  buildPlayerBody,
  extractVideoId,
  parsePlayerResponse,
  pickAudioFormat,
} from '../../src/youtube/player';
import { playerResponse } from '../support/fixtures';

describe('extractVideoId', () => {
  it('accepts ids and common URL forms', () => {
    expect(extractVideoId('dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(extractVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1')).toBe('dQw4w9WgXcQ');
    expect(extractVideoId('https://music.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(extractVideoId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(extractVideoId('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });
  it('rejects non-ids', () => {
    expect(extractVideoId('dz_12345')).toBe('');
    expect(extractVideoId('')).toBe('');
  });
});

describe('parsePlayerResponse', () => {
  it('keeps only direct-URL formats', () => {
    const info = parsePlayerResponse(playerResponse());
    expect(info.formats.map((f) => f.itag).sort()).toEqual([139, 140, 18, 251, 399]);
    expect(info.title).toBe('Test title');
    expect(info.lengthSeconds).toBe(213);
  });
  it('throws PlayabilityError when not playable', () => {
    expect(() => parsePlayerResponse({ playabilityStatus: { status: 'LOGIN_REQUIRED', reason: 'Sign in' } })).toThrow(
      PlayabilityError,
    );
  });
});

describe('pickAudioFormat', () => {
  const formats = parsePlayerResponse(playerResponse()).formats;
  it('prefers itag 140 for standard quality (AAC, plays natively on iOS)', () => {
    expect(pickAudioFormat(formats, BUNDLED_CLIENTS_CONFIG.itags.standard)?.itag).toBe(140);
  });
  it('prefers itag 139 for low quality', () => {
    expect(pickAudioFormat(formats, BUNDLED_CLIENTS_CONFIG.itags.low)?.itag).toBe(139);
  });
  it('falls back to the best other audio/mp4, then muxed itag 18, never webm', () => {
    const noPreferred = formats.filter((f) => f.itag !== 140 && f.itag !== 139);
    expect(pickAudioFormat(noPreferred, [140])?.itag).toBe(18);
    const onlyWebm = formats.filter((f) => f.itag === 251);
    expect(pickAudioFormat(onlyWebm, [140])).toBeUndefined();
  });
});

describe('buildPlayerBody', () => {
  it('sends the profile fields and locale', () => {
    const ios = BUNDLED_CLIENTS_CONFIG.player[0]!;
    const body = JSON.parse(buildPlayerBody(ios, 'dQw4w9WgXcQ', BUNDLED_CLIENTS_CONFIG, 'CgtVISITOR'));
    expect(body).toMatchObject({
      videoId: 'dQw4w9WgXcQ',
      contentCheckOk: true,
      racyCheckOk: true,
      context: { client: { clientName: 'IOS', clientVersion: '20.10.4', deviceModel: 'iPhone16,2', visitorData: 'CgtVISITOR', hl: 'en', gl: 'US' } },
    });
  });
});
