import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: '#0E0E12' },
            headerTintColor: '#FFFFFF',
            contentStyle: { backgroundColor: '#0E0E12' },
          }}
        >
          <Stack.Screen name="index" options={{ title: 'Bb · self-check' }} />
        </Stack>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
