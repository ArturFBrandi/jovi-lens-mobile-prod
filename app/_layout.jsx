import '../global.css';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { AppDataProvider } from '../context/AppDataContext.jsx';

export default function RootLayout() {
  return (
    <AppDataProvider>
      {/* The app is designed light-only (see app.json userInterfaceStyle), so the
          status bar is dark-on-light; "auto" drew white icons over white
          screens whenever the phone was in dark mode. The camera screen
          switches it to light while focused. */}
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
      </Stack>
    </AppDataProvider>
  );
}

// expo-router shows this for any route below that throws while rendering.
export { default as ErrorBoundary } from '../components/ErrorScreen.jsx';
