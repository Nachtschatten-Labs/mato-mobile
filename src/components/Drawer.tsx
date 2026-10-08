import type { PropsWithChildren, ReactNode } from 'react'
import { useMemo } from 'react'
import {
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { X } from 'lucide-react-native'
import { Text } from './ui'
import { ToastViewport } from './Toast'
import { colors, depth, fonts } from '../theme'

/** Phone sheet with a keyboard-safe scroll area and accessible dismissal. */
export function Drawer({
  visible,
  title = '',
  header,
  onClose,
  dismissible = true,
  children,
}: PropsWithChildren<{
  visible: boolean
  title?: string
  header?: ReactNode
  onClose: () => void
  dismissible?: boolean
}>) {
  const insets = useSafeAreaInsets()
  const gesture = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, { dx, dy }) =>
          dismissible && dy > 8 && dy > Math.abs(dx),
        onPanResponderRelease: (_, { dy, vy }) => {
          if (dismissible && (dy > 50 || (dy > 12 && vy > 0.5))) onClose()
        },
      }),
    [dismissible, onClose],
  )
  const dismiss = () => {
    if (dismissible) onClose()
  }
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={dismiss}
      statusBarTranslucent
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={[styles.overlay, { paddingTop: insets.top + 24 }]}
      >
        <Pressable
          style={StyleSheet.absoluteFill}
          accessibilityRole="button"
          accessibilityLabel="Dismiss sheet"
          disabled={!dismissible}
          onPress={dismiss}
        />
        <View
          style={styles.sheet}
          accessibilityViewIsModal
          onAccessibilityEscape={dismiss}
        >
          <View {...gesture.panHandlers}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close sheet"
              disabled={!dismissible}
              onPress={dismiss}
              style={styles.handleArea}
            >
              <View style={styles.handle} />
            </Pressable>
          </View>
          <View style={styles.header}>
            {header ?? (
              <Text accessibilityRole="header" style={styles.title}>
                {title}
              </Text>
            )}
            {dismissible && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close sheet"
                onPress={dismiss}
                style={styles.close}
              >
                <X size={20} color={colors.icon} />
              </Pressable>
            )}
          </View>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={[
              styles.content,
              { paddingBottom: Math.max(insets.bottom, 20) },
            ]}
          >
            {children}
          </ScrollView>
        </View>
        <ToastViewport />
      </KeyboardAvoidingView>
    </Modal>
  )
}
const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: '#00000099',
    justifyContent: 'flex-end',
  },
  sheet: {
    maxHeight: '100%',
    backgroundColor: colors.panel,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    width: '100%',
    maxWidth: 600,
    alignSelf: 'center',
    overflow: 'hidden',
    boxShadow: depth.sheet,
  },
  handleArea: { height: 28, alignItems: 'center', justifyContent: 'center' },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.grip,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 20,
    paddingRight: 8,
    paddingBottom: 8,
    gap: 12,
  },
  title: { fontSize: 18, lineHeight: 24, fontFamily: fonts.regular, flex: 1 },
  close: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: { paddingHorizontal: 20, gap: 20 },
})
