# mato mobile

Native Android client for the `mato-ui` **v1** SOL/USDC streaming exchange. Built with Expo 57, React Native 0.86, Solana Kit 6, and Solana Mobile Wallet Adapter. The phone interface follows the `mato-design` handover, with its dark surfaces, IBM Plex Sans typography, orange charts, compact stream lists, and bottom sheets. The verified mainnet market, generated program client, and settlement arithmetic are retained.

## Run

Use Node 24 and pnpm 12.3.4. Install Android Studio and **JDK 17** for local Android builds. In Android Studio's SDK Manager, install Android SDK Platform 36, Build-Tools 36.0.0, NDK 27.1.12297006, CMake 3.22.1, Platform-Tools, and an emulator system image (ARM64 on Apple Silicon). Connect an Android device or start an emulator; wallet connection additionally requires an MWA-compatible wallet on that device.

```sh
pnpm install --frozen-lockfile --ignore-scripts
cp .env.example .env
pnpm android
```

`pnpm android` generates/builds the native app and starts Metro. For subsequent development sessions, use `pnpm start`. **Expo Go is unsupported:** MWA and native crypto require a development build. Wallet connection is Android-only; iOS and web render a read-only preview.

The Android launcher selects an installed JDK 17, including a JDK previously downloaded by Gradle, and sets `JAVA_HOME` only for the build process. Check its selection with `pnpm android --check-java`. It does not install Java or edit your shell profile. For builds launched inside Android Studio, select the same JDK 17 under **Settings → Build, Execution, Deployment → Build Tools → Gradle → Gradle JDK**.

On macOS, configure the SDK location in your terminal if needed:

```sh
export ANDROID_HOME="$HOME/Library/Android/sdk"
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"
```

If `configureCMakeDebug` fails with `WARNING: A restricted method in java.lang.System has been called`, the build may be using Java 25 from Android Studio. Prefab's child Java process emits a native-access warning that the Android Gradle plugin interprets as an error. Use JDK 17, as [React Native recommends](https://reactnative.dev/docs/0.86/set-up-your-environment#java-development-kit); `pnpm android` handles this selection. General Gradle support for Java 25 does not mean all Android native build tools support it. See the [upstream Prefab warning fix](https://android.googlesource.com/platform/tools/base/%2B/7363aa09c7a3a92f538e398fee6a47218ed3a373).

```sh
pnpm web                 # browser preview
pnpm check               # TypeScript + domain/protocol/wallet tests
pnpm export:android      # Android Hermes bundle; does not compile an APK
pnpm export:web          # browser bundle
pnpm format:check
pnpm mainnet:verify      # read-only backend/cluster health check
```

## Included

- Trade: live SOL/USDC price, line/candle charts, 1H/1D/1W ranges, order book and side filter.
- Streams: buy/sell, grouped inputs with exact atom amounts, 25/50/75/Max balance shortcuts, automatic duration, a Customize sheet with a live-liquidity impact curve, 5-second to 1-year durations, expandable rate/impact details, and a frozen review before wallet approval.
- Positions: active streams, authoritative fill/refund accounting, pause/resume, withdrawal, simulated settlement review, and batch closing up to two ended streams.
- History: pagination, fees, refunds, net receipts, explorer links, start/average fill summaries and actual/explicitly estimated dates.
- Wallet: address copy and disconnect in a sheet; Balances and account opens balances, interval-account inventory, and reclaiming eligible rent in batches of ten.
- Native behavior: a single order-first trading page, Active/Closed position drawers, safe areas, keyboard-aware forms, accessible controls, pull-to-refresh, foreground/focused-screen polling, reconnect handling and visible request errors.

The handover's simulated NVDAx market is adapted to the supported SOL/USDC market. Limit prices are not shown because the current program has no limit-price parameter. Customize uses real market liquidity and retains the existing duration recommendation; it does not invent the prototype's 30-day movement counts or fee quote. Personal fill-history data is unavailable, so stream sheets show the known starting market price and average fill, with an explicit history-unavailable label. Wallet actions retain a combined approval/confirmation state because the native adapter does not expose separate UI phases. Transaction toasts link to the real signature.

## Mainnet configuration

Android trading is enabled by default in local development and all EAS profiles. Each order still requires review and approval in the connected wallet. Set `EXPO_PUBLIC_ENABLE_TRANSACTIONS=false` to explicitly build a read-only client. The program ID remains pinned; an explicitly supplied `EXPO_PUBLIC_VERIFIED_PROGRAM_ID` must match `TwobwMYkKbT8uMWqgPrEPXTPoyYsKAPmaWun6T2WT4A`. Web and iOS still provide a visual preview because wallet signing is Android-only.

All `EXPO_PUBLIC_*` configuration is public inside the app binary. Use a credential-free HTTPS RPC proxy that keeps provider secrets on your server. The public mainnet RPC is a development fallback with rate limits and possible browser-origin restrictions; production needs a reliable endpoint. The read API has its own availability and latency. No prices, balances or histories are fabricated when a service is unavailable.

Before each mutation, the app verifies the RPC's full mainnet genesis hash, deployed executable program, market owner, market ID and mints. Integer atom arithmetic, idempotent receiving-token-account creation, SOL wrapping, fee reserves, simulation, and confirmed settlement are preserved. A shared transaction lock prevents concurrent submissions. Confirmation errors retain the signature so a submitted transaction can be checked before retrying.

Wallets keep private keys. Authorization is stored in encrypted SecureStore, excluded from Android backups, and bound to the selected account. The app reauthorizes before signing; changed or revoked accounts require a new review. A release still requires protocol/security review and real-device validation; automated checks do not establish contract safety.

## Architecture and provenance

- `src/screens/`: native Trade, Positions and Account screens.
- `src/wallet/`: Android MWA provider, secure cache, signer and platform fallbacks.
- `src/features/trading/`: v1 protocol/data port and its regression tests.
- `src/features/orders/`: mobile order validation.
- `src/lib/generated/` and `src/lib/idl/`: checked-in v1 client/IDL; do not replace with another program's IDL.
- `src/config.ts`: pinned network identity and transaction policy.

Ported from `Nachtschatten-Labs/mato-ui` branch `v1`, protocol snapshot `482502e`. The subsequent v1 commit `de6f9dd` only changes web closed-row spacing; native history uses its own cards. Source constants remain `ARRAY_LENGTH=16`, `END_SLOT_INTERVAL=11`, with a 200 ms assumed slot duration. The sole supported market is `FUDH6hiwDNjdQKbH7fveFFPoEE3mXk9i1g2WbgnSqob3`.

Dependencies are exactly pinned and lifecycle scripts are disabled in `pnpm-workspace.yaml`. TypeScript 5.9 is intentionally retained for Kit 6's declared peer range instead of Expo's suggested TypeScript 6. Native folders are generated by Expo and ignored; change `app.config.ts` rather than editing generated native files.

See [release validation](docs/RELEASE.md) for device checks and build preparation, and [wallet integration](src/wallet/README.md) for the Solana Mobile documentation links.
