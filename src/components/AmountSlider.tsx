import { useRef, useState } from 'react'
import { PanResponder, StyleSheet, View } from 'react-native'
import { colors } from '@/theme'

const THUMB_SIZE = 20

export function AmountSlider({
  value,
  disabled,
  label,
  onChange,
  onAdjust,
}: {
  value: number
  disabled: boolean
  label: string
  onChange: (percent: number) => void
  onAdjust: (direction: -1 | 1) => void
}) {
  const [width, setWidth] = useState(0)
  const percent = Math.max(0, Math.min(100, value))
  const startX = useRef(0)
  // Keep a drag alive while its amount updates cause the form to render.
  const current = useRef({ width, disabled, onChange })
  current.current = { width, disabled, onChange }
  const [gesture] = useState(() => {
    const update = (location: number) => {
      const { width, disabled, onChange } = current.current
      if (disabled || width <= THUMB_SIZE) return
      const fraction = Math.max(
        0,
        Math.min(1, (location - THUMB_SIZE / 2) / (width - THUMB_SIZE)),
      )
      onChange(Math.round(fraction * 1000) / 10)
    }
    return PanResponder.create({
      onStartShouldSetPanResponder: () => !current.current.disabled,
      onPanResponderGrant: (event) => {
        startX.current = event.nativeEvent.locationX
        update(startX.current)
      },
      onPanResponderMove: (_, { dx }) => update(startX.current + dx),
      onPanResponderTerminationRequest: () => false,
    })
  })
  const position = (percent / 100) * Math.max(0, width - THUMB_SIZE)

  return (
    <View
      style={[styles.slider, disabled && styles.disabled]}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      aria-disabled={disabled}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      aria-valuetext={`${Number(percent.toFixed(1))}% of available balance`}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(event) => {
        if (disabled) return
        const action = event.nativeEvent.actionName
        if (action === 'increment' || action === 'decrement') {
          onAdjust(action === 'increment' ? 1 : -1)
        }
      }}
      {...gesture.panHandlers}
    >
      <View pointerEvents="none" style={styles.track}>
        <View style={[styles.fill, { width: `${percent}%` }]} />
      </View>
      <View pointerEvents="none" style={[styles.thumb, { left: position }]} />
    </View>
  )
}

const styles = StyleSheet.create({
  slider: { height: 44, justifyContent: 'center' },
  disabled: { opacity: 0.4 },
  track: {
    height: 4,
    marginHorizontal: THUMB_SIZE / 2,
    borderRadius: 2,
    backgroundColor: colors.track,
    overflow: 'hidden',
  },
  fill: { height: '100%', backgroundColor: colors.accent },
  thumb: {
    position: 'absolute',
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_SIZE / 2,
    backgroundColor: colors.accent,
  },
})
