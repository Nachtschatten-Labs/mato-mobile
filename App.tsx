import { Component, useEffect, useState } from 'react'
import type { ErrorInfo, PropsWithChildren } from 'react'
import {
  ActivityIndicator,
  AppState,
  Linking,
  Pressable,
  StyleSheet,
  View,
} from 'react-native'
import { StatusBar } from 'expo-status-bar'
import { useFonts } from 'expo-font'
import { IBMPlexSans_400Regular } from '@expo-google-fonts/ibm-plex-sans/400Regular'
import { IBMPlexSans_500Medium } from '@expo-google-fonts/ibm-plex-sans/500Medium'
import {
  ArrowLeft,
  Check,
  ChevronDown,
  Copy,
  Wallet,
} from 'lucide-react-native'
import * as Clipboard from 'expo-clipboard'
import {
  SafeAreaProvider,
  useSafeAreaInsets,
} from 'react-native-safe-area-context'
import {
  DarkTheme,
  NavigationContainer,
  useNavigation,
  useRoute,
} from '@react-navigation/native'
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs'
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs'
import NetInfo from '@react-native-community/netinfo'
import {
  QueryClient,
  QueryClientProvider,
  focusManager,
  onlineManager,
} from '@tanstack/react-query'
import { WalletProvider, useWallet } from '@/wallet'
import TradeScreen from '@/screens/TradeScreen'
import AccountScreen from '@/screens/AccountScreen'
import { Button, Text } from '@/components/ui'
import { colors, fonts } from '@/theme'
import { config } from '@/config'
import { FirstVisit } from '@/components/FirstVisit'
import { Drawer } from '@/components/Drawer'
import { ToastProvider, ToastViewport, useToast } from '@/components/Toast'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      retryDelay: 1500,
      staleTime: 10_000,
      gcTime: 5 * 60_000,
      refetchIntervalInBackground: false,
    },
    mutations: { retry: false },
  },
})
type Routes = { Trade: undefined; Account: undefined }
const Tab = createBottomTabNavigator<Routes>()

function Header() {
  const insets = useSafeAreaInsets()
  const wallet = useWallet()
  const navigation = useNavigation<BottomTabNavigationProp<Routes>>()
  const route = useRoute()
  const [online, setOnline] = useState(true)
  const [walletOpen, setWalletOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const { showToast } = useToast()
  useEffect(() => {
    setWalletOpen(false)
    setCopied(false)
  }, [wallet.address])
  useEffect(
    () =>
      NetInfo.addEventListener((state) =>
        setOnline(state.isConnected !== false),
      ),
    [],
  )
  return (
    <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
      <View style={styles.headerRow}>
        <Text style={styles.wordmark}>mato</Text>
        {!online && <Text style={styles.networkText}>Offline</Text>}
        <View style={styles.headerActions}>
          <Pressable
            accessibilityRole="link"
            onPress={() => {
              void Linking.openURL(
                'https://github.com/Nachtschatten-Labs/mato-mobile#readme',
              ).catch(() =>
                showToast({
                  title: 'Could not open Docs',
                  description: 'Please try again.',
                  tone: 'error',
                }),
              )
            }}
            style={styles.docsLink}
          >
            <Text style={styles.docs}>Docs</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              route.name === 'Account'
                ? 'Back to trading'
                : wallet.address
                  ? `${wallet.address.slice(0, 4)}…${wallet.address.slice(-4)}`
                  : 'Connect wallet'
            }
            onPress={() => {
              if (route.name === 'Account') navigation.navigate('Trade')
              else if (wallet.address) {
                setCopied(false)
                setWalletOpen(true)
              } else void wallet.connect().catch(() => {})
            }}
            accessibilityState={{
              disabled:
                (!wallet.supported && route.name !== 'Account') ||
                wallet.isConnecting,
              busy: wallet.isConnecting,
            }}
            disabled={
              (!wallet.supported && route.name !== 'Account') ||
              wallet.isConnecting
            }
            style={styles.walletButton}
          >
            {wallet.isConnecting ? (
              <ActivityIndicator color={colors.icon} size="small" />
            ) : route.name === 'Account' ? (
              <ArrowLeft size={16} color={colors.icon} />
            ) : (
              <Wallet size={16} color={colors.icon} />
            )}
            <Text style={styles.walletText}>
              {route.name === 'Account'
                ? 'Back'
                : wallet.address
                  ? `${wallet.address.slice(0, 4)}…${wallet.address.slice(-4)}`
                  : 'Connect wallet'}
            </Text>
            {wallet.address && route.name !== 'Account' && (
              <ChevronDown size={14} color={colors.icon} />
            )}
          </Pressable>
        </View>
      </View>
      {(!config.transactionsEnabled || !wallet.supported) && (
        <Text style={styles.preview}>
          Read-only preview · Mainnet market data
        </Text>
      )}
      {wallet.error && (
        <Text accessibilityRole="alert" style={styles.walletError}>
          {wallet.error}
        </Text>
      )}
      <Drawer
        visible={walletOpen && Boolean(wallet.address)}
        title="Wallet"
        onClose={() => setWalletOpen(false)}
      >
        <View style={styles.walletIdentity}>
          <Wallet size={24} color={colors.iconStrong} />
          <Text selectable style={{ flex: 1 }}>
            {wallet.address
              ? `${wallet.address.slice(0, 4)}…${wallet.address.slice(-4)}`
              : ''}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={copied ? 'Copied' : 'Copy address'}
            style={styles.copyButton}
            onPress={() => {
              if (!wallet.address) return
              void Clipboard.setStringAsync(wallet.address)
                .then(() => setCopied(true))
                .catch(() =>
                  showToast({
                    title: 'Could not copy address',
                    description: 'Please try again.',
                    tone: 'error',
                  }),
                )
            }}
          >
            {copied ? (
              <Check size={20} color={colors.positive} />
            ) : (
              <Copy size={20} color={colors.icon} />
            )}
          </Pressable>
        </View>
        <Button
          title="Balances and account"
          variant="secondary"
          onPress={() => {
            setWalletOpen(false)
            navigation.navigate('Account')
          }}
        />
        <Button
          title="Disconnect"
          variant="ghost"
          onPress={() => {
            void wallet
              .disconnect()
              .then(() => setWalletOpen(false))
              .catch(() =>
                showToast({
                  title: 'Could not disconnect',
                  description: 'Please try disconnecting again.',
                  tone: 'error',
                }),
              )
          }}
        />
      </Drawer>
    </View>
  )
}

