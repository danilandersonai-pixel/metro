import type { CapacitorConfig } from '@capacitor/cli';

// Настройки упаковки игры в Android/iOS-приложение.
const config: CapacitorConfig = {
  appId: 'com.tunnels.game',
  appName: 'Тоннели',
  webDir: 'dist',
  android: {
    backgroundColor: '#0d0f12',
  },
};

export default config;
