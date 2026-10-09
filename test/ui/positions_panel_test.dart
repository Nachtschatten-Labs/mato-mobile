import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mato_mobile/data/config.dart';
import 'package:mato_mobile/data/market_repository.dart';
import 'package:mato_mobile/domain/models.dart';
import 'package:mato_mobile/state/app_controller.dart';
import 'package:mato_mobile/ui/positions_panel.dart';
import 'package:mato_mobile/ui/theme.dart';
import 'package:mato_mobile/wallet/wallet_service.dart';

class TestWallet extends WalletService {
  TestWallet(this.owner) : super(supported: true);
  final String? owner;
  @override
  String? get address => owner;
  @override
  bool get isConnected => owner != null;
}

class TestRepository extends MarketRepository {
  TestRepository({this.closed = const []})
    : super(config: const AppConfig(transactionsEnabled: false));
  final List<ClosedPosition> closed;
  @override
  Future<List<MarketUpdate>> fetchHistory({
    required int startSlot,
    required int endSlot,
  }) async => [];
  @override
  Future<TradeSettlementSnapshot?> fetchSettlement(
    PositionRecord position, {
    int? bookkeepingLastUpdateSlot,
  }) async => TradeSettlementSnapshot(
    slot: position.endSlot,
    bookkeeping: BigInt.zero,
    slotsWithoutTrades: 10,
  );
  @override
  Future<PageResult<ClosedPosition>> fetchClosedPositions(
    String authority, {
    int? beforeSlot,
    int limit = 50,
  }) async => PageResult(items: closed, hasMore: false);
}

AppController controller({
  String? owner = 'owner',
  List<ClosedPosition> closed = const [],
}) =>
    AppController(
        config: const AppConfig(transactionsEnabled: false),
        repository: TestRepository(closed: closed),
        wallet: TestWallet(owner),
      )
      ..market = StreamingMarketState(
        currentSlot: 20,
        market: {
          'id': 1,
          'isPaused': 0,
          'baseFlow': BigInt.one,
          'quoteFlow': BigInt.one,
          'bookkeeping': {
            'lastUpdateSlot': BigInt.from(20),
            'basePerQuote': bookkeepingPrecision * BigInt.from(20),
            'quotePerBase': bookkeepingPrecision * BigInt.from(20),
            'slotsWithoutTrade': 0,
          },
          'minimumBaseDepositAtoms': BigInt.one,
          'minimumQuoteDepositAtoms': BigInt.one,
        },
      );

PositionRecord position({bool paused = false}) => PositionRecord(
  address: 'position',
  data: {
    'id': 42,
    'authority': 'owner',
    'market': MarketDefinition.sol.address,
    'amount': BigInt.from(100000000),
    'flow': BigInt.parse('10000000000000000'),
    'bookkeepingSnapshot': BigInt.zero,
    'inactiveRefund': BigInt.zero,
    'lastUpdateSlot': BigInt.from(paused ? 5 : 0),
    'startSlot': BigInt.zero,
    'remainingSlots': paused ? 5 : 10,
    'pausedAtSlot': BigInt.from(paused ? 5 : 0),
    'swappedAmountAtSnapshot': BigInt.from(paused ? 40000000 : 0),
    'withdrawnAmount': BigInt.from(paused ? 10000000 : 0),
    'slotsWithoutTradesSnapshot': 0,
    'side': 1,
    'feeBpsAtSubmission': 10,
  },
);

Future<void> render(WidgetTester tester, AppController app) async {
  await tester.pumpWidget(
    MaterialApp(
      theme: matoTheme(),
      home: Scaffold(
        body: SingleChildScrollView(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: PositionsPanel(app: app),
          ),
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  testWidgets(
    'disconnected streams request wallet connection without invented trades',
    (tester) async {
      final app = controller(owner: null);
      addTearDown(app.dispose);
      await render(tester, app);
      expect(find.text('Connect wallet'), findsOneWidget);
      expect(find.text('Your trades, at your pace'), findsOneWidget);
      expect(find.text('Streaming'), findsNothing);
    },
  );
  testWidgets('paused stream retains frozen claim and refund totals', (
    tester,
  ) async {
    final app = controller()..positions = [position(paused: true)];
    addTearDown(app.dispose);
    await render(tester, app);
    expect(find.text('Paused'), findsOneWidget);
    expect(find.text('50.0% traded'), findsOneWidget);
    await tester.tap(find.text('Buy SOL'));
    await tester.pumpAndSettle();
    expect(find.text('Unspent amount'), findsOneWidget);
    expect(find.text('50 USDC'), findsNWidgets(2));
    expect(find.text('0.03 SOL'), findsOneWidget);
    expect(
      find.text('Transactions are disabled in this build.'),
      findsOneWidget,
    );
    expect(tester.takeException(), isNull);
  });
  testWidgets(
    'ended stream renders authoritative zero fill instead of late market accrual',
    (tester) async {
      final app = controller()..positions = [position()];
      addTearDown(app.dispose);
      await render(tester, app);
      expect(find.text('Ready to close'), findsOneWidget);
      expect(find.text('0.0% traded'), findsOneWidget);
      expect(find.text('0 SOL'), findsOneWidget);
    },
  );
  testWidgets('closed receipt displays real fees, refunds and net output', (
    tester,
  ) async {
    final event = ClosedPosition(
      signature: 'signature',
      eventIndex: 0,
      slot: 200,
      authority: 'owner',
      marketAddress: MarketDefinition.sol.address,
      depositAmount: BigInt.from(200000000),
      swappedAmount: BigInt.from(1000000000),
      remainingAmount: BigInt.from(40000000),
      feeAmount: BigInt.from(1000000),
      isBuy: true,
      eventTime: DateTime.utc(2026, 10, 8),
      startSlot: 100,
      endSlot: 199,
    );
    final app = controller(closed: [event]);
    addTearDown(app.dispose);
    await render(tester, app);
    await tester.tap(find.text('Closed'));
    await tester.pumpAndSettle();
    expect(find.text('0.999 SOL'), findsOneWidget);
    await tester.tap(find.text('Bought SOL'));
    await tester.pumpAndSettle();
    expect(find.text('Trade receipt'), findsOneWidget);
    expect(find.text('160 USDC'), findsOneWidget);
    expect(find.text('40 USDC'), findsOneWidget);
    expect(find.text('0.001 SOL'), findsOneWidget);
    expect(find.text('Net received'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
