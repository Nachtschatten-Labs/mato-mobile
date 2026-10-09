# Flutter mobile design parity

Reference: `mato-ui` branch `v1`, commit `1ecc381`, and the 9 October 2026 Dark Forest handover in `mato-design`. The implemented v1 mobile app takes precedence where the archived prototype's component boards differ. The Flutter migration is preserved separately on the `flutter` base branch.

## Comparison and implementation

| Surface | v1 reference | Native implementation |
| --- | --- | --- |
| Brand and page | `navbar.tsx`, `styles.css`, `design/tokens.css` | Exact mint SVG wordmark, 88px mobile header, Dark Forest surfaces, sage accents, IBM Plex Sans 400/500 and tabular numbers, subtle forest backdrop, 20px cards and 32px card gaps. Updated Android, iOS and web app icons. |
| Trade form | `order-entry-card.tsx` | Buy/Sell pill, You pay, Max, expandable percentage slider and shortcuts, minimum/balance feedback, Smart fill, receive block, rate flip, expandable impact/fee detail, stream CTA. |
| Duration | v1 duration dialog, quote and slider helpers | Amount-dependent recommendation, custom stepped duration from 5 seconds to a year, reset to recommendation, finish time, liquidity curve, impacted execution price, actual on-chain fee and net receive. Draft changes apply only when accepted. |
| Market | v1 market selector, price chart and book | Search/category/favorite controls for the supported SOL/USDC market, 1H/1D/1W, area/candlestick views, crosshair, pan/pinch/reset, sortable horizontally scrollable order book. |
| Active streams | `active-position-card.tsx` | Responsive expanded cards with compact action controls; collapse, spent/average fill, net available proceeds, withdrawn amount, start/remaining time, price history, wallet actions and frozen close review. No invented streams. |
| Closed streams | v1 closed-position list | Three-column phone table with inline expandable receipts, real fees, net output and refunds, history pagination and explorer links. |
| Wallet | `wallet-connection-button.tsx` | Compact connected panel, copy acknowledgement, rent reclaim and disconnect. Native account inventory and balances remain accessible under Account details. |
| Risk and feedback | `risk-disclaimer-dialog.tsx`, Sonner styling | UTC-day risk acknowledgement, keyboard-safe bottom sheets, native eight-second status toasts with countdown, hold-to-read, dismissal and View tx. |

## Platform-specific behavior

- Android uses the installed-wallet picker supplied by Solana Mobile Wallet Adapter. The bridge does not return a browser connector name; the app identifies it as a mobile wallet. iOS and browser previews retain their explicit read-only signing state.
- The native app keeps its frozen transaction review and account-change, stale-data, simulation and confirmation guards. Matching the interface does not remove those safeguards.
- Native charts render real repository data directly in Flutter. Pan and zoom cover the fetched range; TradingView's older-history backfill and position overlays are not ported in this change. The 24-hour comparison is unavailable unless an independent reference exists; it is not inferred from a selected one-hour range.
- The deployment supports SOL/USDC. Empty market categories remain empty and do not advertise unsupported trading pairs.

## Verification

The focused tests exercise 320px and 390px layouts, exact amount entry, side reset, duration apply/reset, fee-aware quotes, active/closed stream expansion, authoritative zero settlements, wallet cancellation/retry, copy feedback, chart selection and invalid data, keyboard-safe sheets, risk acceptance and toast lifecycle. The existing protocol, domain, controller and wallet suites remain in the full test run.

Visual baselines in `test/ui/goldens/` load the bundled font and render deterministic fixture data. Inspect them after running:

```sh
./tool/flutterw test test/ui/mobile_design_golden_test.dart --update-goldens
./tool/flutterw analyze
./tool/flutterw test
./tool/flutterw build apk --debug --dart-define=ENABLE_TRANSACTIONS=false
./tool/flutterw build web --release
```

Real-wallet signing still requires device acceptance as described in `RELEASE.md`.
