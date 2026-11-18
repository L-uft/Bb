// PlayerService (spike S2): the single owner of the AudioContext, the <Audio> tag
// handle, the processing graph, the queue and the lock-screen / remote wiring.
// UI code only calls these methods and reads the store; it never touches audio nodes.
//
// S2 round 2 (after the first device run):
//  - "first sound" = first analyser RMS above a threshold (real audio), plus the first
//    position tick, both measured from the tap. onPlay only means play() was called.
//  - every state change, the context state and the position every 5 s are logged.
//  - the previous source is released on every track change (native stop + gc if available).
//  - two strategies: "stream" (native FFmpeg range streaming) and "file" (native download
//    to disk, then play the file through the same graph). With auto-fallback on, a stream
//    that produces no audio within NO_AUDIO_MS is retried once as "file".
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
import { downloadToCache } from './sources';

type AudioHandle = ComponentRef<typeof Audio>;
type NativeFileSource = { stop?: (when: number) => void; pause?: () => void };
type InternalHandle = AudioHandle & { getFileSourceNode?: () => NativeFileSource | null };

export type PlayerStatus = 'idle' | 'resolving' | 'preparing' | 'loading' | 'playing' | 'paused' | 'buffering' | 'error';
export type Strategy = 'stream' | 'file';

export interface TrackInfo {
  id: string;
  title: string;
  artist: string;
}

export interface Measurement {
  trackId: string;
  strategy: Strategy;
  fallback: boolean;
  tapAt: number;
  resolvedAt?: number;
  preparedAt?: number;
  loadedAt?: number;
  playCalledAt?: number;
  firstRmsAt?: number;
  firstTickAt?: number;
  prefetched: boolean;
  client?: string;
  itag?: number;
  kbps?: number;
  sizeMB?: number;
  noAudio?: boolean;
}

export interface PlayerState {
  status: PlayerStatus;
  track?: TrackInfo;
  index: number;
  source?: { uri: string; headers?: Record<string, string> };
  sourceKey: number;
  position: number;
  duration: number;
  error?: string;
  current?: Measurement;
  history: Measurement[];
  memory: { trackStartMB?: number; nowMB?: number; peakMB?: number };
  masterMuted: boolean;
  graph: string;
  strategy: Strategy;
  autoFallback: boolean;
  rapidTest?: string;
}

export const TEST_TRACKS: TrackInfo[] = [
  { id: 'dQw4w9WgXcQ', title: 'Never Gonna Give You Up', artist: 'Rick Astley' },
  { id: 'kJQP7kiw5Fk', title: 'Despacito', artist: 'Luis Fonsi' },
  { id: 'fJ9rUzIMcZQ', title: 'Bohemian Rhapsody', artist: 'Queen' },
];

