import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react'
import {
  Linking,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Svg, { Circle } from 'react-native-svg'
import { Check, Info, X } from 'lucide-react-native'
import { colors, depth, fonts } from '@/theme'
import { config } from '@/config'
import { formatExplorerTransactionUrl } from '@/features/trading/lib/format'
import { Text } from './ui'

type ToastMessage = {
  title: string
  description: string
  signature?: string
  tone?: 'success' | 'error' | 'info'
}
type ToastState = {
  toast: ToastMessage | null
  remaining: number
  showToast: (toast: ToastMessage) => void
  dismiss: () => void
  setHeld: (held: boolean) => void
}
const ToastContext = createContext<ToastState | null>(null)
const lifetime = 8000

export function ToastProvider({ children }: PropsWithChildren) {
  const [toast, setToast] = useState<ToastMessage | null>(null)
  const [remaining, setRemaining] = useState(lifetime)
  const held = useRef(false)
  const showToast = useCallback((message: ToastMessage) => {
    held.current = false
    setRemaining(lifetime)
    setToast(message)
  }, [])
  useEffect(() => {
    if (!toast) return
    let last = Date.now()
    const timer = setInterval(() => {
      const now = Date.now()
      const elapsed = now - last
      last = now
      if (!held.current) setRemaining((value) => Math.max(0, value - elapsed))
    }, 100)
    return () => clearInterval(timer)
  }, [toast])
  useEffect(() => {
    if (remaining === 0) setToast(null)
  }, [remaining])
  return (
    <ToastContext.Provider
      value={{
        toast,
        remaining,
        showToast,
        dismiss: () => setToast(null),
        setHeld: (value) => {
          held.current = value
        },
      }}
    >
      {children}
    </ToastContext.Provider>
  )
}

export function useToast() {
  const context = useContext(ToastContext)
  if (!context) throw new Error('useToast must be used inside ToastProvider')
  return context
}

export function ToastViewport() {
  const state = useContext(ToastContext)
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  if (!state?.toast) return null
  const { toast, remaining, dismiss, setHeld, showToast } = state
  const color =
    toast.tone === 'error'
      ? colors.negative
      : toast.tone === 'info'
        ? colors.muted
        : colors.positive
  const Icon = toast.tone === 'error' ? X : toast.tone === 'info' ? Info : Check
  return (
    <View
      pointerEvents="box-none"
      style={[
        styles.viewport,
        { bottom: Math.max(insets.bottom, 16) },
        width > 600 && { left: 'auto', width: 420 },
      ]}
    >
      <Pressable
        accessible={false}
        focusable={false}
        onHoverIn={() => setHeld(true)}
        onHoverOut={() => setHeld(false)}
        style={styles.toast}
      >
        <View style={styles.status}>
          <Svg width="28" height="28" style={StyleSheet.absoluteFill}>
            <Circle
              cx="14"
              cy="14"
              r="12"
              stroke={colors.grip}
              strokeWidth="1"
              fill="none"
            />
            <Circle
              cx="14"
              cy="14"
              r="12"
              stroke={color}
              strokeWidth="1"
              fill="none"
              strokeDasharray={`${(75.4 * remaining) / lifetime} 75.4`}
              rotation="-90"
              origin="14,14"
            />
          </Svg>
          <Icon size={15} color={color} />
        </View>
        <View style={styles.body}>
          <View
            accessible
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
            style={{ gap: 4 }}
          >
            <Text style={styles.title}>{toast.title}</Text>
            <Text style={styles.description}>{toast.description}</Text>
          </View>
          {toast.signature && (
            <Pressable
              accessibilityRole="link"
              onPress={() => {
                void Linking.openURL(
                  formatExplorerTransactionUrl(toast.signature!, config.rpcUrl),
                ).catch(() =>
                  showToast({
                    title: 'Could not open transaction',
                    description: 'Try View tx again to open Solana Explorer.',
                    signature: toast.signature,
                    tone: 'error',
                  }),
                )
              }}
            >
              <Text style={styles.link}>View tx</Text>
            </Pressable>
          )}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss notification"
          hitSlop={8}
          onPress={dismiss}
          style={styles.close}
        >
          <X size={16} color={colors.icon} />
        </Pressable>
      </Pressable>
    </View>
  )
}
const styles = StyleSheet.create({
  viewport: {
    position: 'absolute',
    left: 16,
    right: 16,
    zIndex: 100,
    maxWidth: 568,
    alignSelf: 'center',
  },
  toast: {
    backgroundColor: colors.track,
    borderWidth: 1,
    borderColor: colors.controlBorder,
    borderRadius: 8,
    padding: 12,
    gap: 10,
    flexDirection: 'row',
    boxShadow: depth.popover,
  },
  status: {
    height: 28,
    width: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1, gap: 4 },
  title: { fontFamily: fonts.medium, fontSize: 16 },
  description: { fontSize: 14, lineHeight: 19, color: colors.secondary },
  link: { fontSize: 14, textDecorationLine: 'underline', paddingVertical: 4 },
  close: {
    width: 24,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
