import type { PropsWithChildren } from 'react'
import { useMemo } from 'react'
import {
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { X } from 'lucide-react-native'
import { Text } from './ui'
import { colors, fonts } from '../theme'

/** A bottom drawer with a scrollable body and native back/escape dismissal. */
export function Drawer({
  visible,
  title,
  onClose,
  children,
}: PropsWithChildren<{
  visible: boolean
  title: string
  onClose: () => void
}>) {
  const insets = useSafeAreaInsets()
  const gesture = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, { dx, dy }) =>
          dy > 8 && dy > Math.abs(dx),
        onPanResponderRelease: (_, { dy, vy }) => {
          if (dy > 50 || (dy > 12 && vy > 0.5)) onClose()
        },
      }),
    [onClose],
  )
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={[styles.overlay, { paddingTop: insets.top + 24 }]}>
        <Pressable
          style={StyleSheet.absoluteFill}
          accessibilityRole="button"
          accessibilityLabel="Dismiss position details"
          onPress={onClose}
        />
        <View
          style={styles.sheet}
          accessibilityViewIsModal
          onAccessibilityEscape={onClose}
        >
          <View style={styles.handleArea} {...gesture.panHandlers}>
            <View style={styles.handle} />
          </View>
          <View style={styles.header}>
            <Text accessibilityRole="header" style={styles.title}>
              {title}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close position details"
              onPress={onClose}
              style={styles.close}
            >
              <X size={20} color={colors.muted} />
            </Pressable>
          </View>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={[
              styles.content,
              { paddingBottom: Math.max(insets.bottom, 20) },
            ]}
          >
            {children}
          </ScrollView>
        </View>
      </View>
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
    backgroundColor: colors.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderColor: colors.border,
    width: '100%',
    maxWidth: 760,
    alignSelf: 'center',
    overflow: 'hidden',
  },
  handleArea: { height: 28, alignItems: 'center', justifyContent: 'center' },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: '#555550' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 20,
    paddingRight: 8,
    paddingBottom: 8,
  },
  title: { fontSize: 20, fontFamily: fonts.medium, flex: 1 },
  close: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: { paddingHorizontal: 20, gap: 16 },
})
