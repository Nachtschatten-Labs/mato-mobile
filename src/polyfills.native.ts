// Expo installs TextDecoder, URL, streams and AbortSignal helpers; Hermes
// supplies TextEncoder. Initialize them before native crypto and Kit imports.
import 'expo'
import { install } from 'react-native-quick-crypto'

// Loaded before React, the router and every Solana import. This supplies the
// native crypto/Buffer APIs required by Kit and MWA in a development build.
install()
