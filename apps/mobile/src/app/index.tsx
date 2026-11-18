import * as Application from 'expo-application';
import { Link } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

const ITEMS = [
  { href: '/s2', title: 'S2 · Playback', detail: 'Stream through the EQ graph, lock screen, AirPods, calls, background' },
  { href: '/selfcheck', title: 'S0 · Self-check', detail: 'Native modules, @bb/core in Hermes, web APIs' },
] as const;

export default function Menu() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Bb</Text>
      <Text style={styles.sub}>
        {Application.nativeApplicationVersion} · {__DEV__ ? 'dev-client' : 'release'} · {process.env.EXPO_PUBLIC_BB_COMMIT?.slice(0, 7) ?? 'local'}
      </Text>
      {ITEMS.map((i) => (
        <Link key={i.href} href={i.href} asChild>
          <Pressable style={styles.item} accessibilityRole="button" accessibilityLabel={i.title}>
            <Text style={styles.itemTitle}>{i.title}</Text>
            <Text style={styles.itemDetail}>{i.detail}</Text>
          </Pressable>
        </Link>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 20, paddingTop: 24, gap: 12 },
  title: { color: '#D6B4E6', fontSize: 44, fontWeight: '800', textAlign: 'center' },
  sub: { color: '#A1A1AA', fontSize: 13, textAlign: 'center', marginBottom: 12 },
  item: { backgroundColor: '#1A1A21', borderRadius: 14, paddingHorizontal: 16, paddingVertical: 14, minHeight: 44 },
  itemTitle: { color: '#FFFFFF', fontSize: 17, fontWeight: '700' },
  itemDetail: { color: '#A1A1AA', fontSize: 13, marginTop: 4 },
});
