import { useRouter, useSegments, Stack } from 'expo-router';
import { useEffect } from 'react';
import { AuthProvider, useAuth } from '../context/AuthContext';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';

import { useColorScheme } from '@/hooks/use-color-scheme';

function RouteGuard({ children }) {
  const { user, role, loading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    const inAuthGroup = segments[0] === 'auth';
    const inAdminGroup = segments[0] === 'admin';
    const inStaffGroup = segments[0] === 'staff';

    if (!user && !inAuthGroup) {
      router.replace('/auth/login');
    } else if (user && role === 'admin' && !inAdminGroup) {
      router.replace('/admin/dashboard');
    } else if (user && role === 'staff' && !inStaffGroup) {
      router.replace('/staff/map');
    }
  }, [user, role, loading]);

  return <>{children}</>;
}

export default function RootLayout() {
  const colorScheme = useColorScheme();

  return (
    <AuthProvider>
      <RouteGuard>
        <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="auth/login" />
            <Stack.Screen name="admin/dashboard" />
            <Stack.Screen name="staff/map" />
            <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal', headerShown: true }} />
          </Stack>
          <StatusBar style="light" />
        </ThemeProvider>
      </RouteGuard>
    </AuthProvider>
  );
}
