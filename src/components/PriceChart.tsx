import { useId, useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import Svg, {
  Circle,
  Defs,
  LinearGradient,
  Stop,
  Path,
  Line,
  Rect,
  Text as SvgText,
} from 'react-native-svg'
import { Label, Text } from './ui'
import { colors, depth, fonts } from '@/theme'
import type { MarketCandle } from '@/features/trading/api/market-repository'

const HEIGHT = 172
const PLOT_TOP = 8
const PLOT_BOTTOM = HEIGHT - 28
const formatPrice = (price: number) => price.toFixed(2)

export function PriceChart({
  candles,
  mode = 'line',
}: {
  candles: MarketCandle[]
  mode?: 'line' | 'candles'
}) {
  const [width, setWidth] = useState(320)
  const [inspectedIndex, setInspectedIndex] = useState<number | null>(null)
  const gradientId = `price-fill-${useId().replace(/:/g, '')}`
  if (candles.length < 2)
    return (
      <View style={[styles.plot, styles.empty]}>
        <Text style={styles.emptyTitle}>Waiting for market activity</Text>
        <Label style={styles.emptyDetail}>
          Price history will appear as trades settle.
        </Label>
      </View>
    )

  const first = candles[0]
  const latest = candles[candles.length - 1]
  const low = Math.min(
    ...candles.map((c) => (mode === 'line' ? c.close : c.low)),
  )
  const high = Math.max(
    ...candles.map((c) => (mode === 'line' ? c.close : c.high)),
  )
  const spread = Math.max(high - low, high * 0.0005, 0.00001)
  const min = low - spread * 0.17
  const max = high + spread * 0.22
  // Leave room for the price scale and the reference chart's four-point offset.
  const priceLabelWidth = Math.max(54, formatPrice(max).length * 7 + 12)
  const plotRight = Math.max(40, width - priceLabelWidth - 5)
  const plotWidth = plotRight - 8
  const dataWidth = plotWidth * (candles.length / (candles.length + 4))
  const duration = Math.max(1, latest.time - first.time)
  const x = (time: number) => 8 + ((time - first.time) / duration) * dataWidth
  const y = (price: number) =>
    PLOT_BOTTOM - ((price - min) / (max - min)) * (PLOT_BOTTOM - PLOT_TOP)
  const path = candles
    .map((c, i) => `${i ? 'L' : 'M'}${x(c.time)},${y(c.close)}`)
    .join(' ')
  const candleWidth = Math.max(
    1,
    Math.min(7, (dataWidth / candles.length) * 0.65),
  )
  const rawStep = (max - min) / 3
  const magnitude = 10 ** Math.floor(Math.log10(rawStep))
  const tickStep =
    [1, 2, 5, 10].find((step) => step * magnitude >= rawStep)! * magnitude
  const priceTicks: number[] = []
  for (
    let price = Math.ceil(min / tickStep) * tickStep;
    price <= max;
    price += tickStep
  ) {
    priceTicks.push(price)
  }
  const timeTicks = [0, 0.5, 1].map(
    (fraction) => first.time + duration * fraction,
  )
  const formatTime = (time: number) =>
    new Date(time * 1000).toLocaleString(
      undefined,
      duration > 48 * 60 * 60
        ? { month: 'short', day: 'numeric' }
        : { hour: '2-digit', minute: '2-digit', hour12: false },
    )
  const inspected =
    inspectedIndex === null
      ? null
      : candles[Math.min(inspectedIndex, candles.length - 1)]
  const inspectAt = (locationX: number) => {
    const time = first.time + ((locationX - 8) / dataWidth) * duration
    let nearest = 0
    candles.forEach((candle, index) => {
      if (Math.abs(candle.time - time) < Math.abs(candles[nearest].time - time))
        nearest = index
    })
    setInspectedIndex(nearest)
  }

  return (
    <Pressable
      style={styles.plot}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      onLongPress={(event) => inspectAt(event.nativeEvent.locationX)}
      onPressMove={(event) => {
        if (inspectedIndex !== null) inspectAt(event.nativeEvent.locationX)
      }}
      onPressOut={() => setInspectedIndex(null)}
      accessible
      accessibilityLabel={`Price chart. Range ${formatPrice(low)} to ${formatPrice(high)} USDC. Latest ${formatPrice(latest.close)} USDC.`}
      accessibilityHint="Touch and hold to inspect a price."
    >
      <Svg width="100%" height={HEIGHT} pointerEvents="none">
        <Defs>
          <LinearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={colors.chart} stopOpacity={0.22} />
            <Stop offset="1" stopColor={colors.chart} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        {timeTicks.map((time) => (
          <Line
            key={time}
            x1={x(time)}
            x2={x(time)}
            y1={PLOT_TOP}
            y2={PLOT_BOTTOM}
            stroke={colors.chartGridVertical}
          />
        ))}
        {priceTicks.map((price) => (
          <Line
            key={price}
            x1={8}
            x2={plotRight}
            y1={y(price)}
            y2={y(price)}
            stroke={colors.chartGridHorizontal}
          />
        ))}
        {mode === 'line' ? (
          <>
            <Path
              d={`${path} L${x(latest.time)},${PLOT_BOTTOM} L8,${PLOT_BOTTOM} Z`}
              fill={`url(#${gradientId})`}
            />
            <Path
              d={path}
              stroke={colors.chart}
              strokeWidth={2}
              strokeLinejoin="round"
              fill="none"
            />
          </>
        ) : (
          candles.map((c) => (
            <ViewlessCandle
              key={c.time}
              x={x(c.time)}
              high={y(c.high)}
              low={y(c.low)}
              open={y(c.open)}
              close={y(c.close)}
              width={candleWidth}
              color={c.close >= c.open ? colors.positive : colors.negative}
            />
          ))
        )}
        {priceTicks
          .filter((price) => Math.abs(y(price) - y(latest.close)) > 18)
          .map((price) => (
            <SvgText
              key={price}
              x={plotRight + 8}
              y={y(price) + 4}
              fill={colors.muted}
              fontSize={12}
              fontFamily={fonts.regular}
            >
              {formatPrice(price)}
            </SvgText>
          ))}
        {timeTicks.map((time, index) => (
          <SvgText
            key={time}
            x={x(time)}
            y={HEIGHT - 10}
            textAnchor={index === 0 ? 'start' : index === 2 ? 'end' : 'middle'}
            fill={colors.muted}
            fontSize={12}
            fontFamily={fonts.regular}
          >
            {formatTime(time)}
          </SvgText>
        ))}
        <Line
          x1={8}
          x2={plotRight}
          y1={y(latest.close)}
          y2={y(latest.close)}
          stroke={colors.chart}
          strokeWidth={1}
          strokeDasharray="1,2"
        />
        <Rect
          x={plotRight}
          y={y(latest.close) - 10}
          width={priceLabelWidth}
          height={20}
          fill={colors.chart}
        />
        <SvgText
          x={plotRight + priceLabelWidth / 2}
          y={y(latest.close) + 4}
          textAnchor="middle"
          fill={colors.text}
          fontSize={12}
          fontFamily={fonts.regular}
        >
          {formatPrice(latest.close)}
        </SvgText>
        {inspected && (
          <>
            <Line
              x1={x(inspected.time)}
              x2={x(inspected.time)}
              y1={PLOT_TOP}
              y2={PLOT_BOTTOM}
              stroke={colors.faint}
              strokeDasharray="4,4"
            />
            <Line
              x1={8}
              x2={plotRight}
              y1={y(inspected.close)}
              y2={y(inspected.close)}
              stroke={colors.faint}
              strokeDasharray="4,4"
            />
            <Circle
              cx={x(inspected.time)}
              cy={y(inspected.close)}
              r={4}
              fill={colors.chart}
              stroke={colors.background}
              strokeWidth={2}
            />
            <Rect
              x={plotRight}
              y={y(inspected.close) - 10}
              width={priceLabelWidth}
              height={20}
              fill={colors.track}
            />
            <SvgText
              x={plotRight + priceLabelWidth / 2}
              y={y(inspected.close) + 4}
              textAnchor="middle"
              fill={colors.text}
              fontSize={12}
              fontFamily={fonts.regular}
            >
              {formatPrice(inspected.close)}
            </SvgText>
            <Rect
              x={Math.min(plotRight - 74, Math.max(3, x(inspected.time) - 37))}
              y={HEIGHT - 25}
              width={74}
              height={23}
              rx={3}
              fill={colors.track}
            />
            <SvgText
              x={Math.min(plotRight - 37, Math.max(40, x(inspected.time)))}
              y={HEIGHT - 10}
              textAnchor="middle"
              fill={colors.text}
              fontSize={12}
              fontFamily={fonts.regular}
            >
              {formatTime(inspected.time)}
            </SvgText>
          </>
        )}
      </Svg>
    </Pressable>
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
  plot: {
    backgroundColor: colors.background,
    boxShadow: depth.sunk,
    borderRadius: 8,
    overflow: 'hidden',
  },
  empty: {
    height: HEIGHT,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
    gap: 8,
  },
  emptyTitle: { color: colors.muted, textAlign: 'center' },
  emptyDetail: { textAlign: 'center' },
})
