export type { Platform, PlatformFetchInit, Logger, KeyValueStore } from './platform/types';
export { firstFulfilled, AllFailedError, errorMessage } from './util/async';
export { getQueryParam, hostOf } from './util/url';

export {
  REMOTE_CLIENTS_CONFIG_URL,
  BUNDLED_CLIENTS_CONFIG,
  ClientsConfigSchema,
  parseClientsConfig,
  googlevideoUserAgentFor,
  type ClientsConfig,
  type PlayerClient,
  type AudioQuality,
} from './youtube/clientsConfig';
export {
  extractVideoId,
  parsePlayerResponse,
  pickAudioFormat,
  buildPlayerBody,
  buildPlayerHeaders,
  playerUrl,
  PlayabilityError,
  type StreamFormat,
  type PlayerInfo,
} from './youtube/player';
export { getVisitorData, clearVisitorDataCache } from './youtube/visitorData';

export {
  MAX_STREAM_AGE_MS,
  ResolveError,
  type TrackRef,
  type ResolvedStream,
  type ResolveOptions,
  type StreamResolver,
} from './stream/types';
export { probeStream, computeExpiresAt, isStreamExpired, type ProbeResult } from './stream/probe';
export { OnDeviceResolver, type OnDeviceResolverOptions } from './stream/onDeviceResolver';
