# Android wallet integration

`WalletService` exposes wallet connection state to Flutter. Android invokes the
official Solana Mobile Kotlin SDK over the `app.mato/wallet` method channel; iOS,
web, and desktop expose a read-only preview. Private keys remain in the wallet.

The Android host extends `FlutterFragmentActivity` because MWA's
`ActivityResultSender` needs a `ComponentActivity`. `MatoWalletBridge` must be
constructed before the activity reaches `STARTED`, as done by `MainActivity`.
It pins `Solana.Mainnet` and the Mato identity at `https://mato.markets`.

Native authorization records contain the public key, auth token, wallet URI and
chain. They are encrypted with a non-exportable Android Keystore AES-256 key in
GCM mode. The atomic encrypted file resides in `noBackupFilesDir`; tokens never
cross the Flutter channel. Invalid records are discarded. Restore reads only the
cached account; signing always opens a new MWA session and checks fresh wallet
authorization against the account shown during review.

Signing accepts one serialized Solana transaction containing a single wallet
signature slot. The bridge checks that its fee payer matches the reviewed account,
reauthorizes on mainnet, checks the account and HTTPS wallet URI, and requests
`signAndSendTransactions` with preflight enabled and confirmed commitment. It
returns a real 64-byte Base58 signature. The caller must independently verify the
network/program, compile instructions, and wait for RPC confirmation. The wallet
lock only covers wallet operations; the transaction service must retain its own
lock through confirmation to prevent duplicate submissions.

Disconnect invalidates the local account immediately, including during an open
wallet request. Pending callbacks cannot persist or submit after invalidation.
Revocation in the wallet is best effort if no other wallet request is active.
An already submitted transaction cannot be cancelled; its receipt is retained.
Only normalized error codes cross the channel, without raw SDK payloads or tokens.

The network security configuration permits cleartext only to loopback addresses
used by MWA's encrypted local WebSocket session. API and RPC traffic require HTTPS.
For release, host Digital Asset Links at
`https://mato.markets/.well-known/assetlinks.json` for `markets.mato.mobile` and the
release signing certificate.

Run `flutter test test/wallet` for Flutter channel and state tests. Android
compilation verifies SDK compatibility; a physical device and installed MWA wallet
are still required to validate wallet handoff, account changes, session revocation,
cancellation, restored authorization, and actual approved transactions.

References: [Solana Mobile Kotlin setup](https://docs.solanamobile.com/get-started/kotlin/setup),
[MWA operations](https://docs.solanamobile.com/android-native/using_mobile_wallet_adapter),
[official Android SDK source](https://github.com/solana-mobile/mobile-wallet-adapter/tree/main/android).
