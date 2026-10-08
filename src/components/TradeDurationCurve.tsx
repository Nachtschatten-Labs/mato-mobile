import { useMemo, useState } from 'react'
import { PanResponder, StyleSheet, View } from 'react-native'
import Svg, {
  Circle,
  Defs,
  LinearGradient,
  Line,
  Path,
  Stop,
  Text as SvgText,
} from 'react-native-svg'
import { colors, fonts } from '@/theme'
import { durationToSlots } from '@/features/trading/lib/amounts'
import {
  computePriceImpactPercent,
  type PriceImpactInputs,
} from '@/features/trading/lib/price-impact'
import {
  CUSTOM_DURATION_STEPS,
  nearestDuration,
  tradeDuration,
} from '@/features/trading/lib/mobile-trade-presentation'

const MIN = 5
const MAX = 365 * 86400
const WIDTH = 350
const LEFT = 22
const RIGHT = 328
const BASE = 160
const TOP = 26
const logRange = Math.log(MAX / MIN)
const x = (seconds: number) =>
  LEFT + (Math.log(Math.max(MIN, seconds) / MIN) / logRange) * (RIGHT - LEFT)

export function TradeDurationCurve({
  value,
  pick,
  onChange,
  ...inputs
}: PriceImpactInputs & {
  value: number
  pick: number | null
  onChange: (seconds: number) => void
}) {
  const [width, setWidth] = useState(WIDTH)
  const impactAt = (seconds: number) =>
    computePriceImpactPercent({
      ...inputs,
      durationSlots: durationToSlots(seconds),
    }) ?? 0
  const yMax = Math.max(impactAt(MIN) * 1.08, 1.6)
  const y = (impact: number) => BASE - Math.min(1, impact / yMax) * (BASE - TOP)
  const points = Array.from({ length: 100 }, (_, index) => {
    const seconds = MIN * Math.exp((index / 99) * logRange)
    return `${x(seconds).toFixed(2)},${y(impactAt(seconds)).toFixed(2)}`
  })
  const path = `M${points.join(' L')}`
  const updateFromX = (location: number) => {
    const fraction = Math.max(
      0,
      Math.min(1, ((location / width) * WIDTH - LEFT) / (RIGHT - LEFT)),
    )
    onChange(nearestDuration(MIN * Math.exp(fraction * logRange)))
  }
  const gesture = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (event) =>
          updateFromX(event.nativeEvent.locationX),
        onPanResponderMove: (event) => updateFromX(event.nativeEvent.locationX),
      }),
    [width, onChange],
  )
  const handleX = x(value)
  const handleY = y(impactAt(value))
  const adjust = (direction: number) => {
    const nearest = nearestDuration(value)
    const index = CUSTOM_DURATION_STEPS.indexOf(nearest)
    onChange(
      CUSTOM_DURATION_STEPS[
        Math.max(
          0,
          Math.min(CUSTOM_DURATION_STEPS.length - 1, index + direction),
        )
      ],
    )
  }
  return (
    <View
      style={styles.curve}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel="Duration"
      accessibilityValue={{
        min: MIN,
        max: MAX,
        now: value,
        text: tradeDuration(value),
      }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(event) =>
        adjust(event.nativeEvent.actionName === 'increment' ? 1 : -1)
      }
      {...gesture.panHandlers}
    >
      <Svg width="100%" height={196} viewBox="0 0 350 196">
        <Defs>
          <LinearGradient id="durationFill" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={colors.chart} stopOpacity={0.2} />
            <Stop offset="1" stopColor={colors.chart} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Path
          d={`${path} L${RIGHT},${BASE} L${LEFT},${BASE} Z`}
          fill="url(#durationFill)"
        />
        <Line
          x1={0}
          x2={WIDTH}
          y1={y(1)}
          y2={y(1)}
          stroke={colors.faint}
          strokeDasharray="3 4"
        />
        <SvgText
          x={WIDTH}
          y={Math.min(BASE - 10, y(1) - 7)}
          textAnchor="end"
          fontSize={12}
          fontFamily={fonts.regular}
          fill={colors.muted}
        >
          1% impact
        </SvgText>
        <Path d={path} fill="none" stroke={colors.chart} strokeWidth={2} />
        <Line x1={0} x2={WIDTH} y1={BASE} y2={BASE} stroke={colors.faint} />
        {(
          [
            ['5 sec', MIN],
            ['1 h', 3600],
            ['1 day', 86400],
            ['1 wk', 604800],
            ['1 yr', MAX],
          ] as const
        ).map(([label, seconds]) => (
          <SvgText
            key={label}
            x={seconds === MIN ? 0 : seconds === MAX ? WIDTH : x(seconds)}
            y={185}
            textAnchor={
              seconds === MIN ? 'start' : seconds === MAX ? 'end' : 'middle'
            }
            fontSize={12}
            fontFamily={fonts.regular}
            fill={colors.muted}
          >
            {label}
          </SvgText>
        ))}
        {pick !== null && (
          <Circle
            cx={x(pick)}
            cy={y(impactAt(pick))}
            r={6}
            fill={colors.card}
            stroke={colors.chart}
            strokeWidth={2}
          />
        )}
        <Line
          x1={handleX}
          x2={handleX}
          y1={handleY}
          y2={BASE}
          stroke={colors.muted}
          strokeDasharray="3 3"
        />
        <Circle cx={handleX} cy={handleY} r={22} fill={colors.accent} />
        <Path
          d={`M${handleX - 5},${handleY - 5} l-5,5 l5,5 M${handleX + 5},${handleY - 5} l5,5 l-5,5`}
          stroke={colors.background}
          strokeWidth={1.5}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
    </View>
  )
}
const styles = StyleSheet.create({
  curve: { width: '100%', marginVertical: 8 },
})
