# Android wallet integration

`WalletProvider` resolves to the Android implementation in native Android builds and a read-only fallback on web/iOS. MWA requires a custom Expo development build and an installed compatible wallet; Expo Go does not contain the Kotlin module. The app uses Solana Kit 6 with Wallet UI 4.2.1, whose published dependency range supports that Kit major.

Authorization tokens are saved only through `expo-secure-store`. Invalid cached data is discarded, writes are serialized with disconnect, and signing reauthorizes the same reviewed account before submitting. Wallets own the private keys. A cancelled or expired authorization cannot silently replace the transaction signer. Disconnect clears local credentials immediately and attempts wallet-side revocation when no request is in progress.

Keep the `expo-secure-store` config plugin enabled so Android backups exclude encrypted credentials that cannot be recovered after reinstall. For release, serve Digital Asset Links for the final Android application ID and signing certificate at `https://mato.markets/.well-known/assetlinks.json`; MWA wallets use the identity URI to verify app ownership.

Sources: [Solana Mobile installation](https://docs.solanamobile.com/get-started/react-native/installation), [provider setup](https://docs.solanamobile.com/get-started/react-native/setup), [authorization caching](https://docs.solanamobile.com/recipes/mobile-wallet-adapter/caching-wallet-authorization), [iOS limitations](https://docs.solanamobile.com/recipes/mobile-wallet-adapter/wallet-signing-on-ios), [Expo SecureStore](https://docs.expo.dev/versions/latest/sdk/securestore/).
