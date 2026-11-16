import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.nexora.calc',
  appName: 'Nexora Digital Calculator',
  webDir: 'dist',
  bundledWebRuntime: false,
  plugins: {
    LiveUpdate: {
      autoBlockRolledBackBundles: true,
      autoDeleteBundles: true,
      autoUpdateStrategy: 'none',
      readyTimeout: 15000,
    },
  },
};

export default config;