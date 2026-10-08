import type { PropsWithChildren, Ref } from 'react'
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text as NativeText,
  View,
} from 'react-native'
import type {
  ScrollViewProps,
  StyleProp,
  TextProps,
  ViewProps,
  ViewStyle,
} from 'react-native'
import { colors, depth, fonts } from '@/theme'

export function Text({ style, ...props }: TextProps) {
  return <NativeText {...props} style={[styles.text, style]} />
}
export function Label({ style, ...props }: TextProps) {
  return <Text {...props} style={[styles.label, style]} />
}
export function Card({ style, ...props }: ViewProps) {
  return <View {...props} style={[styles.card, style]} />
}
export function Row({ style, ...props }: ViewProps) {
  return <View {...props} style={[styles.row, style]} />
}
export function Screen({
  children,
  contentContainerStyle,
  ...props
}: ScrollViewProps & { ref?: Ref<ScrollView> }) {
  return (
    <ScrollView
      {...props}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      contentContainerStyle={[styles.screen, contentContainerStyle]}
    >
      {children}
    </ScrollView>
  )
}
export function Button({
  title,
  onPress,
  variant = 'primary',
  disabled,
  loading,
  style,
  accessibilityLabel,
}: {
  title: string
  onPress: () => void
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  disabled?: boolean
  loading?: boolean
  style?: StyleProp<ViewStyle>
  accessibilityLabel?: string
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || title}
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.button,
        variant === 'primary' && styles.primary,
        variant === 'secondary' && styles.secondary,
        variant === 'danger' && styles.danger,
        disabled && !loading && styles.disabled,
        pressed && { opacity: 0.7 },
        style,
      ]}
    >
      {loading && (
        <ActivityIndicator
          size="small"
          color={variant === 'primary' ? colors.background : colors.text}
        />
      )}
      <Text
        style={[
          styles.buttonText,
          variant === 'primary' && { color: colors.background },
          variant === 'danger' && { color: colors.negative },
          disabled && !loading && { color: colors.muted },
        ]}
      >
        {title}
      </Text>
    </Pressable>
  )
}
export function EmptyState({
  title,
  detail,
  children,
}: PropsWithChildren<{ title: string; detail: string }>) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyDetail}>{detail}</Text>
      {children}
    </View>
  )
}
export function ErrorNotice({
  message,
  retry,
}: {
  message: string
  retry?: () => void
}) {
  return (
    <View accessibilityRole="alert" style={styles.error}>
      <Text style={{ color: colors.negative }}>{message}</Text>
      {retry && <Button title="Try again" onPress={retry} variant="ghost" />}
    </View>
  )
}
export function Divider() {
  return <View style={styles.divider} />
}

const styles = StyleSheet.create({
  text: {
    color: colors.text,
    fontFamily: fonts.regular,
    fontSize: 16,
    lineHeight: 21,
    fontVariant: ['tabular-nums'],
  },
  label: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 18,
    fontFamily: fonts.regular,
  },
  card: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 20,
    padding: 20,
    gap: 16,
    boxShadow: depth.panel,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  screen: {
    padding: 16,
    paddingBottom: 32,
    gap: 20,
    maxWidth: 760,
    width: '100%',
    alignSelf: 'center',
    flexGrow: 1,
  },
  button: {
    minHeight: 48,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 40,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  buttonText: { fontFamily: fonts.medium, textAlign: 'center', fontSize: 16 },
  primary: { backgroundColor: colors.accent, boxShadow: depth.button },
  secondary: {
    backgroundColor: colors.elevated,
    borderWidth: 1,
    borderColor: colors.controlBorder,
    boxShadow: depth.control,
  },
  danger: {
    backgroundColor: colors.elevated,
    borderWidth: 1,
    borderColor: colors.controlBorder,
  },
  disabled: { backgroundColor: colors.track, boxShadow: depth.control },
  empty: {
    alignItems: 'center',
    paddingVertical: 32,
    paddingHorizontal: 16,
    gap: 12,
  },
  emptyTitle: { fontSize: 18, fontFamily: fonts.regular },
  emptyDetail: { textAlign: 'center', color: colors.muted, maxWidth: 330 },
  error: {
    backgroundColor: colors.elevated,
    borderRadius: 8,
    padding: 14,
    gap: 4,
  },
  divider: { height: 1, backgroundColor: colors.border },
})
