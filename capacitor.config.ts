import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  // New standalone application identity for the public SpeakCoach release.
  appId: 'com.ariyand.speakcoach',
  appName: 'SpeakCoach',
  webDir: 'dist',
  server: {
    androidScheme: 'https'
  },
  plugins: {
    CapacitorHttp: {
      enabled: true
    }
  }
};

export default config;