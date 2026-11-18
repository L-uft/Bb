// Spike S2 screen: play YouTube audio through Bb's graph and measure it.
import * as Haptics from 'expo-haptics';
import { Link } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Share, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useStore } from 'zustand';
import { eventLog, formatTime, useEventLog } from '../log/eventLog';
import { PlayerService, TEST_TRACKS, type Measurement } from '../player/PlayerService';

const tap = () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function LevelMeter() {
  const [level, setLevel] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setLevel(PlayerService.readLevel()), 100);
    return () => clearInterval(id);
  }, []);
  const pct = Math.min(1, level * 3);
  return (
    <View accessible accessibilityLabel={`Graph level ${Math.round(pct * 100)} percent`}>
      <View style={styles.meterTrack}>
        <View style={[styles.meterFill, { width: `${pct * 100}%` }]} />
      </View>
      <Text style={styles.dim}>analyser RMS {level.toFixed(3)} (non-zero while music plays = audio goes through Bb's graph)</Text>
    </View>
  );
}

function MeasurementRow({ m }: { m: Measurement }) {
  const since = (t?: number) => (t ? `${t - m.tapAt}` : '—');
  const tags = [m.strategy, m.prefetched && 'prefetched URL', m.fallback && 'fallback'].filter(Boolean).join(', ');
  return (
    <Text style={[styles.mono, m.noAudio && styles.err]}>
      {formatTime(m.tapAt).slice(0, 8)} {m.trackId} [{tags}]{'\n'}
      {'  '}
      {m.noAudio ? 'NO AUDIO · ' : `FIRST SOUND ${since(m.firstRmsAt)} ms · `}resolve {since(m.resolvedAt)} · download{' '}
      {since(m.preparedAt)} · loaded {since(m.loadedAt)} · play() {since(m.playCalledAt)} · 1st tick {since(m.firstTickAt)}
    </Text>
  );
}

