import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mato_mobile/data/config.dart';
import 'package:mato_mobile/data/market_repository.dart';
import 'package:mato_mobile/domain/models.dart';
import 'package:mato_mobile/state/app_controller.dart';
import 'package:mato_mobile/protocol/trading_client.dart';
import 'package:mato_mobile/ui/positions_panel.dart';
import 'package:mato_mobile/ui/price_chart.dart';
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

class CloseTradingClient extends TradingClient {
  CloseTradingClient()
    : super(
        rpc: (_, _) async => null,
        signAndSend: (_, _) async => 'unused',
        walletAddress: () => 'owner',
      );
  final completion = Completer<String>();
  @override
  Future<Map<String, dynamic>> simulateClosePositions(
    List<String> addresses,
  ) async => {
    'positions': [
      for (final address in addresses)
        {
          'positionAddress': address,
          'isBuy': true,
          'receivedAtoms': BigInt.from(29970000),
          'remainingDepositAtoms': BigInt.from(50000000),
          'feeAtoms': BigInt.from(30000),
          'positionRentLamports': BigInt.from(2000000),
          'baseReceiver': 'owner',
          'quoteReceiver': 'owner',
          'rentReceiver': 'owner',
        },
    ],
  };
  @override
  Future<String> closePositions(List<String> addresses) => completion.future;
}

