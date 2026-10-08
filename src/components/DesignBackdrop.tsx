import { StyleSheet, View } from 'react-native'
import Svg, {
  Defs,
  Ellipse,
  Pattern,
  RadialGradient,
  Rect,
  Stop,
} from 'react-native-svg'
import { colors } from '@/theme'

/** The handover's warm panel glow and faint page grain, rendered natively. */
export function DesignBackdrop() {
  return (
    <View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFill,
        { left: -32, right: -32, top: -48, bottom: -48 },
      ]}
    >
      <Svg width="100%" height="100%">
        <Defs>
          <RadialGradient id="panel-glow">
            <Stop offset="0" stopColor={colors.chart} stopOpacity={0.2} />
            <Stop offset="0.36" stopColor={colors.chart} stopOpacity={0.118} />
            <Stop offset="0.6" stopColor={colors.chart} stopOpacity={0.052} />
            <Stop offset="0.84" stopColor={colors.chart} stopOpacity={0.011} />
            <Stop offset="1" stopColor={colors.chart} stopOpacity={0} />
          </RadialGradient>
          <Pattern
            id="page-grain"
            width="64"
            height="64"
            patternUnits="userSpaceOnUse"
          >
            {Array.from({ length: 64 }, (_, i) => (
              <Rect
                key={i}
                x={(i * 29) % 64}
                y={(i * i * 17 + 7) % 64}
                width="1"
                height="1"
                fill={colors.text}
                opacity={0.035}
              />
            ))}
          </Pattern>
        </Defs>
        <Ellipse cx="50%" cy="280" rx="330" ry="430" fill="url(#panel-glow)" />
        <Rect width="100%" height="100%" fill="url(#page-grain)" />
      </Svg>
    </View>
  )
}
