# mato mobile · Flutter

Native Flutter client for mato's SOL/USDC streaming exchange. This branch replaces React Native with Dart widgets, a Dart protocol client, and a Kotlin bridge to the official Solana Mobile Wallet Adapter SDK. Android supports wallet signing; iOS and web provide a read-only market experience.

## Run

Use **Flutter 3.47.6 / Dart 3.13.5**, Android Studio, and a JDK supported by Gradle 9.3.1 (JDK 17 or newer). Install Android SDK Platform **37**, Build Tools 36.0.0, and NDK **28.2.13676358**. Target SDK remains 36; the wallet dependency requires compile SDK 37. Android native sources are checked in.

```sh
./tool/flutterw pub get
./tool/flutterw run
```

`tool/flutterw` uses `MATO_FLUTTER_SDK`, Flutter on PATH, or the project-local `.tools/flutter` SDK. On a new machine, install Flutter normally or run `./tool/bootstrap_flutter.sh` to install the pinned SDK in `.tools/`.

Connect a device or start an Android emulator. Signing requires an installed MWA-compatible wallet. Release builds retain application ID `markets.mato.mobile`; debug builds use `markets.mato.mobile.flutter` so they can coexist with the React Native app. Wallets keep the private keys.

```sh
./tool/flutterw analyze
./tool/flutterw test
./tool/flutterw build apk --debug
./tool/flutterw run -d chrome                  # read-only browser preview
./tool/flutterw build web --release
./tool/flutterw pub run tool/verify_mainnet.dart # read-only network checks
```

The APK is `build/app/outputs/flutter-apk/app-debug.apk`. See [release validation](docs/RELEASE.md) before distribution or mainnet device acceptance.

## Configuration

Flutter uses compile-time Dart defines, not Expo environment variables. Defaults retain the existing backend, public mainnet RPC, pinned program, and enabled Android trading. Each mutation requires explicit user action and wallet approval.

```sh
cp config.example.json config.local.json
./tool/flutterw run --dart-define-from-file=config.local.json
# Explicitly read-only build:
./tool/flutterw run --dart-define=ENABLE_TRANSACTIONS=false
```

| Define | Default |
| --- | --- |
| `READ_API_URL` | `https://read-api-production-f8ea.up.railway.app` |
| `RPC_URL` | `https://api.mainnet-beta.solana.com` |
| `ENABLE_TRANSACTIONS` | `true` |
| `VERIFIED_PROGRAM_ID` | `TwobwMYkKbT8uMWqgPrEPXTPoyYsKAPmaWun6T2WT4A` |

Endpoints must use HTTPS. Defines are public in the binary; use a credential-free RPC proxy for production. Public RPC requests can be rate-limited. Missing or stale market data is shown explicitly and blocks affected mutations. The sole supported market remains `FUDH6hiwDNjdQKbH7fveFFPoEE3mXk9i1g2WbgnSqob3`.

## Included

- Dark phone interface with bundled IBM Plex Sans, exact amount input, buy/sell, balance shortcuts and slider, automatic/customized duration, impact curve and frozen review.
- Live prices, line/candle charts, 1H/1D/1W ranges, filtered order book, pull-to-refresh and foreground polling.
- Active/closed streams, fill/refund accounting, pause/resume, withdrawal, simulated close receipts, batch closing two positions, paginated history, price-history charts and explorer links.
- Wallet connection/restoration, copy/disconnect, balances, funded account inventory and rent reclaim batches of ten.
- Mainnet genesis/program/market verification, integer token atoms, canonical token accounts, SOL wrapping, fee reserves, simulation before signing, account-change guards and a lock through confirmation. Ambiguous confirmations retain their signature and are never automatically retried.

The Android bridge uses official `mobile-wallet-adapter-clientlib-ktx:2.2.0`. Authorization stays in native AES-GCM storage encrypted by Android Keystore and excluded from backup. Only loopback HTTP is allowed for MWA; remote APIs require HTTPS. See [wallet integration](lib/wallet/README.md).

## Structure and provenance

- `lib/ui/`: trading, account, chart and stream widgets.
- `lib/state/`: lifecycle polling, resource errors and wallet-scoped state.
- `lib/data/`, `lib/domain/`: API/RPC models, exact arithmetic, duration and settlement replay.
- `lib/protocol/`: wire codecs, PDAs, instructions and transaction lifecycle.
- `lib/wallet/` and `android/app/src/main/kotlin/markets/mato/mobile/`: Dart interface and Kotlin bridge.
- `idl/`: original IDL; `test/protocol/fixtures/`: independent Codama bytes and a live-account fixture.

Ported from React Native commit `6e606f4cea213f2b7810c43c7f3376037932b337`, itself based on mato-ui v1 protocol snapshot `482502e`. The original implementation remains on `main`. Constants remain `ARRAY_LENGTH=16`, `END_SLOT_INTERVAL=11`, and assumed slot duration 200 ms. No JavaScript runtime, WebView, or Node build dependency is used.

Tests compare instructions against original Codama output, check the IDL wire contract, independently decode transactions, and exercise exact amounts, settlement, transaction guards, wallet failures and screen states. Real-wallet acceptance remains necessary.
