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
        <Button
          title={
            route.name === 'Account'
              ? 'Back to trading'
              : wallet.address
                ? `${wallet.address.slice(0, 4)}…${wallet.address.slice(-4)}`
                : 'Connect wallet'
          }
          onPress={() => {
            if (route.name === 'Account') navigation.navigate('Trade')
            else if (wallet.address) navigation.navigate('Account')
            else void wallet.connect().catch(() => {})
          }}
          loading={wallet.isConnecting}
          variant="secondary"
          disabled={!wallet.supported && route.name !== 'Account'}
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
        tabBar={() => null}
        screenOptions={{
          header: () => <Header />,
          sceneStyle: { backgroundColor: colors.background },
        }}
      >
        <Tab.Screen name="Trade" component={TradeScreen} />
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
    paddingHorizontal: 16,
    paddingBottom: 10,
    backgroundColor: colors.background,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  wordmark: {
    fontSize: 22,
    lineHeight: 30,
    letterSpacing: -0.7,
    fontFamily: fonts.semibold,
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