const artworkFor = (id: string) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
const MB = 1048576;
const RMS_THRESHOLD = 0.003;
const NO_AUDIO_MS = 8000;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function gcIfAvailable(): boolean {
  const gc = (globalThis as { gc?: () => void }).gc;
  if (typeof gc === 'function') {
    try {
      gc();
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

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
    strategy: 'stream',
    autoFallback: true,
  }));

  private ctx: AudioContext | null = null;
  private graph: AudioGraph | null = null;
  private handle: InternalHandle | null = null;
  private sourceNode: MediaElementAudioSourceNode | null = null;
  private nativeSource: NativeFileSource | null = null;
  private queue: TrackInfo[] = TEST_TRACKS;
  private readonly resolver = new OnDeviceResolver(platform, { getConfig: () => BUNDLED_CLIENTS_CONFIG });
  private readonly prefetched = new Map<string, ResolvedStream>();
  private retriedForKey = -1;
  private resumeAfterInterruption = false;
  private initialized = false;
  private lastPositionPush = 0;
  private lastPositionLog = 0;
  private watcher: ReturnType<typeof setInterval> | null = null;
  private loadSeq = 0;

  // ---------- setup ----------

  /** The context, once created (lazily, after the audio session is configured and active). */
  get context(): AudioContext | null {
    return this.ctx;
  }

  ensureContext(): AudioContext {
    if (!this.ctx) {
      const ctx = new AudioContext();
      ctx.onstatechange = () => eventLog.info('audio', `context state → ${ctx.state}`);
      ctx.onerror = () => eventLog.error('audio', 'AudioContext error');
      this.ctx = ctx;
      this.graph = new AudioGraph(ctx);
      this.graph.addSlot(createEqSlot(ctx));
      this.set({ graph: this.graph.describe() });
      eventLog.info('audio', `AudioContext created: ${ctx.sampleRate} Hz, state ${ctx.state}; graph: ${this.graph.describe()}`);
      eventLog.info('audio', `global gc(): ${typeof (globalThis as { gc?: unknown }).gc === 'function' ? 'available' : 'not available'}`);
    }
    return this.ctx;
  }

  /** Closes and recreates the context + graph (used once if a context never reaches 'running'). */
  private async rebuildContext() {
    const old = this.ctx;
    this.ctx = null;
    this.graph = null;
    this.sourceNode = null;
    this.set({ sourceKey: this.get().sourceKey + 1, source: undefined });
    try {
      await old?.close();
    } catch (e) {
      eventLog.warn('audio', 'close old context failed', e);
    }
    await AudioManager.setAudioSessionActivity(true).catch((e) => eventLog.warn('session', 'activate failed', e));
    const ctx = this.ensureContext();
    await ctx.resume().catch(() => {});
    eventLog.warn('audio', `context rebuilt; state ${ctx.state}`);
  }

  private contextRebuilt = false;

  attachHandle(h: AudioHandle | null) {
    this.handle = h as InternalHandle | null;
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

  // ---------- settings ----------

  setStrategy(strategy: Strategy) {
    this.set({ strategy });
    eventLog.info('player', `strategy → ${strategy}`);
  }

  setAutoFallback(on: boolean) {
    this.set({ autoFallback: on });
    eventLog.info('player', `auto-fallback → ${on}`);
  }

  // ---------- commands ----------

  playIndex(index: number) {
    const track = this.queue[index];
    if (track) void this.load(track, index, this.get().strategy, false);
  }

  playCustom(id: string) {
    const track = { id, title: id, artist: 'YouTube' };
    this.queue = [...TEST_TRACKS, track];
    void this.load(track, this.queue.length - 1, this.get().strategy, false);
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
    eventLog.info('player', `seek → ${t.toFixed(1)} s`);
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

  /** Requested test: 10 rapid track changes, memory logged after each, then a settle reading. */
  async rapidChangeTest() {
    if (this.get().rapidTest) return;
    const readings: number[] = [];
    const start = await this.readMemoryMB();
    eventLog.info('rapid', `start: ${start} MB`);
    for (let i = 0; i < 10; i++) {
      this.set({ rapidTest: `change ${i + 1}/10…` });
      const before = this.get().sourceKey;
      this.playIndex(i % TEST_TRACKS.length);
      for (let w = 0; w < 60 && !(this.get().sourceKey > before && this.get().current?.loadedAt); w++) await sleep(100);
      await sleep(1500);
      const mb = await this.readMemoryMB();
      readings.push(mb);
      eventLog.info('rapid', `after change ${i + 1}/10: ${mb} MB (${(mb - start >= 0 ? '+' : '') + (mb - start).toFixed(1)} vs start)`);
    }
    this.pause();
    this.set({ rapidTest: 'settling 8 s…' });
    await sleep(8000);
    const gc = gcIfAvailable();
    await sleep(500);
    const settled = await this.readMemoryMB();
    const last5 = readings.slice(5);
    const slope = last5.length > 1 ? (last5[last5.length - 1]! - last5[0]!) / (last5.length - 1) : 0;
    const verdict = Math.abs(slope) < 1.5 ? 'PLATEAU' : 'STILL GROWING';
    const summary = `start ${start} MB → after 10 changes ${readings[9]} MB → settled ${settled} MB (gc ${gc ? 'run' : 'n/a'}); changes 6-10 slope ${slope.toFixed(2)} MB/change → ${verdict}`;
    eventLog.info('rapid', summary);
    this.set({ rapidTest: undefined });
  }

  // ---------- loading ----------

  private async load(track: TrackInfo, index: number, strategy: Strategy, fallback: boolean) {
    const seq = ++this.loadSeq;
    const tapAt = Date.now();
    // Status first: releasePrevious() pauses the old tag, and onPause ignores 'resolving'.
    this.set({
      status: 'resolving',
      track,
      index,
      position: 0,
      duration: 0,
      error: undefined,
      current: { trackId: track.id, tapAt, prefetched: false, strategy, fallback },
    });
    this.releasePrevious();
    eventLog.info('player', `tap → ${track.title} (${track.id}) [${strategy}${fallback ? ', fallback' : ''}]`);
    try {
      // Order matters (S2 round 2): session category set in init() → activate → THEN create the context.
      await AudioManager.setAudioSessionActivity(true).catch((e) => eventLog.warn('session', 'activate failed', e));
      const ctx = this.ensureContext();
      if (ctx.state !== 'running') {
        await ctx.resume().catch((e) => eventLog.warn('audio', 'resume failed', e));
        eventLog.info('audio', `context state before load: ${ctx.state}`);
      }
      const cached = this.prefetched.get(track.id);
      const fresh = cached && !isStreamExpired(cached, Date.now()) ? cached : undefined;
      this.prefetched.delete(track.id);
      const stream = fresh ?? (await this.resolver.resolve({ source: 'youtube', id: track.id }));
      if (seq !== this.loadSeq) return; // a newer tap won
      this.noteResolved(track, stream, !!fresh);

      let source: PlayerState['source'] = { uri: stream.url, headers: stream.headers };
      if (strategy === 'file') {
        this.set({ status: 'preparing' });
        const dl = await downloadToCache(stream.url, stream.headers, track.id);
        if (seq !== this.loadSeq) return;
        const cur = this.get().current;
        this.set({ current: cur && { ...cur, preparedAt: Date.now() } });
        eventLog.info('file', `downloaded ${(dl.bytes / MB).toFixed(2)} MB to disk in ${dl.ms} ms`);
        source = { uri: dl.uri };
      }
      this.set({ status: 'loading', source, sourceKey: this.get().sourceKey + 1 });
    } catch (e) {
      if (seq === this.loadSeq) this.fail(`${strategy === 'file' ? 'download' : 'resolve'} failed: ${errorMessage(e)}`);
    }
  }

  private noteResolved(track: TrackInfo, stream: ResolvedStream, prefetched: boolean) {
    const cur = this.get().current;
    const titled =
      stream.title && track.title === track.id ? { ...track, title: stream.title, artist: stream.author ?? track.artist } : track;
    this.set({
      track: titled,
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

  /** Releases the previous track's source: stop watcher, detach from graph, stop the native node after unmount, gc. */
  private releasePrevious() {
    this.stopWatcher();
    const oldNode = this.sourceNode;
    const oldNative = this.nativeSource;
    this.sourceNode = null;
    this.nativeSource = null;
    if (oldNode) this.graph?.setSource(null);
    this.handle?.pause();
    if (!oldNative) return;
    // The old <Audio> unmounts on the next render (new sourceKey) and drops its event
    // subscriptions; stopping the native node after that cannot re-trigger onEnded.
    setTimeout(() => {
      try {
        oldNative.stop?.(0);
      } catch {
        // already stopped
      }
      const gc = gcIfAvailable();
      eventLog.debug('audio', `previous source released${gc ? ' + gc' : ''}`);
    }, 300);
  }

  // ---------- <Audio> callbacks (wired by PlayerHost) ----------

  onLoad() {
    const ctx = this.ctx;
    if (!ctx || !this.handle || !this.graph) return;
    const cur = this.get().current;
    this.set({ current: cur && { ...cur, loadedAt: Date.now() } });
    try {
      this.nativeSource = this.handle.getFileSourceNode?.() ?? null;
      this.sourceNode = new MediaElementAudioSourceNode(ctx, { mediaElement: this.handle });
      this.graph.setSource(this.sourceNode);
      eventLog.info('audio', `loaded (${cur?.strategy}); ${this.graph.describe()}; context ${ctx.state}`);
    } catch (e) {
      eventLog.error('audio', 'MediaElementAudioSourceNode failed (audio would bypass the graph)', e);
    }
    void ctx.resume().then(() => eventLog.debug('audio', `context after resume: ${ctx.state}`));
    this.handle.play();
    void this.recordMemory('track start');
  }

  /** onPlay: play() was called. Not proof of audio. */
  onPlayCalled() {
    const cur = this.get().current;
    if (cur && !cur.playCalledAt) {
      this.set({ current: { ...cur, playCalledAt: Date.now() } });
      this.startWatcher();
    }
    eventLog.info('state', 'play() called');
    // Not "playing" until there is evidence of audio (buffer ready, a position tick, or RMS).
    const evidence = cur?.firstRmsAt || cur?.firstTickAt;
    this.set({ status: evidence ? 'playing' : 'buffering' });
    this.updateNotification();
  }

  /** onPlaying: the native source left the buffering state (decoded audio available). */
  onBufferReady() {
    eventLog.info('state', 'buffering → playing (decoded audio available)');
    this.set({ status: 'playing' });
    this.updateNotification();
  }

  onPause() {
    const s = this.get().status;
    if (s === 'loading' || s === 'resolving' || s === 'preparing') return;
    eventLog.info('state', `paused at ${this.get().position.toFixed(1)} s`);
    this.set({ status: 'paused' });
    this.updateNotification();
  }

  onWaiting() {
    eventLog.info('state', 'buffering (no decoded audio yet)');
    this.set({ status: 'buffering' });
  }

  onPosition(seconds: number) {
    const now = Date.now();
    const cur = this.get().current;
    if (cur && !cur.firstTickAt && seconds > 0) {
      this.set({ current: { ...cur, firstTickAt: now } });
      eventLog.info('metrics', `first position tick ${now - cur.tapAt} ms after tap (${seconds.toFixed(2)} s)`);
      if (this.get().status === 'buffering') this.set({ status: 'playing' });
    }
    if (now - this.lastPositionLog >= 5000) {
      this.lastPositionLog = now;
      eventLog.info('position', `${seconds.toFixed(1)} s, RMS ${this.readLevel().toFixed(3)}`);
    }
    if (now - this.lastPositionPush < 500) return;
    this.lastPositionPush = now;
    this.set({ position: seconds });
  }

  onEnded() {
    eventLog.info('state', 'ended → next');
    this.next();
  }

  onError(err: Error) {
    const key = this.get().sourceKey;
    const track = this.get().track;
    eventLog.error('audio', `<Audio> error: ${err.message}`);
    // D6: re-resolve once on a playback error (e.g. 403 / expired URL), then give up.
    if (track && this.retriedForKey !== key) {
      this.retriedForKey = key + 1;
      this.prefetched.delete(track.id);
      eventLog.warn('stream', 're-resolving once after playback error');
      void this.load(track, this.get().index, this.get().current?.strategy ?? this.get().strategy, false);
      return;
    }
    this.fail(err.message);
  }

  // ---------- first-sound watcher ----------

  private startWatcher() {
    this.stopWatcher();
    const started = Date.now();
    this.watcher = setInterval(() => {
      const cur = this.get().current;
      if (!cur) return this.stopWatcher();
      const rms = this.readLevel();
      if (!cur.firstRmsAt && rms > RMS_THRESHOLD) {
        const m: Measurement = { ...cur, firstRmsAt: Date.now() };
        this.set({ current: m, history: [m, ...this.get().history].slice(0, 12), status: 'playing' });
        eventLog.info(
          'metrics',
          `FIRST SOUND (RMS ${rms.toFixed(3)}) ${m.firstRmsAt! - m.tapAt} ms after tap [${m.strategy}${m.prefetched ? ', prefetched URL' : ''}${m.fallback ? ', fallback' : ''}]`,
        );
        this.stopWatcher();
        void this.prefetchNext();
        return;
      }
      if (Date.now() - started > NO_AUDIO_MS) {
        this.stopWatcher();
        const m: Measurement = { ...cur, noAudio: true };
        this.set({ current: m, history: [m, ...this.get().history].slice(0, 12) });
        const ctxState = this.ctx?.state ?? '?';
        eventLog.error(
          'metrics',
          `NO AUDIO ${NO_AUDIO_MS / 1000} s after play() [${cur.strategy}] status ${this.get().status}, position ${this.get().position.toFixed(1)} s, context ${ctxState}, first tick ${cur.firstTickAt ? 'yes' : 'no'}`,
        );
        const track = this.get().track;
        if (!track) return;
        // 1) A context that isn't rendering explains "buffering forever": rebuild it once.
        if (ctxState !== 'running' && !this.contextRebuilt) {
          this.contextRebuilt = true;
          eventLog.warn('player', `context is "${ctxState}", not running → rebuilding the context and retrying`);
          void this.rebuildContext().then(() => this.load(track, this.get().index, cur.strategy, cur.fallback));
          return;
        }
        // 2) Otherwise the stream is the suspect: retry as download-then-play.
        if (this.get().autoFallback && cur.strategy === 'stream') {
          eventLog.warn('player', 'auto-fallback: retrying this track as download-then-play');
          void this.load(track, this.get().index, 'file', true);
        }
      }
    }, 50);
  }

  private stopWatcher() {
    if (this.watcher) clearInterval(this.watcher);
    this.watcher = null;
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

  private async readMemoryMB(): Promise<number> {
    return +((await DeviceInfo.getUsedMemory()) / MB).toFixed(1);
  }

  private async recordMemory(label?: string) {
    try {
      const mb = await this.readMemoryMB();
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
    this.stopWatcher();
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
