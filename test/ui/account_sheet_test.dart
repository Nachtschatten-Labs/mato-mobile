import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mato_mobile/data/config.dart';
import 'package:mato_mobile/data/market_repository.dart';
import 'package:mato_mobile/domain/models.dart';
import 'package:mato_mobile/state/app_controller.dart';
import 'package:mato_mobile/ui/account_sheet.dart';
import 'package:mato_mobile/ui/theme.dart';
import 'package:mato_mobile/wallet/wallet_service.dart';

class _Wallet extends WalletService {
  _Wallet({this.owner, this.fail = false, bool supported = true})
    : super(supported: supported);
  String? owner;
  bool fail;
  int connections = 0;
  @override
  String? get address => owner;
  @override
  bool get isConnected => owner != null;
  @override
  Future<void> connect() async {
    connections++;
    if (fail) throw const WalletException('cancelled');
    owner = '11112222333344445555666677778888';
    notifyListeners();
  }

  @override
  Future<void> disconnect() async {
    owner = null;
    notifyListeners();
  }
}

class _Repository extends MarketRepository {
  @override
  Future<WalletBalances> fetchBalances(String owner) async => WalletBalances(
    lamports: BigInt.from(1000000000),
    wrappedSol: BigInt.zero,
    usdc: BigInt.from(1000000),
  );
  @override
  Future<List<PositionRecord>> fetchPositions(String owner) async => [];
  @override
  Future<List<IntervalAccount>> fetchOwnedIntervals(String owner) async => [];
}

Future<void> _render(WidgetTester tester, _Wallet wallet) async {
  tester.view.physicalSize = const Size(320, 844);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  final app = AppController(
    config: const AppConfig(transactionsEnabled: false),
    repository: _Repository(),
    wallet: wallet,
  );
  addTearDown(app.dispose);
  await tester.pumpWidget(
    MaterialApp(
      theme: matoTheme(),
      home: Scaffold(
        body: SingleChildScrollView(
          padding: const EdgeInsets.all(20),
          child: AccountSheet(app: app),
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('native connect reports a declined request and can retry', (
    tester,
  ) async {
    final wallet = _Wallet(fail: true);
    await _render(tester, wallet);
    expect(find.text('Mobile wallet'), findsOneWidget);
    expect(find.text('Phantom'), findsNothing);
    await tester.tap(find.text('Connect'));
    await tester.pumpAndSettle();
    expect(find.text("Wallet didn't connect"), findsOneWidget);
    expect(
      find.text('The request was declined or closed in your wallet.'),
      findsOneWidget,
    );
    expect(wallet.connections, 1);
    wallet.fail = false;
    await tester.tap(find.text('Try again'));
    await tester.pumpAndSettle();
    expect(find.text('Connected'), findsOneWidget);
    expect(find.text('Disconnect'), findsOneWidget);
    expect(wallet.connections, 2);
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'connected wallet keeps compact menu and copies its real address',
    (tester) async {
      const address = '123456789abcdef123456789abcdef';
      String? clipboard;
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(SystemChannels.platform, (call) async {
            if (call.method == 'Clipboard.setData') {
              clipboard = (call.arguments as Map)['text'] as String;
            }
            return null;
          });
      addTearDown(
        () => TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
            .setMockMethodCallHandler(SystemChannels.platform, null),
      );
      await _render(tester, _Wallet(owner: address));
      expect(find.text('Balances'), findsNothing);
      expect(find.text('Reclaim Rent'), findsNothing);
      await tester.tap(find.bySemanticsLabel(RegExp('Copy wallet address')));
      await tester.pump();
      expect(clipboard, address);
      expect(find.byIcon(Icons.check_rounded), findsOneWidget);
      await tester.pump(const Duration(milliseconds: 1600));
      expect(find.byIcon(Icons.copy_outlined), findsOneWidget);
      await tester.tap(find.text('Account details'));
      await tester.pumpAndSettle();
      expect(find.text('Balances'), findsOneWidget);
      expect(find.text('Read-only'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'unsupported device explains native signing without a fake connection',
    (tester) async {
      final wallet = _Wallet(supported: false);
      await _render(tester, wallet);
      await tester.tap(find.text('Connect'));
      await tester.pumpAndSettle();
      expect(wallet.connections, 0);
      expect(
        find.textContaining('available in the Android app'),
        findsOneWidget,
      );
      expect(tester.takeException(), isNull);
    },
  );
}
