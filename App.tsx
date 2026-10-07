import { Component, useEffect, useState } from 'react'
import type { ErrorInfo, PropsWithChildren } from 'react'
import { AppState, StyleSheet, View } from 'react-native'
import { StatusBar } from 'expo-status-bar'
import { useFonts } from 'expo-font'
import { IBMPlexSans_400Regular } from '@expo-google-fonts/ibm-plex-sans/400Regular'
import { IBMPlexSans_500Medium } from '@expo-google-fonts/ibm-plex-sans/500Medium'
import { IBMPlexSans_600SemiBold } from '@expo-google-fonts/ibm-plex-sans/600SemiBold'
import { IBMPlexMono_400Regular } from '@expo-google-fonts/ibm-plex-mono/400Regular'
import {
  SafeAreaProvider,
  useSafeAreaInsets,
} from 'react-native-safe-area-context'
import { DarkTheme, NavigationContainer } from '@react-navigation/native'
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs'
import NetInfo from '@react-native-community/netinfo'
import {
  QueryClient,
  QueryClientProvider,
  focusManager,
  onlineManager,
} from '@tanstack/react-query'
import { ChartNoAxesCombined, Layers, Wallet } from 'lucide-react-native'
import { WalletProvider, useWallet } from '@/wallet'
import TradeScreen from '@/screens/TradeScreen'
import PositionsScreen from '@/screens/PositionsScreen'
import AccountScreen from '@/screens/AccountScreen'
import { Button, Text } from '@/components/ui'
import { colors, fonts } from '@/theme'
import { config } from '@/config'

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
const Tab = createBottomTabNavigator()

function Header() {
  const insets = useSafeAreaInsets()
  const wallet = useWallet()
  const [online, setOnline] = useState(true)
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
        <View style={styles.brand}>
          <Text style={styles.wordmark}>
            mato<Text style={{ color: colors.accent, fontSize: 32 }}>.</Text>
          </Text>
          <View style={styles.network}>
            <View
              style={[
                styles.dot,
                !online && { backgroundColor: colors.negative },
              ]}
            />
            <Text style={styles.networkText}>
              {online ? 'MAINNET' : 'OFFLINE'}
            </Text>
          </View>
        </View>
        <Button
          title={
            wallet.address
              ? `${wallet.address.slice(0, 4)}…${wallet.address.slice(-4)}`
              : 'Connect wallet'
          }
          onPress={() => {
            void wallet.connect().catch(() => {})
          }}
          loading={wallet.isConnecting}
          variant="secondary"
          disabled={!wallet.supported || Boolean(wallet.address)}
          style={styles.walletButton}
        />
      </View>
      {!config.transactionsEnabled && (
        <Text style={styles.preview}>
          Read-only preview · Mainnet market data
        </Text>
      )}
      {wallet.error && (
        <Text accessibilityRole="alert" style={styles.walletError}>
          {wallet.error}
        </Text>
      )}
    </View>
  )
}

function Navigation() {
  const insets = useSafeAreaInsets()
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
      <Tab.Navigator
        screenOptions={({ route }) => ({
          header: () => <Header />,
          tabBarActiveTintColor: colors.accent,
          tabBarInactiveTintColor: colors.muted,
          tabBarStyle: {
            backgroundColor: colors.background,
            borderTopColor: colors.border,
            paddingTop: 8,
            paddingBottom: Math.max(insets.bottom, 8),
            height: 64 + Math.max(insets.bottom, 8),
          },
          tabBarLabelStyle: {
            fontFamily: fonts.medium,
            fontSize: 11,
            marginBottom: 2,
          },
          tabBarIcon: ({ color, size }) => {
            const Icon =
              route.name === 'Trade'
                ? ChartNoAxesCombined
                : route.name === 'Positions'
                  ? Layers
                  : Wallet
            return <Icon color={color} size={size - 2} />
          },
          sceneStyle: { backgroundColor: colors.background },
        })}
      >
        <Tab.Screen name="Trade" component={TradeScreen} />
        <Tab.Screen name="Positions" component={PositionsScreen} />
        <Tab.Screen name="Account" component={AccountScreen} />
      </Tab.Navigator>
    </NavigationContainer>
  )
}

function Runtime() {
  const [fontsLoaded, fontError] = useFonts({
    IBMPlexSans_400Regular,
    IBMPlexSans_500Medium,
    IBMPlexSans_600SemiBold,
    IBMPlexMono_400Regular,
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
        <Navigation />
        <StatusBar style="light" />
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
  loading: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 14,
    backgroundColor: colors.background,
    borderBottomWidth: 1,
    borderBottomColor: '#232323',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  brand: { gap: 2 },
  wordmark: {
    fontSize: 32,
    lineHeight: 38,
    letterSpacing: -1.5,
    fontFamily: fonts.semibold,
  },
  network: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  dot: {
    height: 5,
    width: 5,
    backgroundColor: colors.positive,
    borderRadius: 3,
  },
  networkText: {
    color: colors.muted,
    fontSize: 8,
    lineHeight: 10,
    letterSpacing: 1.4,
    fontFamily: fonts.mono,
  },
  walletButton: { minHeight: 42, paddingHorizontal: 13, paddingVertical: 8 },
  preview: { color: colors.muted, fontSize: 11, lineHeight: 16, marginTop: 12 },
  walletError: { color: colors.negative, fontSize: 12, marginTop: 8 },
})
