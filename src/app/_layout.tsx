import { useEffect, useState } from 'react';
import { Stack } from 'expo-router';
import { SQLiteProvider } from 'expo-sqlite';
import { StatusBar } from 'expo-status-bar';
import { AccessibilityInfo, Platform } from 'react-native';
import { migrateDatabase } from '@/data/database';
import { palette } from '@/ui/components';

export default function RootLayout() {
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => { if (active) setReduceMotion(enabled); })
      .catch(() => {});
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => { active = false; subscription.remove(); };
  }, []);

  return (
    <SQLiteProvider databaseName="finans.db" onInit={migrateDatabase}>
      <StatusBar style="dark" />
      <Stack screenOptions={{
        headerStyle: { backgroundColor: palette.background },
        headerTintColor: palette.ink,
        headerTitleStyle: { fontWeight: '700' },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: palette.background },
        animation: reduceMotion ? 'none' : Platform.OS === 'android' ? 'fade' : 'default',
      }}>
        <Stack.Screen name="index" options={{ title: 'Özet', headerShown: false }} />
        <Stack.Screen name="accounts" options={{ title: 'Hesaplar' }} />
        <Stack.Screen name="transfers" options={{ title: 'Hesaplar arası aktarım' }} />
        <Stack.Screen name="plan" options={{ title: 'Gelir ve gider planı' }} />
        <Stack.Screen name="cards" options={{ title: 'Kartlar ve taksitler' }} />
        <Stack.Screen name="savings" options={{ title: 'Birikimler' }} />
        <Stack.Screen name="convert" options={{ title: 'Bozdur veya sat' }} />
        <Stack.Screen name="forecast" options={{ title: 'Gelecek aylar' }} />
        <Stack.Screen name="cashflow" options={{ title: 'Günlük nakit akışı' }} />
        <Stack.Screen name="scenario" options={{ title: 'Geçici senaryo' }} />
        <Stack.Screen name="data" options={{ title: 'Yedek ve veri' }} />
      </Stack>
    </SQLiteProvider>
  );
}
