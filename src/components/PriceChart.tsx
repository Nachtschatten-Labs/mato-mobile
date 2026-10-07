import { useState } from 'react'
import { StyleSheet, View } from 'react-native'
import Svg, {
  Defs,
  LinearGradient,
  Stop,
  Path,
  Line,
  Rect,
} from 'react-native-svg'
import { Label, Text } from './ui'
import { colors, fonts } from '@/theme'
import type { MarketCandle } from '@/features/trading/api/market-repository'

export function PriceChart({
  candles,
  mode = 'line',
}: {
  candles: MarketCandle[]
  mode?: 'line' | 'candles'
}) {
  const [width, setWidth] = useState(300)
  const height = 180
  if (candles.length < 2)
    return (
      <View style={styles.empty}>
        <Text style={{ color: colors.muted }}>Waiting for market activity</Text>
        <Label>Price history will appear as trades settle.</Label>
      </View>
    )
  const low = Math.min(...candles.map((c) => c.low))
  const high = Math.max(...candles.map((c) => c.high))
  const padding = Math.max((high - low) * 0.2, high * 0.0005, 0.00001)
  const min = low - padding,
    max = high + padding
  const x = (i: number) => 4 + (i / (candles.length - 1)) * (width - 8)
  const y = (price: number) =>
    height - 10 - ((price - min) / (max - min)) * (height - 20)
  const path = candles
    .map((c, i) => `${i ? 'L' : 'M'}${x(i)},${y(c.close)}`)
    .join(' ')
  const candleWidth = Math.max(1, Math.min(7, (width / candles.length) * 0.65))
  return (
    <View
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      accessible
      accessibilityLabel={`SOL price chart. Range ${low.toFixed(4)} to ${high.toFixed(4)} USDC. Latest ${candles.at(-1)!.close.toFixed(4)} USDC.`}
    >
      <Svg width="100%" height={height}>
        <Defs>
          <LinearGradient id="fill" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={colors.accent} stopOpacity={0.2} />
            <Stop offset="1" stopColor={colors.accent} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        {[0.25, 0.5, 0.75].map((t) => (
          <Line
            key={t}
            x1={0}
            x2={width}
            y1={height * t}
            y2={height * t}
            stroke="#272421"
            strokeDasharray="3,6"
          />
        ))}
        {mode === 'line' ? (
          <>
            <Path
              d={`${path} L${x(candles.length - 1)},${height} L4,${height} Z`}
              fill="url(#fill)"
            />
            <Path d={path} stroke={colors.accent} strokeWidth={2} fill="none" />
          </>
        ) : (
          candles.map((c, i) => {
            const color = c.close >= c.open ? colors.positive : colors.negative
            return (
              <ViewlessCandle
                key={c.time}
                x={x(i)}
                high={y(c.high)}
                low={y(c.low)}
                open={y(c.open)}
                close={y(c.close)}
                width={candleWidth}
                color={color}
              />
            )
          })
        )}
      </Svg>
      <View style={styles.axis}>
        <Label>
          {new Date(candles[0].time * 1000).toLocaleString(undefined, {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })}
        </Label>
        <Label>
          {new Date(candles.at(-1)!.time * 1000).toLocaleTimeString(undefined, {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </Label>
      </View>
    </View>
  )
}
function ViewlessCandle({
  x,
  high,
  low,
  open,
  close,
  width,
  color,
}: {
  x: number
  high: number
  low: number
  open: number
  close: number
  width: number
  color: string
}) {
  return (
    <>
      <Line x1={x} x2={x} y1={high} y2={low} stroke={color} />
      <Rect
        x={x - width / 2}
        y={Math.min(open, close)}
        width={width}
        height={Math.max(1, Math.abs(close - open))}
        fill={color}
      />
    </>
  )
}
const styles = StyleSheet.create({
  empty: {
    height: 200,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  axis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
})