class CloseController extends AppController {
  CloseController(this.closeClient)
    : super(
        config: const AppConfig(),
        repository: TestRepository(),
        wallet: TestWallet('owner'),
      );
  final CloseTradingClient closeClient;
  @override
  TradingClient get trading => closeClient;
  @override
  Future<void> refresh({bool forceChart = false}) async {}
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

Future<void> render(
  WidgetTester tester,
  AppController app, {
  double width = 390,
  VoidCallback? onStart,
}) async {
  tester.view.physicalSize = Size(width, 1000);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(
    MaterialApp(
      theme: matoTheme(),
      home: Scaffold(
        body: SingleChildScrollView(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: PositionsPanel(app: app, onStart: onStart),
          ),
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('disconnected streams match web copy without invented trades', (
    tester,
  ) async {
    final app = controller(owner: null);
    addTearDown(app.dispose);
    await render(tester, app);
    expect(find.text('Connect a wallet to see your streams.'), findsOneWidget);
    expect(find.text('Active'), findsOneWidget);
    expect(find.text('Closed'), findsOneWidget);
    expect(find.text('Streaming'), findsNothing);
    await tester.tap(find.text('Closed'));
    await tester.pumpAndSettle();
    expect(
      find.text('Connect your wallet to view closed positions.'),
      findsOneWidget,
    );
  });

  testWidgets('empty start link focuses the trade form through the callback', (
    tester,
  ) async {
    final app = controller();
    addTearDown(app.dispose);
    var started = false;
    await render(tester, app, onStart: () => started = true);
    expect(find.text('No streams running. '), findsOneWidget);
    await tester.tap(find.text('Start one'));
    expect(started, isTrue);
  });

  testWidgets(
    'paused stream starts expanded and retains frozen net claim after fee',
    (tester) async {
      final app = controller()..positions = [position(paused: true)];
      addTearDown(app.dispose);
      await render(tester, app);
      expect(find.text('Paused'), findsOneWidget);
      expect(find.text('50.0% filled'), findsOneWidget);
      expect(find.text('Available after fee'), findsOneWidget);
      expect(find.text('0.02997 SOL', findRichText: true), findsOneWidget);
      expect(find.text('0.04 SOL', findRichText: true), findsOneWidget);
      expect(find.text('≈ 0.00999 SOL withdrawn'), findsOneWidget);
      expect(
        find.text('Transactions are disabled in this build.'),
        findsOneWidget,
      );
      expect(tester.takeException(), isNull);
      await tester.tap(find.byKey(const ValueKey('stream-toggle-position')));
      await tester.pumpAndSettle();
      expect(find.text('Available after fee'), findsNothing);
      expect(find.text('50.0% filled'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('stream-toggle-position')));
      await tester.pumpAndSettle();
      expect(find.text('Available after fee'), findsOneWidget);
    },
  );

  testWidgets(
    'ended stream uses authoritative zero fill and disables pause and send',
    (tester) async {
      final app = controller()..positions = [position()];
      addTearDown(app.dispose);
      await render(tester, app);
      expect(find.text('Ended'), findsOneWidget);
      expect(find.text('0.0% filled'), findsOneWidget);
      expect(find.text('0 SOL', findRichText: true), findsNWidgets(2));
      final send = tester.widget<OutlinedButton>(
        find.widgetWithText(OutlinedButton, 'Send to wallet'),
      );
      expect(send.onPressed, isNull);
      final pause = tester.widget<IconButton>(
        find.widgetWithIcon(IconButton, Icons.pause),
      );
      expect(pause.onPressed, isNull);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'closed table expands inline receipt with real fee, net output and refund',
    (tester) async {
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
      expect(find.text('Asset'), findsOneWidget);
      expect(find.text('Size'), findsOneWidget);
      expect(find.text('160 USDC'), findsOneWidget);
      expect(find.text('→ 0.999 SOL'), findsOneWidget);
      expect(find.text('Fee paid'), findsNothing);
      await tester.tap(
        find.bySemanticsLabel(RegExp('Expand Buy SOL position')),
      );
      await tester.pumpAndSettle();
      expect(find.text('Fee paid'), findsOneWidget);
      expect(find.text('0.001 SOL', findRichText: true), findsOneWidget);
      expect(find.text('Refunded 40 USDC'), findsOneWidget);
      expect(find.text('View transaction'), findsOneWidget);
      expect(find.byType(BottomSheet), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'paused chart follows observed market prices while fills stay frozen',
    (tester) async {
      final app = controller()
        ..positions = [position(paused: true)]
        ..price = MarketPriceSnapshot(
          slot: 19,
          price: 123.45,
          eventTime: DateTime.utc(2026, 10, 9),
        );
      addTearDown(app.dispose);
      await render(tester, app);
      final chart = tester.widget<PriceChart>(find.byType(PriceChart));
      expect(chart.points.first.close, 123.45);
      expect(chart.endTime!.isAfter(chart.points.last.time), isTrue);
      expect(find.text('0.02997 SOL', findRichText: true), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'completed stream excludes market prices observed after its end',
    (tester) async {
      final app = controller()
        ..positions = [position()]
        ..price = MarketPriceSnapshot(
          slot: 20,
          price: 999,
          eventTime: DateTime.utc(2026, 10, 9),
        );
      addTearDown(app.dispose);
      await render(tester, app);
      expect(find.byType(PriceChart), findsNothing);
      expect(find.text('0.0% filled'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'close review can cancel before signing and cannot dismiss while confirming',
    (tester) async {
      final fixture = controller();
      final client = CloseTradingClient();
      final app = CloseController(client)
        ..market = fixture.market
        ..positions = [position(paused: true)]
        ..marketUpdatedAt = DateTime.now()
        ..balances = WalletBalances(
          lamports: BigInt.from(100000000),
          wrappedSol: BigInt.zero,
          usdc: BigInt.from(100000000),
        );
      fixture.dispose();
      addTearDown(app.dispose);
      await render(tester, app);
      await tester.tap(find.byTooltip('Close position'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Keep it paused'));
      await tester.pumpAndSettle();
      expect(find.text('Close this stream?'), findsNothing);

      await tester.tap(find.byTooltip('Close position'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Close stream'));
      await tester.pump();
      expect(app.transactionBusy, isTrue);
      expect(
        tester
            .widget<FilledButton>(
              find.widgetWithText(FilledButton, 'Keep it paused'),
            )
            .onPressed,
        isNull,
      );
      expect(find.byTooltip('Close'), findsNothing);
      expect(
        tester.widget<BottomSheet>(find.byType(BottomSheet)).enableDrag,
        isFalse,
      );
      await tester.tapAt(const Offset(10, 10));
      await tester.binding.handlePopRoute();
      await tester.pump(const Duration(milliseconds: 300));
      expect(find.text('Close this stream?'), findsOneWidget);

      client.completion.complete('confirmed-signature');
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 400));
      expect(find.text('Close this stream?'), findsNothing);
      expect(find.text('Stream closed'), findsOneWidget);
      expect(app.transactionBusy, isFalse);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
      await tester.pump(const Duration(seconds: 9));
    },
  );

  testWidgets(
    'narrow phone keeps active controls and detail amounts within the card',
    (tester) async {
      final app = controller()..positions = [position(paused: true)];
      addTearDown(app.dispose);
      await render(tester, app, width: 320);
      expect(find.text('Available after fee'), findsOneWidget);
      expect(find.byTooltip('Resume position'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );
}
