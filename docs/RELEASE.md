# Flutter release validation

## Automated checks

Use Flutter 3.47.6 and the committed lockfile. Run `flutter analyze`, `flutter test`, `flutter build apk --debug`, and `flutter build web --release`. Android compiles against API 37 with AGP 9.1.1, Kotlin 2.4.0, Gradle 9.3.1, and NDK 28.2.13676358. Check API/RPC identity without a wallet using `flutter pub run tool/verify_mainnet.dart`.

## Device acceptance

On an MWA-compatible Android device, verify connect, cancel, disconnect, restart, revoked authorization, wallet account switch and absence of a wallet. Check Seeker's Seed Vault Wallet and every other supported wallet.

Using reviewed small amounts, verify buy, sell with native/wrapped SOL, pause/resume, partial withdrawal, close/refund, batch close, and rent reclaim. Check receipts and fee deductions in Explorer. With network loss after submission, the signature must remain available and no automatic retry may occur.

Check history pagination, background/foreground refresh, narrow screens, large text, stale RPC data, and wallet changes during review. Authorization must not appear in Android backups. Only loopback cleartext traffic is allowed.

Automated fixtures and simulations are not evidence of a completed real-wallet trade. Device signing acceptance is a separate check.

## Distribution

The generated release signing configuration uses debug credentials for local testing. Configure the existing distribution signing key and production credential-free RPC endpoint before publishing. Keep application ID `markets.mato.mobile` for updates. Never commit signing credentials.

iOS and web do not implement wallet signing. iOS native compilation needs Xcode/CocoaPods and is not covered by the Android acceptance build.
