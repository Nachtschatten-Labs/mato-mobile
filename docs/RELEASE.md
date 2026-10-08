# Android release validation

This repository contains an Android-first implementation. The ARM64 debug APK has been built, installed and launched on an Android emulator with live market data. Physical-device wallet checks and release validation remain outstanding. A successful JavaScript/Hermes export alone is not an APK build or a wallet/device smoke test. iOS wallet connectivity is not included.

## Build preparation

1. Confirm the Android application ID (`markets.mato.mobile`), app name, version and signing key ownership before publishing.
2. Provision a reliable, credential-free mainnet RPC proxy and verify the configured read API with `pnpm mainnet:verify`. Do not embed provider credentials in the binary.
3. Install JDK 17, Android Studio, the Android SDK/NDK versions requested by the generated Expo project and a supported device/emulator. Run `pnpm android` for a development build; the launcher selects an installed JDK 17. An ARM64 debug APK was successfully built locally with JDK 17, SDK 36, Build-Tools 36.0.0, NDK 27.1.12297006 and CMake 3.22.1 on 2026-10-07. Release signing and physical-device wallet checks remain separate requirements.
4. Alternatively initialize an EAS project with your Expo account, then build the `development` or `preview` profile. `eas.json` produces APKs suitable for Android device testing and eventual Solana dApp Store submission. No EAS project, remote build, signing key or store release is created automatically.
5. Serve Digital Asset Links at `https://mato.markets/.well-known/assetlinks.json`, associating `markets.mato.mobile` with the SHA-256 fingerprint of the **release** signing certificate. Verify wallet identity with the actual release build.
6. Prepare dApp Store metadata, privacy policy, contact information, artwork and release signing externally. App code does not provision store identities or accept store agreements.

## Device checks

- Launch on a physical Seeker/Saga or supported Android phone with an MWA wallet. Confirm local bundled fonts, splash, safe areas, Android back, keyboard, large text and screen-reader controls.
- Connect, reject connection, reconnect after process death, revoke wallet authorization, switch accounts, disconnect while a wallet request is pending, and uninstall/reinstall. Old authorization must not return from Android backup.
- Confirm the first-visit risk sheet persists until accepted and stays dismissed after relaunch. Check the 390px phone layout against `mato-design` M01–M12: Buy/Sell, amount and balance shortcuts, duration Customize, receive/rate expansion, market picker, compact stream lists, and receipt sheets.
- Confirm there is no bottom navigation or marketing heading. Open active and closed positions, scroll the drawers, and dismiss using the close button, backdrop, Android back, or handle swipe. Pending transactions must prevent their sheet from dismissing. Check the connected wallet button opens the wallet sheet, copy/disconnect work, and Balances and account opens Account and returns to trading.
- Check decimal input on both period and comma keyboards, exact SOL/USDC precision, grouping while editing in the middle, Customize apply/reset, and keyboard visibility in sheets. Missing liquidity must show unavailable estimates rather than an amount-too-small error or a fabricated zero.
- Inspect chart ranges, line/candle mode, order-book filters, paused/zero-flow markets, unavailable prices, offline/reconnection, API errors and foreground/background polling.
- Confirm an explicitly disabled build (`EXPO_PUBLIC_ENABLE_TRANSACTIONS=false`) cannot submit even with a connected wallet. Default Android development, preview and production builds allow wallet-approved trades. Verify public RPC rate-limit errors appear without fake values.
- In a transaction-enabled Android build, verify buy/sell reviews, high-impact acknowledgment, account changes, Smart fill duration stability, insufficient balance, missing receiving ATA, partial wrapped SOL, cancellation and confirmation timeout. Use controlled funds and explicitly approved transactions.
- Exercise pause/resume/withdraw and close simulations against known positions. Compare end-slot settlement, inactive-slot refunds, net fees and receiver addresses with on-chain results. Check a two-position batch close and ten-account rent batch, including failure/retry behavior.
- During confirmation, open account controls and attempt another mutation: it must fail without silently queueing. If confirmation becomes unknown, inspect the preserved transaction signature before retrying.

## Checks

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm check
pnpm format:check
pnpm exec expo install --check
pnpm export:android
pnpm audit --prod --audit-level high
```

Automated tests cover the protocol client and accounting, order validation, live-network identity checks, confirmation lifecycle and locking, close-review validation, secure authorization caching and wallet receipt validation. They do not emulate Android wallet handoff or verify deployed contracts.

## Dependency audit, 2026-10-07

The audit reports **two high and one moderate upstream tooling findings**. The high advisories affect `node-forge` ([GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv)) in Expo CLI/code-signing tooling and `braces` ([GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)) in Metro/micromatch; neither has a published fixed version. The moderate [uuid advisory](https://github.com/advisories/GHSA-w5hq-g745-h8pq) comes through Expo config-plugins/xcode; the installed caller only uses `v4()`, which the advisory excludes. These are build/development paths, not application wallet imports. Recheck the audit and supported Expo updates before release. No unsupported major override, unreviewed fork, or advisory suppression is introduced to silence the report.
