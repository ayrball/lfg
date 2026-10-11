import type { CapacitorConfig } from '@capacitor/cli';

// The Android and iOS apps wrap the same web build (dist/) and talk to the
// same Supabase backend as the website, so accounts, games, RSVPs and chat are
// shared across all three.
const config: CapacitorConfig = {
  appId: 'com.pickupsports.app',
  appName: 'Pickup',
  webDir: 'dist',
  android: {
    // Lets the WebView use the https://localhost origin (needed for geolocation & storage).
    allowMixedContent: false,
  },
  ios: {
    contentInset: 'never',
    scheme: 'Pickup',
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 800,
      backgroundColor: '#16a34a',
      showSpinner: false,
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
    SystemBars: {
      // Injects --safe-area-inset-* CSS variables so the layout clears notches and nav bars.
      insetsHandling: 'css',
      initialViewportFitValueHint: 'cover',
    },
  },
};

export default config;
