import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { PlayerHost } from '../player/PlayerHost';

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        {/* The one <Audio> tag lives here, so playback survives screen changes. */}
        <PlayerHost />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: '#0E0E12' },
            headerTintColor: '#FFFFFF',
            contentStyle: { backgroundColor: '#0E0E12' },
          }}
        >
          <Stack.Screen name="index" options={{ title: 'Bb · spike' }} />
          <Stack.Screen name="selfcheck" options={{ title: 'S0 · Self-check' }} />
          <Stack.Screen name="s2" options={{ title: 'S2 · Playback' }} />
        </Stack>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
