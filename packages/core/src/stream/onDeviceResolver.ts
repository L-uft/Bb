/**
 * OnDeviceResolver: resolves YouTube audio on the phone through InnerTube,
 * with no yt-dlp. All client profiles are tried in parallel; the first one whose
 * URL passes the range probe wins (same strategy as the desktop).
 */
import type { Platform } from '../platform/types';
import { errorMessage, firstFulfilled, AllFailedError } from '../util/async';
import { getQueryParam } from '../util/url';
import { type ClientsConfig, type PlayerClient, googlevideoUserAgentFor } from '../youtube/clientsConfig';
import {
  buildPlayerBody,
  buildPlayerHeaders,
  extractVideoId,
  parsePlayerResponse,
  pickAudioFormat,
  playerUrl,
} from '../youtube/player';
import { getVisitorData } from '../youtube/visitorData';
import { computeExpiresAt, probeStream } from './probe';
import { ResolveError, type ResolveOptions, type ResolvedStream, type StreamResolver, type TrackRef } from './types';

export interface OnDeviceResolverOptions {
  /** Returns the active clients config (bundled, remote or cached; see D15). */
  getConfig: () => ClientsConfig;
  /** Probe each URL before returning it (default true). */
  verify?: boolean;
}

export class OnDeviceResolver implements StreamResolver {
  readonly kind = 'on-device' as const;

  constructor(private readonly platform: Platform, private readonly opts: OnDeviceResolverOptions) {}

  async resolve(track: TrackRef, opts: ResolveOptions = {}): Promise<ResolvedStream> {
    const videoId = extractVideoId(track.id);
    if (!videoId) throw new ResolveError(track.id, [{ client: '-', error: 'not a YouTube video id' }]);
    const config = this.opts.getConfig();
    const clients = config.player.filter((c) => c.enabled && (!opts.clients || opts.clients.includes(c.name)));
    if (clients.length === 0) throw new ResolveError(videoId, []);

    const visitorData = await getVisitorData(this.platform, config);
    const started = this.platform.now();
    const attempts = clients.map((c) => this.attempt(c, videoId, visitorData, config, opts));
    try {
      const stream = await firstFulfilled(attempts);
      this.platform.logger.info(
        'stream',
        `resolved ${videoId} via ${stream.client} itag ${stream.itag ?? '?'} in ${this.platform.now() - started} ms`,
      );
      return stream;
    } catch (e) {
      const reasons = e instanceof AllFailedError ? e.reasons : [e];
      const err = new ResolveError(
        videoId,
        clients.map((c, i) => ({ client: c.name, error: errorMessage(reasons[i]) })),
      );
      this.platform.logger.error('stream', err.message);
      throw err;
    }
  }

  private async attempt(
    client: PlayerClient,
    videoId: string,
    visitorData: string,
    config: ClientsConfig,
    opts: ResolveOptions,
  ): Promise<ResolvedStream> {
    const res = await this.platform.fetch(playerUrl(client), {
      method: 'POST',
      headers: buildPlayerHeaders(client, visitorData),
      body: buildPlayerBody(client, videoId, config, visitorData),
      timeoutMs: config.timeouts.playerMs,
    });
    if (!res.ok) throw new Error(`player HTTP ${res.status}`);
    const info = parsePlayerResponse(await res.json());
    const format = pickAudioFormat(info.formats, config.itags[opts.quality ?? 'standard']);
    if (!format) throw new Error(`no playable audio format (${info.formats.length} direct formats)`);

    const headers = { 'User-Agent': googlevideoUserAgentFor(config, getQueryParam(format.url, 'c') ?? client.clientName) };
    if (this.opts.verify !== false) {
      const probe = await probeStream(this.platform, format.url, headers, config.timeouts.probeMs);
      if (!probe.ok) throw new Error(`probe ${probe.status || probe.error}`);
    }
    const resolvedAt = this.platform.now();
    return {
      url: format.url,
      headers,
      mimeType: format.mimeType,
      itag: format.itag,
      bitrate: format.bitrate,
      contentLength: format.contentLength,
      approxDurationMs: format.approxDurationMs,
      client: client.name,
      resolvedAt,
      expiresAt: computeExpiresAt(format.url, resolvedAt),
      title: info.title,
      author: info.author,
    };
  }
}