function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { v: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <View style={styles.seg}>
      {options.map((o) => (
        <Pressable
          key={o.v}
          style={[styles.segItem, value === o.v && styles.segActive]}
          onPress={() => onChange(o.v)}
          accessibilityRole="button"
          accessibilityState={{ selected: value === o.v }}
          accessibilityLabel={o.label}
        >
          <Text style={[styles.segText, value === o.v && styles.segTextActive]}>{o.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export default function S2() {
  const s = useStore(PlayerService.store);
  const log = useEventLog(40, 'info');
  const [custom, setCustom] = useState('');
  const playing = s.status === 'playing' || s.status === 'buffering';

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.section}>Diagnostics first</Text>
      <Link href="/diag" asChild>
        <Pressable style={styles.primary} accessibilityRole="button" accessibilityLabel="Open diagnostics">
          <Text style={styles.primaryText}>Open diagnostics (1 button, ~1.5 min)</Text>
        </Pressable>
      </Link>

      <Text style={styles.section}>Loading strategy</Text>
      <Segmented
        value={s.strategy}
        options={[
          { v: 'stream', label: 'Stream (native)' },
          { v: 'file', label: 'Download → play file' },
        ]}
        onChange={(v) => PlayerService.setStrategy(v)}
      />
      <View style={styles.row}>
        <Text style={styles.label}>Auto-fallback: no audio after 8 s → retry as file</Text>
        <Switch value={s.autoFallback} onValueChange={(v) => PlayerService.setAutoFallback(v)} accessibilityLabel="Auto-fallback" />
      </View>
      <Pressable
        style={[styles.smallBtn, !!s.rapidTest && styles.disabled]}
        onPress={() => void PlayerService.rapidChangeTest()}
        accessibilityRole="button"
        accessibilityLabel="Run 10 rapid track changes memory test"
      >
        <Text style={styles.btnText}>{s.rapidTest ? `Memory test: ${s.rapidTest}` : '10 rapid track changes (memory test, ~30 s)'}</Text>
      </Pressable>

      <Text style={styles.section}>Graph</Text>
      <Text style={styles.mono}>{s.graph || '—'}</Text>
      <LevelMeter />
      <View style={styles.row}>
        <Text style={styles.label}>Mute master gain (music must go silent)</Text>
        <Switch value={s.masterMuted} onValueChange={(v) => PlayerService.setMasterMuted(v)} accessibilityLabel="Mute master gain" />
      </View>

      <Text style={styles.section}>Test tracks</Text>
      {TEST_TRACKS.map((t, i) => (
        <Pressable
          key={t.id}
          style={[styles.track, s.track?.id === t.id && styles.trackActive]}
          onPress={() => {
            tap();
            PlayerService.playIndex(i);
          }}
          accessibilityRole="button"
          accessibilityLabel={`Play ${t.title} by ${t.artist}`}
        >
          <Text style={styles.trackTitle}>{t.title}</Text>
          <Text style={styles.dim}>
            {t.artist} · {t.id}
          </Text>
        </Pressable>
      ))}
      <View style={styles.row}>
        <TextInput
          style={styles.input}
          value={custom}
          onChangeText={setCustom}
          placeholder="YouTube video ID or URL"
          placeholderTextColor="#71717A"
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel="Custom YouTube video ID or URL"
        />
        <Pressable
          style={styles.smallBtn}
          onPress={() => custom.trim() && PlayerService.playCustom(custom.trim())}
          accessibilityRole="button"
          accessibilityLabel="Play custom video"
        >
          <Text style={styles.btnText}>Play</Text>
        </Pressable>
      </View>

      <Text style={styles.section}>Now playing</Text>
      <Text style={styles.trackTitle}>{s.track ? `${s.track.title} — ${s.track.artist}` : 'Nothing yet'}</Text>
      <Text style={styles.dim}>
        {s.status}
        {s.error ? `: ${s.error}` : ''} · {mmss(s.position)} / {mmss(s.duration)}
        {s.current?.client ? ` · ${s.current.client} itag ${s.current.itag} · ${s.current.kbps ?? '?'} kbps · ${s.current.sizeMB ?? '?'} MB` : ''}
      </Text>
      <View style={styles.controls}>
        <Ctl label="⏮" a11y="Previous track" onPress={() => PlayerService.previous()} />
        <Ctl label="−15" a11y="Back 15 seconds" onPress={() => PlayerService.seekBy(-15)} />
        <Ctl label={playing ? '❙❙' : '▶'} a11y={playing ? 'Pause' : 'Play'} big onPress={() => PlayerService.toggle()} />
        <Ctl label="+15" a11y="Forward 15 seconds" onPress={() => PlayerService.seekBy(15)} />
        <Ctl label="⏭" a11y="Next track" onPress={() => PlayerService.next()} />
      </View>

      <Text style={styles.section}>Tap → first sound (ms after tap; first sound = analyser RMS above 0.003)</Text>
      {s.history.length === 0 ? <Text style={styles.dim}>Play a track to measure.</Text> : null}
      {s.history.map((m) => (
        <MeasurementRow key={`${m.trackId}-${m.tapAt}`} m={m} />
      ))}

      <Text style={styles.section}>Memory (app resident)</Text>
      <Text style={styles.mono}>
        now {s.memory.nowMB ?? '—'} MB · at track start {s.memory.trackStartMB ?? '—'} MB · peak {s.memory.peakMB ?? '—'} MB
      </Text>

      <Text style={styles.section}>Checklist</Text>
      <Text style={styles.dim}>
        1. Play each test track; note "total" times. 2. Toggle "Mute master gain": music must go silent. 3. Lock the
        phone 10 min: music keeps playing, no gaps. 4. Lock screen: title, artist, artwork, play/pause/next/previous,
        scrub. 5. AirPods: pause/play, double-tap = next; remove one AirPod → pauses. 6. Call the phone (or FaceTime
        audio) during playback, hang up → music resumes. 7. Let a track end → next one starts by itself. 8. Share the log.
      </Text>

      <View style={styles.row}>
        <Text style={styles.section}>Events</Text>
        <Pressable
          style={styles.smallBtn}
          onPress={() => Share.share({ message: eventLog.toText() }).catch(() => {})}
          accessibilityRole="button"
          accessibilityLabel="Share the event log"
        >
          <Text style={styles.btnText}>Share log</Text>
        </Pressable>
      </View>
      {log.map((e, i) => (
        <Text key={`${e.t}-${i}`} style={[styles.mono, e.level === 'error' && styles.err, e.level === 'warn' && styles.warn]}>
          {formatTime(e.t).slice(0, 8)} {e.tag}: {e.msg}
        </Text>
      ))}
    </ScrollView>
  );
}

function Ctl({ label, a11y, onPress, big }: { label: string; a11y: string; onPress: () => void; big?: boolean }) {
  return (
    <Pressable
      style={[styles.ctl, big && styles.ctlBig]}
      onPress={() => {
        tap();
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={a11y}
    >
      <Text style={[styles.ctlText, big && styles.ctlTextBig]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 16, paddingVertical: 16, gap: 8 },
  section: { color: '#D6B4E6', fontSize: 15, fontWeight: '700', marginTop: 12 },
  label: { color: '#FFFFFF', fontSize: 14, flex: 1 },
  dim: { color: '#A1A1AA', fontSize: 13 },
  mono: { color: '#E4E4E7', fontSize: 12, fontFamily: 'Menlo' },
  err: { color: '#F87171' },
  warn: { color: '#FBBF24' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  meterTrack: { height: 10, backgroundColor: '#2A2A33', borderRadius: 5, overflow: 'hidden', marginTop: 4 },
  meterFill: { height: 10, backgroundColor: '#4ADE80' },
  track: { backgroundColor: '#1A1A21', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, minHeight: 44 },
  trackActive: { borderWidth: 1, borderColor: '#D6B4E6' },
  trackTitle: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
  input: { flex: 1, backgroundColor: '#1A1A21', color: '#FFFFFF', borderRadius: 10, paddingHorizontal: 12, minHeight: 44 },
  smallBtn: { backgroundColor: '#2A2A33', borderRadius: 10, paddingHorizontal: 14, minHeight: 44, justifyContent: 'center' },
  btnText: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' },
  controls: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 },
  ctl: { minWidth: 52, minHeight: 44, borderRadius: 22, backgroundColor: '#1A1A21', alignItems: 'center', justifyContent: 'center' },
  ctlBig: { minWidth: 72, minHeight: 72, borderRadius: 36, backgroundColor: '#D6B4E6' },
  ctlText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  ctlTextBig: { color: '#0E0E12', fontSize: 24 },
  primary: { backgroundColor: '#D6B4E6', borderRadius: 12, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: '#0E0E12', fontSize: 15, fontWeight: '700' },
  disabled: { opacity: 0.6 },
  seg: { flexDirection: 'row', backgroundColor: '#1A1A21', borderRadius: 10, padding: 3, gap: 3 },
  segItem: { flex: 1, minHeight: 40, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  segActive: { backgroundColor: '#D6B4E6' },
  segText: { color: '#E4E4E7', fontSize: 13, fontWeight: '600' },
  segTextActive: { color: '#0E0E12' },
});
