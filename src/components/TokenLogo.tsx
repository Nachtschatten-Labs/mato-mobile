import { StyleSheet, View } from 'react-native'
import Svg, { Circle, Defs, LinearGradient, Path, Stop } from 'react-native-svg'
import { colors } from '@/theme'

/** Brand marks are isolated from the application's surface/color tokens. */
export function TokenLogo({
  symbol,
  size = 20,
}: {
  symbol: string
  size?: number
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      {symbol === 'USDC' ? (
        <>
          <Circle cx="16" cy="16" r="16" fill="#2775ca" />
          <Path
            d="M20 11.5c-1-2-7-2-7 1 0 3 7 1 7 5 0 3-6 4-8 1M16 8v3m0 10v3M10 7a11 11 0 0 0 0 18M22 7a11 11 0 0 1 0 18"
            fill="none"
            stroke="#fff"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </>
      ) : (
        <>
          <Defs>
            <LinearGradient id="solana-mark" x1="0" y1="1" x2="1" y2="0">
              <Stop offset="0" stopColor="#9945ff" />
              <Stop offset="1" stopColor="#14f195" />
            </LinearGradient>
          </Defs>
          <Circle cx="16" cy="16" r="16" fill={colors.track} />
          <Path
            d="M9 9h16l-3 4H6zm-3 6h16l3 4H9zm3 6h16l-3 4H6z"
            fill="url(#solana-mark)"
          />
        </>
      )}
    </Svg>
  )
}

export function PairLogo({ size = 24 }: { size?: number }) {
  return (
    <View style={styles.pair}>
      <TokenLogo symbol="SOL" size={size} />
      <View style={styles.overlap}>
        <TokenLogo symbol="USDC" size={size} />
      </View>
    </View>
  )
}
const styles = StyleSheet.create({
  pair: { flexDirection: 'row', alignItems: 'center' },
  overlap: {
    marginLeft: -6,
    borderRadius: 40,
    borderWidth: 2,
    borderColor: colors.panel,
  },
})
