// S2 diagnostics: one button runs a matrix and records, per case, where audio stops.
//  B1/B2: a 440 Hz OscillatorNode beep, no <Audio> tag involved. Does the AudioContext render at all?
//  #1-#7: sources × loading paths × routing (see CASES).
// Results go to the event log (Share log).
import { type ComponentRef, useCallback, useRef, useState } from 'react';
import { Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { type AnalyserNode, Audio, AudioContext, AudioManager, MediaElementAudioSourceNode } from 'react-native-audio-api';
import DeviceInfo from 'react-native-device-info';
import { eventLog } from '../log/eventLog';
import { PlayerService } from '../player/PlayerService';
import { downloadToCache, fetchYouTubeFormats, probeRanges } from '../player/sources';

type Kind = 'mp3' | 'yt140' | 'yt251';
type Load = 'stream' | 'force' | 'file';
type Mode = 'direct' | 'graph';
interface Case {
  id: number;
  label: string;
  kind: Kind;
  load: Load;
  mode: Mode;
}

const CONTROL_MP3 = 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3';
const VIDEO = 'dQw4w9WgXcQ';
const OBSERVE_MS = 12_000;

const CASES: Case[] = [
  { id: 1, label: 'control MP3 · stream · direct', kind: 'mp3', load: 'stream', mode: 'direct' },
  { id: 2, label: 'control MP3 · stream · graph', kind: 'mp3', load: 'stream', mode: 'graph' },
  { id: 3, label: 'YouTube 140 · stream · direct', kind: 'yt140', load: 'stream', mode: 'direct' },
  { id: 4, label: 'YouTube 140 · stream · graph', kind: 'yt140', load: 'stream', mode: 'graph' },
  { id: 5, label: 'YouTube 140 · forceDownload (JS buffer) · graph', kind: 'yt140', load: 'force', mode: 'graph' },
  { id: 6, label: 'YouTube 140 · disk file · graph', kind: 'yt140', load: 'file', mode: 'graph' },
  { id: 7, label: 'YouTube 251 opus · stream · graph', kind: 'yt251', load: 'stream', mode: 'graph' },
];

interface Stats {
  t0: number;
  loadedAt?: number;
  firstTickAt?: number;
  firstRmsAt?: number;
  maxPos: number;
  maxRms: number;
  buffering: number;
  ready: number;
  errors: string[];
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const memMB = async () => +((await DeviceInfo.getUsedMemory()) / 1048576).toFixed(1);
type Handle = ComponentRef<typeof Audio> & { getFileSourceNode?: () => { stop?: (w: number) => void } | null };

function rmsOf(analyser: AnalyserNode, buf: Uint8Array): number {
  analyser.getByteTimeDomainData(buf);
  let s = 0;
  for (let i = 0; i < buf.length; i++) {
    const v = (buf[i]! - 128) / 128;
    s += v * v;
  }
  return Math.sqrt(s / buf.length);
}

/** 440 Hz for 1.5 s through gain → analyser → destination. Returns the max RMS seen. */
async function beep(ctx: AudioContext): Promise<{ maxRms: number; before: string; after: string }> {
  const before = ctx.state;
  await ctx.resume().catch(() => {});
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  const an = ctx.createAnalyser();
  an.fftSize = 1024;
  gain.gain.value = 0.15;
  osc.frequency.value = 440;
  osc.connect(gain);
  gain.connect(an);
  an.connect(ctx.destination);
  const buf = new Uint8Array(1024);
  osc.start(ctx.currentTime);
  let maxRms = 0;
  for (let i = 0; i < 15; i++) {
    await sleep(100);
    maxRms = Math.max(maxRms, rmsOf(an, buf));
  }
  osc.stop(ctx.currentTime);
  an.disconnect();
  gain.disconnect();
  return { maxRms, before, after: ctx.state };
}

export default function Diagnostics() {
  const [ctx, setCtx] = useState<AudioContext | null>(null);
  const [src, setSrc] = useState<{ uri: string; headers?: Record<string, string> } | null>(null);
  const [force, setForce] = useState(false);
  const [runKey, setRunKey] = useState(0);
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<string[]>([]);
  const [now, setNow] = useState('');

  const ctxRef = useRef<AudioContext | null>(null);
  const analyser = useRef<AnalyserNode | null>(null);
  const buf = useRef(new Uint8Array(1024));
  const handle = useRef<Handle | null>(null);
  const stats = useRef<Stats | null>(null);
  const mode = useRef<Mode>('direct');
  const media = useRef<MediaElementAudioSourceNode | null>(null);
  const loadWaiter = useRef<(() => void) | null>(null);

  const onLoad = useCallback(() => {
    const st = stats.current;
    if (st) st.loadedAt = Date.now();
    const h = handle.current;
    const c = ctxRef.current;
    if (h && c && analyser.current && mode.current === 'graph') {
      try {
        media.current = new MediaElementAudioSourceNode(c, { mediaElement: h });
        media.current.connect(analyser.current);
      } catch (e) {
        st?.errors.push(`media node: ${String(e).slice(0, 80)}`);
      }
    }
    void c?.resume();
    h?.play();
    loadWaiter.current?.();
  }, []);

  const runCase = useCallback(async (c: Case, yt: Awaited<ReturnType<typeof fetchYouTubeFormats>> | null): Promise<string> => {
    setNow(`#${c.id} ${c.label}`);
    mode.current = c.mode;
    let url = CONTROL_MP3;
    let headers: Record<string, string> = {};
    if (c.kind !== 'mp3') {
      const itag = c.kind === 'yt140' ? 140 : 251;
      const f = yt?.formats.find((x) => x.itag === itag);
      if (!f || !yt) return `#${c.id} ${c.label}: SKIPPED (no itag ${itag} in player response)`;
      url = f.url;
      headers = yt.headersFor(f.url);
    }
    let path = '';
    if (c.load === 'stream') {
      const p = await probeRanges(url, headers);
      path = `path=${p.libraryPath} (HEAD ${p.headStatus} AR=${p.acceptRanges || '-'} type=${p.contentType || '-'} len=${p.contentLength || '-'}; Range ${p.rangeStatus})`;
    } else if (c.load === 'force') {
      path = 'path=forceDownload → JS ArrayBuffer';
    }
    let source: { uri: string; headers?: Record<string, string> } = { uri: url, headers };
    if (c.load === 'file') {
      try {
        const dl = await downloadToCache(url, headers, `diag-${c.kind}`);
        path = `path=disk file (${(dl.bytes / 1048576).toFixed(2)} MB in ${dl.ms} ms)`;
        source = { uri: dl.uri };
      } catch (e) {
        return `#${c.id} ${c.label}: download FAILED ${String(e).slice(0, 100)}`;
      }
    }
    const m0 = await memMB();
    stats.current = { t0: Date.now(), maxPos: 0, maxRms: 0, buffering: 0, ready: 0, errors: [] };
    const loaded = new Promise<boolean>((res) => {
      const t = setTimeout(() => res(false), 15_000);
      loadWaiter.current = () => {
        clearTimeout(t);
        res(true);
      };
    });
    setForce(c.load === 'force');
    setSrc(source);
    setRunKey((k) => k + 1);
    const ok = await loaded;
    const st = stats.current;
    if (ok) {
      const end = Date.now() + OBSERVE_MS;
      while (Date.now() < end) {
        await sleep(100);
        if (c.mode === 'graph' && analyser.current) {
          const r = rmsOf(analyser.current, buf.current);
          st.maxRms = Math.max(st.maxRms, r);
          if (!st.firstRmsAt && r > 0.003) st.firstRmsAt = Date.now();
        }
        if (st.maxPos >= 3 && (c.mode === 'direct' || st.firstRmsAt)) break;
      }
    }
    handle.current?.pause();
    const native = handle.current?.getFileSourceNode?.();
    media.current?.disconnect();
    media.current = null;
    setSrc(null);
    await sleep(300);
    try {
      native?.stop?.(0);
    } catch {
      // already stopped
    }
    await sleep(400);
    const m1 = await memMB();
    const ms = (t?: number) => (t ? `${t - st.t0} ms` : '—');
    const audio = c.mode === 'graph' ? st.firstRmsAt !== undefined && st.maxPos > 0 : st.maxPos > 0.5;
    return (
      `#${c.id} ${c.label}: ${audio ? 'AUDIO OK' : 'NO AUDIO'} · ${path} · ` +
      `load ${ok ? ms(st.loadedAt) : 'TIMEOUT 15 s'} · first tick ${ms(st.firstTickAt)} · max pos ${st.maxPos.toFixed(1)} s · ` +
      (c.mode === 'graph' ? `RMS max ${st.maxRms.toFixed(3)} first ${ms(st.firstRmsAt)} · ` : '') +
      `buffering ${st.buffering}× ready ${st.ready}× · errors ${st.errors.join(' | ') || '-'} · context ${ctxRef.current?.state} · mem ${m0}→${m1} MB`
    );
  }, []);

  const runAll = useCallback(async () => {
    if (running) return;
    setRunning(true);
    setResults([]);
    const out: string[] = [];
    const push = (line: string, ok: boolean) => {
      out.push(line);
      setResults([...out]);
      eventLog.add(ok ? 'info' : 'error', 'diag', line);
    };
    PlayerService.pause();
    eventLog.info('diag', 'start');

    // Session first, then a fresh context (the order PlayerService now uses).
    AudioManager.setSystemOptions({ ios: { category: 'playback', mode: 'default' } });
    await AudioManager.setAudioSessionActivity(true).catch((e) => eventLog.warn('diag', 'session activate failed', e));
    const fresh = new AudioContext();
    await fresh.resume().catch(() => {});
    const an = fresh.createAnalyser();
    an.fftSize = 1024;
    an.connect(fresh.destination);
    ctxRef.current = fresh;
    analyser.current = an;
    setCtx(fresh);

    setNow('B1 beep · fresh context');
    const b1 = await beep(fresh);
    push(`B1 beep · fresh context (created after session activation): ${b1.maxRms > 0.01 ? 'AUDIO OK' : 'NO AUDIO'} · RMS max ${b1.maxRms.toFixed(3)} · state ${b1.before}→${b1.after} · ${fresh.sampleRate} Hz`, b1.maxRms > 0.01);

    const appCtx = PlayerService.context;
    if (appCtx) {
      setNow('B2 beep · app context');
      const b2 = await beep(appCtx);
      push(`B2 beep · PlayerService context: ${b2.maxRms > 0.01 ? 'AUDIO OK' : 'NO AUDIO'} · RMS max ${b2.maxRms.toFixed(3)} · state ${b2.before}→${b2.after}`, b2.maxRms > 0.01);
    } else {
      push('B2 beep · PlayerService context: not created yet (play a track on S2 first to include it)', true);
    }

    let yt: Awaited<ReturnType<typeof fetchYouTubeFormats>> | null = null;
    try {
      yt = await fetchYouTubeFormats(VIDEO);
      eventLog.info('diag', `YouTube formats: ${yt.formats.filter((f) => f.audioOnly).map((f) => `${f.itag} ${f.mimeType.split(';')[0]}`).join(', ')}`);
    } catch (e) {
      eventLog.error('diag', 'could not fetch YouTube formats', e);
    }
    for (const c of CASES) {
      const line = await runCase(c, yt);
      push(line, line.includes('AUDIO OK'));
    }
    an.disconnect();
    await fresh.close().catch(() => {});
    ctxRef.current = null;
    analyser.current = null;
    setCtx(null);
    setNow('done');
    eventLog.info('diag', 'finished');
    setRunning(false);
  }, [runCase, running]);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      {src && ctx ? (
        <Audio
          key={runKey}
          ref={(h) => {
            handle.current = h as Handle | null;
          }}
          context={ctx}
          source={src}
          forceDownload={force}
          onLoad={onLoad}
          onPositionChange={(t) => {
            const st = stats.current;
            if (!st) return;
            st.maxPos = Math.max(st.maxPos, t);
            if (!st.firstTickAt && t > 0) st.firstTickAt = Date.now();
          }}
          onWaiting={() => {
            if (stats.current) stats.current.buffering++;
          }}
          onPlaying={() => {
            if (stats.current) stats.current.ready++;
          }}
          onError={(e) => {
            stats.current?.errors.push(e.message.slice(0, 120));
            loadWaiter.current?.();
          }}
        />
      ) : null}
      <Text style={styles.p}>
        Runs 2 beeps + {CASES.length} cases (~1.5 min). You'll hear a short beep, then a few seconds of music per case;
        that's expected. Keep the app open and the phone unlocked. When it says "done", tap Share log and send me the
        text.
      </Text>
      <Pressable style={[styles.btn, running && styles.btnOff]} onPress={runAll} accessibilityRole="button" accessibilityLabel="Run diagnostics">
        <Text style={styles.btnText}>{running ? 'Running…' : 'Run diagnostics'}</Text>
      </Pressable>
      <Text style={styles.now}>{now}</Text>
      {CASES.map((c) => (
        <Text key={c.id} style={styles.case}>
          #{c.id} {c.label}
        </Text>
      ))}
      <View style={styles.sep} />
      {results.map((r, i) => (
        <Text key={i} style={[styles.mono, r.includes('NO AUDIO') || r.includes('FAILED') ? styles.bad : styles.ok]} selectable>
          {r}
        </Text>
      ))}
      <Pressable style={styles.btn} onPress={() => Share.share({ message: eventLog.toText() }).catch(() => {})} accessibilityRole="button" accessibilityLabel="Share the event log">
        <Text style={styles.btnText}>Share log</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 16, paddingVertical: 16, gap: 8 },
  p: { color: '#A1A1AA', fontSize: 13 },
  btn: { backgroundColor: '#D6B4E6', borderRadius: 12, minHeight: 48, alignItems: 'center', justifyContent: 'center', marginVertical: 6 },
  btnOff: { opacity: 0.5 },
  btnText: { color: '#0E0E12', fontSize: 16, fontWeight: '700' },
  now: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' },
  case: { color: '#71717A', fontSize: 12 },
  sep: { height: 1, backgroundColor: '#2A2A33', marginVertical: 6 },
  mono: { fontSize: 12, fontFamily: 'Menlo' },
  ok: { color: '#4ADE80' },
  bad: { color: '#F87171' },
});
