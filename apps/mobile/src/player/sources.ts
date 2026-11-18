// Source preparation helpers for the S2 spike:
//  - probeRanges(): the same HEAD + Range check react-native-audio-api 1.0.1 runs before
//    playing a remote URL (utils/remoteHttpSource.ts). It tells which path the library takes:
//    native FFmpeg streaming, or a full download into a JS ArrayBuffer.
//  - downloadToCache(): the approved fallback (PLAN.md fallback 1b): native download to disk,
//    then play the local file through the same graph. Nothing is decoded into memory.
//  - fetchYouTubeFormats(): every direct format for a video (diagnostics: itag 140 and 251).
import {
  BUNDLED_CLIENTS_CONFIG,
  buildPlayerBody,
  buildPlayerHeaders,
  getVisitorData,
  googlevideoUserAgentFor,
  parsePlayerResponse,
  playerUrl,
  type StreamFormat,
} from '@bb/core';
import { Directory, File, Paths } from 'expo-file-system';
import { eventLog } from '../log/eventLog';
import { platform } from '../platform/rnPlatform';

export interface RangeProbe {
  headStatus: number | string;
  acceptRanges: string;
  contentType: string;
  contentLength: string;
  rangeStatus: number | string;
  /** What react-native-audio-api will do with this URL. */
  libraryPath: 'stream (native FFmpeg)' | 'full download into JS ArrayBuffer';
}

export async function probeRanges(url: string, headers: Record<string, string>): Promise<RangeProbe> {
  const r: RangeProbe = {
    headStatus: '-',
    acceptRanges: '',
    contentType: '',
    contentLength: '',
    rangeStatus: '-',
    libraryPath: 'full download into JS ArrayBuffer',
  };
  try {
    const head = await fetch(url, { method: 'HEAD', headers });
    r.headStatus = head.status;
    r.acceptRanges = head.headers.get('Accept-Ranges') ?? '';
    r.contentType = head.headers.get('Content-Type') ?? '';
    r.contentLength = head.headers.get('Content-Length') ?? '';
    if (r.acceptRanges.toLowerCase() === 'bytes') r.libraryPath = 'stream (native FFmpeg)';
  } catch (e) {
    r.headStatus = `error ${String(e).slice(0, 60)}`;
  }
  try {
    const range = await fetch(url, { headers: { ...headers, Range: 'bytes=0-0' } });
    r.rangeStatus = range.status;
    if (range.status === 206) r.libraryPath = 'stream (native FFmpeg)';
  } catch (e) {
    r.rangeStatus = `error ${String(e).slice(0, 60)}`;
  }
  return r;
}

const CACHE_DIR_NAME = 'bb-stream-cache';
const KEEP_FILES = 4;

function cacheDir(): Directory {
  const dir = new Directory(Paths.cache, CACHE_DIR_NAME);
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}

/** Native download to disk (no JS memory). Keeps the newest KEEP_FILES files. */
export async function downloadToCache(
  url: string,
  headers: Record<string, string>,
  name: string,
): Promise<{ uri: string; bytes: number; ms: number }> {
  const t0 = Date.now();
  const dir = cacheDir();
  const target = new File(dir, `${name.replace(/[^A-Za-z0-9_-]/g, '_')}.m4a`);
  const file = await File.downloadFileAsync(url, target, { headers, idempotent: true });
  const bytes = file.size ?? 0;
  pruneCache(dir, file.uri);
  return { uri: file.uri, bytes, ms: Date.now() - t0 };
}

function pruneCache(dir: Directory, keepUri: string) {
  try {
    const files = dir
      .list()
      .filter((e): e is File => e instanceof File)
      .sort((a, b) => (b.modificationTime ?? 0) - (a.modificationTime ?? 0));
    for (const f of files.slice(KEEP_FILES)) {
      if (f.uri !== keepUri) f.delete();
    }
  } catch (e) {
    eventLog.warn('cache', 'prune failed', e);
  }
}

export async function fetchYouTubeFormats(videoId: string): Promise<{ formats: StreamFormat[]; headersFor: (url: string) => Record<string, string> }> {
  const config = BUNDLED_CLIENTS_CONFIG;
  const client = config.player.find((p) => p.enabled)!;
  const visitor = await getVisitorData(platform, config);
  const res = await platform.fetch(playerUrl(client), {
    method: 'POST',
    headers: buildPlayerHeaders(client, visitor),
    body: buildPlayerBody(client, videoId, config, visitor),
    timeoutMs: config.timeouts.playerMs,
  });
  if (!res.ok) throw new Error(`player HTTP ${res.status}`);
  const info = parsePlayerResponse(await res.json());
  return {
    formats: info.formats,
    headersFor: (url) => ({ 'User-Agent': googlevideoUserAgentFor(config, url.match(/[?&]c=([A-Z_]+)/)?.[1] ?? client.clientName) }),
  };
}
