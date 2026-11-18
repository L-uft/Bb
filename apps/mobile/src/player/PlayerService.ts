// PlayerService (spike S2): the single owner of the AudioContext, the <Audio> tag
// handle, the processing graph, the queue and the lock-screen / remote wiring.
// UI code only calls these methods and reads the store; it never touches audio nodes.
import {
  BUNDLED_CLIENTS_CONFIG,
  OnDeviceResolver,
  errorMessage,
  isStreamExpired,
  type ResolvedStream,
} from '@bb/core';
import type { ComponentRef } from 'react';
import {
  type Audio,
  AudioContext,
  AudioManager,
  MediaElementAudioSourceNode,
  PlaybackNotificationManager,
} from 'react-native-audio-api';
import DeviceInfo from 'react-native-device-info';
import { createStore } from 'zustand/vanilla';
import { eventLog } from '../log/eventLog';
import { platform } from '../platform/rnPlatform';
import { AudioGraph, createEqSlot, type EqSlot } from './graph';

type AudioHandle = ComponentRef<typeof Audio>;

export type PlayerStatus = 'idle' | 'resolving' | 'loading' | 'playing' | 'paused' | 'buffering' | 'error';

export interface TrackInfo {
  id: string;
  title: string;
  artist: string;
}

export interface Measurement {
  trackId: string;
  tapAt: number;
  resolvedAt?: number;
  loadedAt?: number;
  playingAt?: number;
  prefetched: boolean;
  client?: string;
  itag?: number;
  kbps?: number;
  sizeMB?: number;
}

export interface PlayerState {
  status: PlayerStatus;
  track?: TrackInfo;
  index: number;
  source?: { uri: string; headers: Record<string, string> };
  sourceKey: number;
  position: number;
  duration: number;
  error?: string;
  current?: Measurement;
  history: Measurement[];
  memory: { trackStartMB?: number; nowMB?: number; peakMB?: number };
  masterMuted: boolean;
  graph: string;
}

export const TEST_TRACKS: TrackInfo[] = [
  { id: 'dQw4w9WgXcQ', title: 'Never Gonna Give You Up', artist: 'Rick Astley' },
  { id: 'kJQP7kiw5Fk', title: 'Despacito', artist: 'Luis Fonsi' },
  { id: 'fJ9rUzIMcZQ', title: 'Bohemian Rhapsody', artist: 'Queen' },
];

const artworkFor = (id: string) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
const MB = 1048576;

class PlayerServiceImpl {
  readonly store = createStore<PlayerState>(() => ({
    status: 'idle',
    index: 0,
    sourceKey: 0,
    position: 0,
    duration: 0,
    history: [],
    memory: {},
    masterMuted: false,
    graph: '',
  }));

  private ctx: AudioContext | null = null;
  private graph: AudioGraph | null = null;
  private handle: AudioHandle | null = null;
  private sourceNode: MediaElementAudioSourceNode | null = null;
  private queue: TrackInfo[] = TEST_TRACKS;
  private readonly resolver = new OnDeviceResolver(platform, { getConfig: () => BUNDLED_CLIENTS_CONFIG });
  private readonly prefetched = new Map<string, ResolvedStream>();
  private retriedForKey = -1;
  private resumeAfterInterruption = false;
  private initialized = false;
  private lastPositionPush = 0;

  // ---------- setup ----------

