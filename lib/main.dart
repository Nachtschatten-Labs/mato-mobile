import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'data/config.dart';
import 'data/market_repository.dart';
import 'state/app_controller.dart';
import 'wallet/wallet_service.dart';
import 'ui/account_sheet.dart';
import 'ui/brand.dart';
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
    if (!widget.app.config.transactionsEnabled) return;
    SharedPreferences? prefs;
    final today = DateTime.now().toUtc().toIso8601String().substring(0, 10);
    try {
      prefs = await SharedPreferences.getInstance();
      if (prefs.getString('mato-risk-disclaimer-accepted') == today) return;
    } catch (_) {
      // Still show the acknowledgement if persistence is unavailable.
    }
    if (!mounted) return;
    await showMatoSheet<void>(
      context,
      title: 'Experimental Protocol',
      dismissible: false,
      showClose: false,
      child: Builder(
        builder: (sheetContext) => Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Align(
              alignment: Alignment.centerLeft,
              child: Icon(
                Icons.warning_amber_rounded,
                color: MatoColors.caution,
                size: 22,
              ),
            ),
            const SizedBox(height: 12),
            const Text(
              'This application is in an early experimental phase. Liquidity is low and smart contracts have not been fully audited. There is a significant risk of losing some or all of your funds.',
              style: TextStyle(
                color: MatoColors.muted,
                fontSize: 14,
                height: 1.5,
              ),
            ),
            const SizedBox(height: 24),
            ActionButton(
              'I understand the risks',
              onPressed: () => Navigator.pop(sheetContext),
            ),
          ],
        ),
      ),
    );
    try {
      await prefs?.setString('mato-risk-disclaimer-accepted', today);
    } catch (_) {
      // A storage failure must not prevent the acknowledged session.
    }
  }

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
    animation: widget.app,
    builder: (context, _) {
      final app = widget.app;
      return ForestBackdrop(
        child: Scaffold(
          backgroundColor: Colors.transparent,
          appBar: AppBar(
            toolbarHeight: 80,
            title: const MatoLogo(),
            actions: [
              Padding(
                padding: const EdgeInsets.only(right: 16),
                child: TextButton(
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
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Icon(
                        Icons.account_balance_wallet_outlined,
                        size: 14,
                        color: MatoColors.muted,
                      ),
                      const SizedBox(width: 8),
                      Text(
                        app.wallet.address == null
                            ? 'Connect wallet'
                            : shortAddress(app.wallet.address!),
                        style: const TextStyle(fontSize: 12),
                      ),
                      const SizedBox(width: 12),
                      const Icon(
                        Icons.keyboard_arrow_down,
                        size: 14,
                        color: MatoColors.muted,
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
          body: SafeArea(top: false, child: TradeScreen(app: app)),
        ),
      );
    },
  );
}
