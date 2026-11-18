// S0 self-check: proves every native module in the build loads on the device.
// Each check makes one small real call and reports ✓ / ✗ with a detail line.
import * as Application from 'expo-application';
import { File, Paths } from 'expo-file-system';
import * as Haptics from 'expo-haptics';
import * as Network from 'expo-network';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { AudioContext, isFfmpegEnabled } from 'react-native-audio-api';
import DeviceInfo from 'react-native-device-info';
import { createMMKV } from 'react-native-mmkv';
import Animated, { useSharedValue, withTiming } from 'react-native-reanimated';

type Result = { name: string; ok: boolean; detail: string };
type Check = { name: string; run: () => Promise<string> | string };

const CHECKS: Check[] = [
  {
    name: 'App version',
    run: () =>
      `${Application.nativeApplicationVersion ?? '?'} (build ${Application.nativeBuildVersion ?? '?'}) · ` +
      `${__DEV__ ? 'dev-client' : 'release'} · commit ${process.env.EXPO_PUBLIC_BB_COMMIT ?? 'local'}`,
  },
  {
    name: 'MMKV',
    run: () => {
      const kv = createMMKV({ id: 'bb.selfcheck' });
      const stamp = String(Date.now());
      kv.set('stamp', stamp);
      if (kv.getString('stamp') !== stamp) throw new Error('read-back mismatch');
      return 'set/get ok';
    },
  },
  {
    name: 'File system',
    run: () => {
      const f = new File(Paths.document, 'bb-selfcheck.txt');
      f.write('ok');
      const text = f.textSync();
      f.delete();
      if (text !== 'ok') throw new Error('read-back mismatch');
      return Paths.document.uri;
    },
  },
  {
    name: 'Audio engine',
    run: async () => {
      const ctx = new AudioContext();
      const rate = ctx.sampleRate;
      await ctx.close();
      return `AudioContext ${rate} Hz · FFmpeg ${isFfmpegEnabled() ? 'on' : 'off'}`;
    },
  },
  {
    name: 'Memory',
    run: async () => `${(await DeviceInfo.getUsedMemory() / 1048576).toFixed(1)} MB used`,
  },
  {
    name: 'Device',
    run: () => `${DeviceInfo.getModel()} · iOS ${DeviceInfo.getSystemVersion()}`,
  },
  {
    name: 'Network',
    run: async () => {
      const s = await Network.getNetworkStateAsync();
      return `${s.type} · connected=${s.isConnected} · internet=${s.isInternetReachable}`;
    },
  },
];

async function runAll(): Promise<Result[]> {
  const out: Result[] = [];
  for (const c of CHECKS) {
    try {
      out.push({ name: c.name, ok: true, detail: await c.run() });
    } catch (e) {
      out.push({ name: c.name, ok: false, detail: e instanceof Error ? e.message : String(e) });
    }
  }
  return out;
}

export default function SelfCheck() {
  const [results, setResults] = useState<Result[] | null>(null);
  const pulse = useSharedValue(0.4);

  useEffect(() => {
    pulse.value = withTiming(1, { duration: 600 });
    runAll().then(setResults);
  }, [pulse]);

  const rerun = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setResults(null);
    runAll().then(setResults);
  };

  const failed = results?.filter((r) => !r.ok).length ?? 0;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Animated.Text style={[styles.title, { opacity: pulse }]}>Bb</Animated.Text>
      <Text style={styles.summary} accessibilityRole="header">
        {results === null ? 'Running checks…' : failed === 0 ? 'All checks passed' : `${failed} check(s) failed`}
      </Text>
      {results?.map((r) => (
        <View key={r.name} style={styles.row} accessible accessibilityLabel={`${r.name}: ${r.ok ? 'passed' : 'failed'}. ${r.detail}`}>
          <Text style={[styles.mark, { color: r.ok ? '#4ADE80' : '#F87171' }]}>{r.ok ? '✓' : '✗'}</Text>
          <View style={styles.rowText}>
            <Text style={styles.name}>{r.name}</Text>
            <Text style={styles.detail} selectable>{r.detail}</Text>
          </View>
        </View>
      ))}
      <Pressable onPress={rerun} style={styles.button} accessibilityRole="button" accessibilityLabel="Run checks again">
        <Text style={styles.buttonText}>Run again</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 20, paddingVertical: 24, gap: 12 },
  title: { color: '#D6B4E6', fontSize: 48, fontWeight: '800', textAlign: 'center' },
  summary: { color: '#FFFFFF', fontSize: 17, fontWeight: '600', textAlign: 'center', marginBottom: 8 },
  row: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', paddingVertical: 8 },
  mark: { fontSize: 20, width: 24, textAlign: 'center' },
  rowText: { flex: 1 },
  name: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
  detail: { color: '#A1A1AA', fontSize: 13, marginTop: 2 },
  button: { marginTop: 16, alignSelf: 'center', backgroundColor: '#2A2A33', borderRadius: 12, paddingHorizontal: 24, paddingVertical: 12, minHeight: 44 },
  buttonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
});
