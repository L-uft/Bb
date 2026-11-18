/**
 * InnerTube /youtubei/v1/player request + response parsing.
 * Ported from Riff server.js fetchDirectYoutubeStreamServer / extractAudioFromPlayerResponse
 * (baseline rootscripts/riff@4569e7d, L1115-L1263).
 */
import type { ClientsConfig, PlayerClient } from './clientsConfig';

export interface StreamFormat {
  itag: number;
  url: string;
  mimeType: string;
  bitrate?: number;
  contentLength?: number;
  approxDurationMs?: number;
  audioOnly: boolean;
}

export interface PlayerInfo {
  formats: StreamFormat[];
  title?: string;
  author?: string;
  lengthSeconds?: number;
}

export class PlayabilityError extends Error {
  constructor(readonly status: string, readonly reason?: string) {
    super(`playability: ${status}${reason ? ` (${reason})` : ''}`);
    this.name = 'PlayabilityError';
  }
}

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

/** Accepts a bare 11-char id or any common YouTube URL form. Returns '' if none found. */
export function extractVideoId(input: string): string {
  const s = String(input ?? '').trim();
  if (VIDEO_ID.test(s)) return s;
  const m = s.match(/(?:v=|youtu\.be\/|\/embed\/|\/v\/|\/shorts\/)([A-Za-z0-9_-]{11})/);
  return m?.[1] ?? '';
}

export function playerUrl(client: PlayerClient): string {
  return `https://${client.host}/youtubei/v1/player?prettyPrint=false`;
}

export function buildPlayerBody(client: PlayerClient, videoId: string, config: ClientsConfig, visitorData: string): string {
  const c: Record<string, string | number> = {
    clientName: client.clientName,
    clientVersion: client.clientVersion,
    hl: config.locale.hl,
    gl: config.locale.gl,
  };
  if (visitorData) c.visitorData = visitorData;
  if (client.androidSdkVersion !== undefined) c.androidSdkVersion = client.androidSdkVersion;
  if (client.deviceMake) c.deviceMake = client.deviceMake;
  if (client.deviceModel) c.deviceModel = client.deviceModel;
  if (client.osName) c.osName = client.osName;
  if (client.osVersion) c.osVersion = client.osVersion;
  return JSON.stringify({ videoId, context: { client: c }, contentCheckOk: true, racyCheckOk: true });
}

export function buildPlayerHeaders(client: PlayerClient, visitorData: string): Record<string, string> {
  const h: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': client.userAgent,
    'X-Goog-Api-Format-Version': '2',
  };
  if (visitorData) h['X-Goog-Visitor-Id'] = visitorData;
  return h;
}

function num(v: unknown): number | undefined {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : undefined;
}

type RawFormat = Record<string, unknown>;

/** Parses a player response. Throws PlayabilityError when the video is not playable. */
export function parsePlayerResponse(data: unknown): PlayerInfo {
  const d = (data ?? {}) as Record<string, unknown>;
  const ps = d.playabilityStatus as { status?: string; reason?: string } | undefined;
  if (ps && ps.status !== 'OK') throw new PlayabilityError(ps.status ?? 'UNPLAYABLE', ps.reason);

  const sd = (d.streamingData ?? {}) as { adaptiveFormats?: RawFormat[]; formats?: RawFormat[] };
  const raw: RawFormat[] = [...(sd.adaptiveFormats ?? []), ...(sd.formats ?? [])];
  const formats: StreamFormat[] = [];
  for (const f of raw) {
    // Only formats with a direct URL; ciphered ones would need the player JS (not ported).
    if (!f || typeof f.url !== 'string' || f.signatureCipher || f.cipher) continue;
    const mimeType = typeof f.mimeType === 'string' ? f.mimeType : '';
    const itag = num(f.itag);
    if (!itag || !mimeType) continue;
    formats.push({
      itag,
      url: f.url,
      mimeType,
      bitrate: num(f.bitrate),
      contentLength: num(f.contentLength),
      approxDurationMs: num(f.approxDurationMs),
      audioOnly: mimeType.startsWith('audio/'),
    });
  }
  const vd = (d.videoDetails ?? {}) as { title?: string; author?: string; lengthSeconds?: string };
  return { formats, title: vd.title, author: vd.author, lengthSeconds: num(vd.lengthSeconds) };
}

/**
 * Chooses the audio format to play. Order: the preferred itags in order (AAC first,
 * which iOS decodes natively), then the best other audio/mp4, then itag 18 (muxed mp4).
 * WebM/Opus is never picked here.
 */
export function pickAudioFormat(formats: StreamFormat[], preferredItags: readonly number[]): StreamFormat | undefined {
  for (const itag of preferredItags) {
    const f = formats.find((x) => x.itag === itag && x.audioOnly);
    if (f) return f;
  }
  const mp4 = formats
    .filter((x) => x.audioOnly && /mp4|m4a/.test(x.mimeType))
    .sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0));
  if (mp4[0]) return mp4[0];
  return formats.find((x) => x.itag === 18);
}
