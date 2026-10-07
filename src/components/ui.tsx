import type { PropsWithChildren } from 'react'
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
import { colors, fonts } from '@/theme'

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
}: ScrollViewProps) {
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
        (disabled || loading) && { opacity: 0.45 },
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
    fontSize: 15,
    lineHeight: 22,
  },
  label: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 18,
    fontFamily: fonts.medium,
  },
  card: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 20,
    padding: 18,
    gap: 16,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  screen: {
    padding: 20,
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
    borderRadius: 14,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  buttonText: { fontFamily: fonts.medium, textAlign: 'center', fontSize: 14 },
  primary: { backgroundColor: colors.accent },
  secondary: {
    backgroundColor: colors.elevated,
    borderWidth: 1,
    borderColor: colors.border,
  },
  danger: { backgroundColor: '#2d1d1d' },
  empty: {
    alignItems: 'center',
    paddingVertical: 32,
    paddingHorizontal: 16,
    gap: 12,
  },
  emptyTitle: { fontSize: 18, fontFamily: fonts.medium },
  emptyDetail: { textAlign: 'center', color: colors.muted, maxWidth: 330 },
  error: { backgroundColor: '#271b1b', borderRadius: 12, padding: 14, gap: 4 },
  divider: { height: 1, backgroundColor: colors.border },
})
