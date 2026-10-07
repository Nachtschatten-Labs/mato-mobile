import type { ExpoConfig } from 'expo/config'

const config: ExpoConfig = {
  name: 'mato',
  slug: 'mato-mobile',
  version: '0.1.0',
  scheme: 'mato',
  orientation: 'portrait',
  userInterfaceStyle: 'dark',
  icon: './assets/icon.png',
  android: {
    package: 'markets.mato.mobile',
    versionCode: 1,
    adaptiveIcon: {
      foregroundImage: './assets/icon.png',
      backgroundColor: '#101010',
    },
    blockedPermissions: [
      'android.permission.RECORD_AUDIO',
      'android.permission.READ_EXTERNAL_STORAGE',
      'android.permission.WRITE_EXTERNAL_STORAGE',
    ],
  },
  ios: { bundleIdentifier: 'markets.mato.mobile', supportsTablet: true },
  web: { bundler: 'metro', favicon: './assets/favicon.png' },
  plugins: [
    'expo-font',
    'expo-dev-client',
    ['expo-secure-store', { configureAndroidBackup: true }],
    [
      'expo-splash-screen',
      {
        backgroundColor: '#101010',
        image: './assets/icon.png',
        imageWidth: 100,
      },
    ],
  ],
}
export default config
