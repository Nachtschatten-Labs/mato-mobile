import { Platform } from 'react-native'

export const colors = {
  background: '#101010',
  card: '#171715',
  elevated: '#1c1c1c',
  text: '#faf8f5',
  muted: '#969896',
  border: '#282825',
  accent: '#e5e5df',
  chart: '#cf8654',
  positive: '#9fc891',
  negative: '#e47a78',
}
export const fonts = {
  regular: 'IBMPlexSans_400Regular',
  medium: 'IBMPlexSans_500Medium',
  semibold: 'IBMPlexSans_600SemiBold',
  mono: 'IBMPlexMono_400Regular',
}
export const shadow = Platform.select({
  ios: {
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  default: {},
})