  ensureContext(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.graph = new AudioGraph(this.ctx);
      this.graph.addSlot(createEqSlot(this.ctx));
      this.set({ graph: this.graph.describe() });
      eventLog.info('audio', `AudioContext ${this.ctx.sampleRate} Hz; graph: ${this.graph.describe()}`);
    }
    return this.ctx;
  }

  attachHandle(h: AudioHandle | null) {
    this.handle = h;
  }

  get eq(): EqSlot | undefined {
    return this.graph?.getSlot<EqSlot>('eq10');
  }

  init() {
    if (this.initialized) return;
    this.initialized = true;
    try {
      AudioManager.setSystemOptions({ ios: { category: 'playback', mode: 'default' } });
      AudioManager.observeAudioInterruptions(true);
      AudioManager.addSystemEventListener('interruption', (e) => this.onInterruption(e.type, e.shouldResume));
      AudioManager.addSystemEventListener('routeChange', (e) => this.onRouteChange(e.reason));
    } catch (e) {
      eventLog.error('session', 'audio session setup failed', e);
    }
    const n = PlaybackNotificationManager;
    n.addEventListener('playbackNotificationPlay', () => this.remote('play', () => this.play()));
    n.addEventListener('playbackNotificationPause', () => this.remote('pause', () => this.pause()));
    n.addEventListener('playbackNotificationNextTrack', () => this.remote('next', () => this.next()));
    n.addEventListener('playbackNotificationPreviousTrack', () => this.remote('previous', () => this.previous()));
    n.addEventListener('playbackNotificationSeekTo', (e) => this.remote(`seekTo ${Math.round(e.value)}s`, () => this.seekTo(e.value)));
    n.addEventListener('playbackNotificationStop', () => this.remote('stop', () => this.pause()));
    this.startMemorySampler();
    eventLog.info('player', 'initialized (session: playback, interruptions observed)');
  }

  // ---------- commands ----------

  playIndex(index: number) {
    const track = this.queue[index];
    if (track) void this.load(track, index);
  }

  playCustom(id: string) {
    const track = { id, title: id, artist: 'YouTube' };
    this.queue = [...TEST_TRACKS, track];
    void this.load(track, this.queue.length - 1);
  }

  play() {
    if (!this.handle) return;
    void this.ctx?.resume();
    this.handle.play();
  }

  pause() {
    this.handle?.pause();
  }

  toggle() {
    const s = this.get().status;
    if (s === 'playing' || s === 'buffering') this.pause();
    else if (s === 'paused') this.play();
    else if (s === 'idle' || s === 'error') this.playIndex(this.get().index);
  }

  next() {
    this.playIndex((this.get().index + 1) % this.queue.length);
  }

  previous() {
    if (this.get().position > 3) return this.seekTo(0);
    this.playIndex((this.get().index - 1 + this.queue.length) % this.queue.length);
  }

  seekTo(seconds: number) {
    const t = Math.max(0, Math.min(seconds, this.get().duration || seconds));
    this.handle?.seekToTime(t);
    this.set({ position: t });
    this.updateNotification();
  }

  seekBy(delta: number) {
    this.seekTo(this.get().position + delta);
  }

  setMasterMuted(muted: boolean) {
    if (this.graph) this.graph.master.gain.value = muted ? 0 : 1;
    this.set({ masterMuted: muted });
    eventLog.info('graph', muted ? 'master gain → 0 (output should go silent)' : 'master gain → 1');
  }

  readLevel(): number {
    try {
      return this.graph?.readLevel() ?? 0;
    } catch {
      return 0;
    }
  }

  // ---------- loading ----------

  private async load(track: TrackInfo, index: number) {
    const tapAt = Date.now();
    this.set({
      status: 'resolving',
      track,
      index,
      position: 0,
      duration: 0,
      error: undefined,
      current: { trackId: track.id, tapAt, prefetched: false },
    });
    eventLog.info('player', `tap → ${track.title} (${track.id})`);
    try {
      this.ensureContext();
      await AudioManager.setAudioSessionActivity(true).catch((e) => eventLog.warn('session', 'activate failed', e));
      const cached = this.prefetched.get(track.id);
      const fresh = cached && !isStreamExpired(cached, Date.now()) ? cached : undefined;
      this.prefetched.delete(track.id);
      const stream = fresh ?? (await this.resolver.resolve({ source: 'youtube', id: track.id }));
      if (this.get().track?.id !== track.id) return; // user moved on meanwhile
      this.applyStream(track, stream, !!fresh);
    } catch (e) {
      this.fail(`resolve failed: ${errorMessage(e)}`);
    }
  }

  private applyStream(track: TrackInfo, stream: ResolvedStream, prefetched: boolean) {
    const cur = this.get().current;
    const titled =
      stream.title && track.title === track.id ? { ...track, title: stream.title, artist: stream.author ?? track.artist } : track;
    this.set({
      status: 'loading',
      track: titled,
      source: { uri: stream.url, headers: stream.headers },
      sourceKey: this.get().sourceKey + 1,
      duration: (stream.approxDurationMs ?? 0) / 1000,
      current: cur && {
        ...cur,
        resolvedAt: Date.now(),
        prefetched,
        client: stream.client,
        itag: stream.itag,
        kbps: stream.bitrate ? Math.round(stream.bitrate / 1000) : undefined,
        sizeMB: stream.contentLength ? +(stream.contentLength / MB).toFixed(2) : undefined,
      },
    });
    eventLog.info(
      'stream',
      `${prefetched ? 'prefetched' : 'resolved'} ${track.id}: ${stream.client} itag ${stream.itag} ${stream.mimeType.split(';')[0]}, valid ${((stream.expiresAt - Date.now()) / 3600000).toFixed(1)} h`,
    );
  }

  // ---------- <Audio> callbacks (wired by PlayerHost) ----------

  onLoad() {
    const ctx = this.ctx;
    if (!ctx || !this.handle || !this.graph) return;
    const cur = this.get().current;
    this.set({ current: cur && { ...cur, loadedAt: Date.now() } });
    try {
      this.sourceNode = new MediaElementAudioSourceNode(ctx, { mediaElement: this.handle });
      this.graph.setSource(this.sourceNode);
      eventLog.info('audio', `loaded; ${this.graph.describe()}`);
    } catch (e) {
      eventLog.error('audio', 'MediaElementAudioSourceNode failed (audio would bypass the graph)', e);
    }
    void ctx.resume();
    this.handle.play();
    void this.recordMemory('track start');
  }

  onPlaying() {
    const st = this.get();
    const cur = st.current;
    if (cur && !cur.playingAt) {
      const m = { ...cur, playingAt: Date.now() };
      this.set({ current: m, history: [m, ...st.history].slice(0, 10) });
      eventLog.info(
        'metrics',
        `first sound ${m.playingAt - m.tapAt} ms (resolve ${(m.resolvedAt ?? m.tapAt) - m.tapAt}, load ${(m.loadedAt ?? 0) - (m.resolvedAt ?? 0)}, start ${m.playingAt - (m.loadedAt ?? m.playingAt)})${m.prefetched ? ' [prefetched]' : ''}`,
      );
      void this.prefetchNext();
    }
    this.set({ status: 'playing' });
    this.updateNotification();
  }

  onPause() {
    if (this.get().status === 'loading' || this.get().status === 'resolving') return;
    this.set({ status: 'paused' });
    this.updateNotification();
  }

  onWaiting() {
    this.set({ status: 'buffering' });
    eventLog.debug('audio', 'buffering');
  }

  onPosition(seconds: number) {
    const now = Date.now();
    if (now - this.lastPositionPush < 500) return;
    this.lastPositionPush = now;
    this.set({ position: seconds });
  }

  onEnded() {
    eventLog.info('player', 'track ended → next');
    this.next();
  }

  onError(err: Error) {
    const key = this.get().sourceKey;
    const track = this.get().track;
    eventLog.error('audio', `<Audio> error: ${err.message}`);
    // D6: re-resolve once on a playback error (e.g. 403 / expired URL), then give up.
    if (track && this.retriedForKey !== key) {
      this.retriedForKey = key + 1; // the retry gets the next sourceKey
      this.prefetched.delete(track.id);
      eventLog.warn('stream', 're-resolving once after playback error');
      void this.resolver
        .resolve({ source: 'youtube', id: track.id })
        .then((s) => this.applyStream(track, s, false))
        .catch((e) => this.fail(`retry failed: ${errorMessage(e)}`));
      return;
    }
    this.fail(err.message);
  }

  // ---------- system events ----------

  private remote(name: string, action: () => void) {
    eventLog.info('remote', name);
    action();
  }

  private onInterruption(type: 'began' | 'ended', shouldResume: boolean) {
    if (type === 'began') {
      const s = this.get().status;
      this.resumeAfterInterruption = s === 'playing' || s === 'buffering';
      eventLog.warn('session', `interruption began (was playing: ${this.resumeAfterInterruption})`);
      this.set({ status: 'paused' });
      this.updateNotification();
    } else {
      eventLog.info('session', `interruption ended (shouldResume: ${shouldResume})`);
      if (shouldResume && this.resumeAfterInterruption) {
        void AudioManager.setAudioSessionActivity(true)
          .catch((e) => eventLog.warn('session', 'reactivate failed', e))
          .then(() => this.play());
      }
      this.resumeAfterInterruption = false;
    }
  }

  private onRouteChange(reason: string) {
    eventLog.info('session', `route change: ${reason}`);
    // iOS convention: pause when headphones / AirPods are removed.
    if (reason === 'OldDeviceUnavailable' && this.get().status === 'playing') this.pause();
  }

  // ---------- lock screen ----------

  private updateNotification() {
    const { track, status, duration, position } = this.get();
    if (!track) return;
    const playing = status === 'playing' || status === 'buffering';
    PlaybackNotificationManager.show({
      title: track.title,
      artist: track.artist,
      artwork: artworkFor(track.id),
      duration: duration || undefined,
      elapsedTime: position,
      speed: playing ? 1 : 0,
      state: playing ? 'playing' : 'paused',
    })
      .then(() => this.enableControlsOnce())
      .catch((e) => eventLog.error('lockscreen', 'show failed', e));
  }

  private controlsEnabled = false;
  private async enableControlsOnce() {
    if (this.controlsEnabled) return;
    this.controlsEnabled = true;
    const n = PlaybackNotificationManager;
    for (const c of ['play', 'pause', 'nextTrack', 'previousTrack', 'seekTo'] as const) await n.enableControl(c, true);
    for (const c of ['skipForward', 'skipBackward'] as const) await n.enableControl(c, false);
    eventLog.info('lockscreen', 'controls enabled: play, pause, next, previous, seek');
  }

  // ---------- prefetch + memory ----------

  private async prefetchNext() {
    const next = this.queue[(this.get().index + 1) % this.queue.length];
    if (!next || next.id === this.get().track?.id) return;
    const have = this.prefetched.get(next.id);
    if (have && !isStreamExpired(have, Date.now())) return;
    try {
      this.prefetched.set(next.id, await this.resolver.resolve({ source: 'youtube', id: next.id }));
      eventLog.debug('stream', `prefetched next: ${next.id}`);
    } catch (e) {
      eventLog.warn('stream', `prefetch failed for ${next.id}`, errorMessage(e));
    }
  }

  private startMemorySampler() {
    let ticks = 0;
    setInterval(() => {
      ticks++;
      void this.recordMemory(ticks % 6 === 0 ? 'sample' : undefined);
    }, 10_000);
  }

  private async recordMemory(label?: string) {
    try {
      const mb = +((await DeviceInfo.getUsedMemory()) / MB).toFixed(1);
      const m = this.get().memory;
      const memory = {
        trackStartMB: label === 'track start' ? mb : m.trackStartMB,
        nowMB: mb,
        peakMB: Math.max(m.peakMB ?? 0, mb),
      };
      this.set({ memory });
      if (label) eventLog.info('memory', `${label}: ${mb} MB (peak ${memory.peakMB} MB)`);
    } catch (e) {
      eventLog.warn('memory', 'read failed', e);
    }
  }

  // ---------- helpers ----------

  private fail(message: string) {
    this.set({ status: 'error', error: message });
    eventLog.error('player', message);
  }

  private get() {
    return this.store.getState();
  }

  private set(patch: Partial<PlayerState>) {
    this.store.setState(patch);
  }
}

export const PlayerService = new PlayerServiceImpl();