function Navigation() {
  return (
    <NavigationContainer
      theme={{
        ...DarkTheme,
        colors: {
          ...DarkTheme.colors,
          primary: colors.accent,
          background: colors.background,
          card: colors.background,
          text: colors.text,
          border: colors.border,
        },
      }}
    >
      <View style={styles.navigation}>
        <Tab.Navigator
          tabBar={() => null}
          screenOptions={{
            header: () => <Header />,
            sceneStyle: { backgroundColor: 'transparent' },
          }}
        >
          <Tab.Screen name="Trade" component={TradeScreen} />
          <Tab.Screen name="Account" component={AccountScreen} />
        </Tab.Navigator>
        <ToastViewport />
        <FirstVisit />
      </View>
    </NavigationContainer>
  )
}

function Runtime() {
  const [fontsLoaded, fontError] = useFonts({
    IBMPlexSans_400Regular,
    IBMPlexSans_500Medium,
  })
  useEffect(() => {
    focusManager.setFocused(AppState.currentState === 'active')
    const subscription = AppState.addEventListener('change', (state) =>
      focusManager.setFocused(state === 'active'),
    )
    const unsubscribe = NetInfo.addEventListener((state) =>
      onlineManager.setOnline(
        state.isConnected !== false && state.isInternetReachable !== false,
      ),
    )
    return () => {
      subscription.remove()
      unsubscribe()
    }
  }, [])
  if (!fontsLoaded && !fontError) return <View style={styles.loading} />
  return (
    <QueryClientProvider client={queryClient}>
      <WalletProvider>
        <ToastProvider>
          <Navigation />
          <StatusBar style="light" />
        </ToastProvider>
      </WalletProvider>
    </QueryClientProvider>
  )
}

class ErrorBoundary extends Component<PropsWithChildren, { error: boolean }> {
  state = { error: false }
  static getDerivedStateFromError() {
    return { error: true }
  }
  componentDidCatch(_error: Error, _info: ErrorInfo) {
    /* Never log wallet/session payloads. */
  }
  render() {
    return this.state.error ? (
      <View style={styles.loading}>
        <Text style={{ textAlign: 'center', margin: 24 }}>
          Something went wrong while loading mato.
        </Text>
        <Button
          title="Reload app"
          onPress={() => this.setState({ error: false })}
        />
      </View>
    ) : (
      this.props.children
    )
  }
}
export default function App() {
  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <Runtime />
      </ErrorBoundary>
    </SafeAreaProvider>
  )
}

const styles = StyleSheet.create({
  navigation: { flex: 1, backgroundColor: colors.background },
  loading: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    paddingHorizontal: 24,
    paddingBottom: 12,
    backgroundColor: 'transparent',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  wordmark: {
    fontSize: 18,
    lineHeight: 24,
    fontFamily: fonts.regular,
  },
  networkText: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 16,
  },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  walletIdentity: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  copyButton: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  docsLink: { minHeight: 44, justifyContent: 'center' },
  docs: { fontSize: 14, color: colors.muted },
  walletButton: {
    minHeight: 36,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 40,
    borderWidth: 1,
    borderColor: colors.controlBorder,
    backgroundColor: colors.panel,
  },
  walletText: { fontSize: 14, lineHeight: 18 },
  preview: { color: colors.muted, fontSize: 11, lineHeight: 16, marginTop: 12 },
  walletError: { color: colors.negative, fontSize: 12, marginTop: 8 },
})
