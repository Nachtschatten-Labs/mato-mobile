import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'data/config.dart';
import 'data/market_repository.dart';
import 'state/app_controller.dart';
import 'wallet/wallet_service.dart';
import 'ui/account_sheet.dart';
import 'ui/theme.dart';
import 'ui/trade_screen.dart';
import 'ui/widgets.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  SystemChrome.setSystemUIOverlayStyle(
    const SystemUiOverlayStyle(
      statusBarColor: Colors.transparent,
      statusBarIconBrightness: Brightness.light,
      systemNavigationBarColor: MatoColors.background,
      systemNavigationBarIconBrightness: Brightness.light,
    ),
  );
  try {
    final config = AppConfig.fromEnvironment();
    runApp(
      MatoApp(
        controller: AppController(
          config: config,
          repository: MarketRepository(config: config),
          wallet: WalletService(),
        ),
      ),
    );
  } catch (error) {
    runApp(
      MaterialApp(
        theme: matoTheme(),
        home: Scaffold(
          body: SafeArea(
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: Center(
                child: Notice(
                  'App configuration is invalid. ${errorText(error)}',
                  error: true,
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class MatoApp extends StatefulWidget {
  const MatoApp({
    super.key,
    required this.controller,
    this.showOnboarding = true,
  });
  final AppController controller;
  final bool showOnboarding;
  @override
  State<MatoApp> createState() => _MatoAppState();
}

class _MatoAppState extends State<MatoApp> with WidgetsBindingObserver {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    unawaited(widget.controller.start());
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) =>
      widget.controller.setForeground(state == AppLifecycleState.resumed);
  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    widget.controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => MaterialApp(
    title: 'mato',
    debugShowCheckedModeBanner: false,
    theme: matoTheme(),
    home: _Home(app: widget.controller, showOnboarding: widget.showOnboarding),
  );
}

class _Home extends StatefulWidget {
  const _Home({required this.app, required this.showOnboarding});
  final AppController app;
  final bool showOnboarding;
  @override
  State<_Home> createState() => _HomeState();
}

class _HomeState extends State<_Home> {
  @override
  void initState() {
    super.initState();
    if (widget.showOnboarding) {
      WidgetsBinding.instance.addPostFrameCallback((_) => _onboarding());
    }
  }

  Future<void> _onboarding() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      if (prefs.getBool('mato.intro.seen') == true || !mounted) return;
      await showMatoSheet<void>(
        context,
        title: 'A little at a time.',
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text(
              'Trade without picking a single moment.',
              style: TextStyle(fontSize: 28, height: 1.2, letterSpacing: -.8),
            ),
            const SizedBox(height: 22),
            const Text(
              'Choose an amount. Mato spreads your trade over time, using continuous clearing auctions on Solana.',
              style: TextStyle(color: MatoColors.secondary, height: 1.6),
            ),
            const SizedBox(height: 16),
            const Detail('01', 'Choose SOL or USDC'),
            const Detail('02', 'Set your amount and duration'),
            const Detail('03', 'Review and approve in your wallet'),
            const SizedBox(height: 22),
            ActionButton(
              'Explore mato',
              onPressed: () => Navigator.pop(context),
            ),
          ],
        ),
      );
      await prefs.setBool('mato.intro.seen', true);
    } catch (_) {
      /* An unavailable preferences store must not block trading UI. */
    }
  }

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
    animation: widget.app,
    builder: (context, _) {
      final app = widget.app;
      return Scaffold(
        appBar: AppBar(
          toolbarHeight: 76,
          title: const Padding(
            padding: EdgeInsets.only(left: 5),
            child: Text(
              'mato',
              style: TextStyle(
                fontSize: 31,
                fontWeight: FontWeight.w500,
                letterSpacing: -1.5,
              ),
            ),
          ),
          actions: [
            Padding(
              padding: const EdgeInsets.only(right: 20),
              child: TextButton.icon(
                onPressed: () => showMatoSheet(
                  context,
                  title: app.wallet.isConnected
                      ? 'Your wallet'
                      : 'Connect wallet',
                  child: AccountSheet(app: app),
                ),
                style: TextButton.styleFrom(
                  backgroundColor: MatoColors.elevated,
                  padding: const EdgeInsets.symmetric(horizontal: 14),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(24),
                  ),
                ),
                icon: Icon(
                  app.wallet.isConnected
                      ? Icons.account_balance_wallet_outlined
                      : Icons.account_balance_wallet_outlined,
                  size: 16,
                ),
                label: Text(
                  app.wallet.address == null
                      ? 'Connect wallet'
                      : shortAddress(app.wallet.address!),
                  style: const TextStyle(fontSize: 12),
                ),
              ),
            ),
          ],
        ),
        body: SafeArea(top: false, child: TradeScreen(app: app)),
      );
    },
  );
}
