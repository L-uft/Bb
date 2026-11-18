/** Stream resolution contracts (PLAN.md D6, D7). */
import type { AudioQuality } from '../youtube/clientsConfig';

/** What to resolve. SoundCloud joins in v1.1. */
export type TrackRef = { source: 'youtube'; id: string };

export interface ResolvedStream {
  url: string;
  /** Headers the player must send when fetching `url` (e.g. the googlevideo User-Agent). */
  headers: Record<string, string>;
  mimeType: string;
  itag?: number;
  bitrate?: number;
  contentLength?: number;
  approxDurationMs?: number;
  /** Which client profile produced the URL, for logs. */
  client: string;
  resolvedAt: number;
  /** min(the URL's expire= param, resolvedAt + 5 h). */
  expiresAt: number;
  title?: string;
  author?: string;
}

export interface ResolveOptions {
  quality?: AudioQuality;
  /** Restrict to these client profile names (diagnostics). */
  clients?: string[];
}

export interface StreamResolver {
  readonly kind: 'on-device' | 'remote';
  resolve(track: TrackRef, opts?: ResolveOptions): Promise<ResolvedStream>;
}

/** D6: a stream URL is never reused once it is older than this. */
export const MAX_STREAM_AGE_MS = 5 * 60 * 60 * 1000;

export class ResolveError extends Error {
  constructor(readonly trackId: string, readonly attempts: { client: string; error: string }[]) {
    super(`could not resolve ${trackId}: ${attempts.map((a) => `${a.client}: ${a.error}`).join('; ') || 'no clients'}`);
    this.name = 'ResolveError';
  }
}
