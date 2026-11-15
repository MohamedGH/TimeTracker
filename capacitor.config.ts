import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.timetracker.carnetdutemps',
  appName: 'Carnet du temps',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1500,
      backgroundColor: '#232821',
      showSpinner: false,
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#232821',
    },
  },
};

export default config;
