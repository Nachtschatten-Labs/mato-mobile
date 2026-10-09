import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:mato_mobile/data/config.dart';
import 'package:mato_mobile/data/market_repository.dart';
import 'package:mato_mobile/domain/models.dart';
import 'package:mato_mobile/state/app_controller.dart';
import 'package:mato_mobile/wallet/wallet_service.dart';

class MutableWallet extends WalletService {
  MutableWallet({String? owner, this.restoreFailure, this.restoredOwner})
    : _owner = owner,
      super(supported: true);
  String? _owner;
  final Object? restoreFailure;
  final String? restoredOwner;
  @override
  String? get address => _owner;
  @override
  bool get isConnected => _owner != null;
  void switchTo(String? owner) {
    _owner = owner;
    notifyListeners();
  }

  @override
  Future<void> restore() async {
    if (restoreFailure != null) throw restoreFailure!;
    if (restoredOwner != null) switchTo(restoredOwner);
  }
}

WalletBalances balance(int amount) => WalletBalances(
  lamports: BigInt.from(amount),
  wrappedSol: BigInt.zero,
  usdc: BigInt.from(amount),
);
ClosedPosition receipt(int slot, {String authority = 'A'}) => ClosedPosition(
  signature: 'signature-$slot',
  eventIndex: 0,
  slot: slot,
  authority: authority,
  marketAddress: MarketDefinition.sol.address,
  depositAmount: BigInt.from(100),
  swappedAmount: BigInt.from(50),
  remainingAmount: BigInt.zero,
  feeAmount: BigInt.one,
  isBuy: true,
  eventTime: DateTime.utc(2026),
);
PositionRecord position(String owner) =>
    PositionRecord(address: 'position-$owner', data: {'authority': owner});

class DeferredRepository extends MarketRepository {
  DeferredRepository()
    : super(config: const AppConfig(transactionsEnabled: false));
  Future<WalletBalances> Function(String)? balancesRequest;
  Future<List<PositionRecord>> Function(String)? positionsRequest;
  Future<List<IntervalAccount>> Function(String)? intervalsRequest;
  Future<PageResult<ClosedPosition>> Function(String, int?)? historyRequest;
  final historyRequests = <(String, int?)>[];
  int publicReads = 0;
  @override
  Future<WalletBalances> fetchBalances(String authority) =>
      balancesRequest?.call(authority) ?? Future.value(balance(100));
  @override
  Future<List<PositionRecord>> fetchPositions(String authority) =>
      positionsRequest?.call(authority) ?? Future.value([position(authority)]);
  @override
  Future<List<IntervalAccount>> fetchOwnedIntervals(String authority) =>
      intervalsRequest?.call(authority) ?? Future.value([]);
  @override
  Future<PageResult<ClosedPosition>> fetchClosedPositions(
    String authority, {
    int? beforeSlot,
    int limit = 50,
  }) {
    historyRequests.add((authority, beforeSlot));
    return historyRequest?.call(authority, beforeSlot) ??
        Future.value(
          PageResult(
            items: [receipt(100, authority: authority)],
            hasMore: false,
            beforeSlot: 100,
          ),
        );
  }

  @override
  Future<StreamingMarketState> fetchMarketState() async {
    publicReads++;
    return const StreamingMarketState(currentSlot: 100, market: {});
  }

  @override
  Future<MarketPriceSnapshot> fetchPrice() async {
    publicReads++;
    return const MarketPriceSnapshot(price: 123, slot: 100);
  }

  @override
  Future<List<MarketCandle>> fetchCandles({
    required DateTime from,
    required DateTime to,
    required String interval,
    int maxPoints = 1500,
  }) async {
    publicReads++;
    return [
      const MarketCandle(
        time: 1700000000,
        open: 123,
        high: 124,
        low: 122,
        close: 123,
      ),
    ];
  }
}

AppController makeController(
  DeferredRepository repository,
  MutableWallet wallet,
) => AppController(
  config: const AppConfig(),
  repository: repository,
  wallet: wallet,
);
Future<void> settle() => Future<void>.delayed(Duration.zero);

void main() {
  test(
    'stale account responses and errors cannot replace the newly selected wallet',
    () async {
      final repo = DeferredRepository();
      final wallet = MutableWallet();
      final app = makeController(repo, wallet)..historyVisible = true;
      addTearDown(app.dispose);
      final balancesA = Completer<WalletBalances>();
      final positionsA = Completer<List<PositionRecord>>();
      final historyA = Completer<PageResult<ClosedPosition>>();
      repo.balancesRequest = (owner) =>
          owner == 'A' ? balancesA.future : Future.value(balance(200));
      repo.positionsRequest = (owner) =>
          owner == 'A' ? positionsA.future : Future.value([position('B')]);
      repo.historyRequest = (owner, before) => owner == 'A'
          ? historyA.future
          : Future.value(
              PageResult(
                items: [receipt(200, authority: 'B')],
                hasMore: false,
                beforeSlot: 200,
              ),
            );
      wallet.switchTo('A');
      expect(app.loading, containsAll(['balances', 'positions', 'history']));
      wallet.switchTo('B');
      await settle();
      expect(app.balances?.lamports, BigInt.from(200));
      expect(app.positions.single.data['authority'], 'B');
      expect(app.history.single.authority, 'B');
      balancesA.complete(balance(999));
      positionsA.completeError(StateError('old wallet positions failed'));
      historyA.completeError(StateError('old wallet history failed'));
      await settle();
      expect(app.balances?.lamports, BigInt.from(200));
      expect(app.positions.single.data['authority'], 'B');
      expect(app.history.single.authority, 'B');
      expect(app.errors, isEmpty);
    },
  );

  test(
    'old completions cannot clear the new account loading indicator',
    () async {
      final repo = DeferredRepository();
      final wallet = MutableWallet();
      final app = makeController(repo, wallet);
      addTearDown(app.dispose);
      final a = Completer<WalletBalances>();
      final b = Completer<WalletBalances>();
      repo.balancesRequest = (owner) => owner == 'A' ? a.future : b.future;
      wallet.switchTo('A');
      wallet.switchTo('B');
      a.completeError(StateError('old request failed'));
      await settle();
      expect(app.loading, contains('balances'));
      expect(app.errors.containsKey('balances'), isFalse);
      expect(app.balances, isNull);
      b.complete(balance(200));
      await settle();
      expect(app.loading, isNot(contains('balances')));
      expect(app.balances?.lamports, BigInt.from(200));
    },
  );

  test(
    'disconnect clears account state while pending responses stay discarded',
    () async {
      final repo = DeferredRepository();
      final wallet = MutableWallet();
      final app = makeController(repo, wallet)..historyVisible = true;
      addTearDown(app.dispose);
      final pending = Completer<WalletBalances>();
      repo.balancesRequest = (_) => pending.future;
      wallet.switchTo('A');
      await settle();
      expect(app.positions, isNotEmpty);
      expect(app.history, isNotEmpty);
      wallet.switchTo(null);
      pending.complete(balance(999));
      await settle();
      expect(app.balances, isNull);
      expect(app.positions, isEmpty);
      expect(app.history, isEmpty);
      expect(app.errors, isEmpty);
      expect(app.loading, isEmpty);
    },
  );

  test(
    'restoration failure still loads public markets and records a visible error',
    () async {
      final repo = DeferredRepository();
      final wallet = MutableWallet(
        restoreFailure: StateError('wallet storage unavailable'),
      );
      final app = makeController(repo, wallet);
      addTearDown(app.dispose);
      await app.start();
      expect(repo.publicReads, 3);
      expect(app.market?.currentSlot, 100);
      expect(app.price?.price, 123);
      expect(app.candles, hasLength(1));
      expect(app.errors['wallet'], contains('wallet storage unavailable'));
    },
  );

  test(
    'failed load-more retains receipts and cursor for retry, refresh retains tail',
    () async {
      final repo = DeferredRepository();
      final wallet = MutableWallet(owner: 'A');
      final app = makeController(repo, wallet);
      addTearDown(app.dispose);
      var call = 0;
      repo.historyRequest = (owner, cursor) async {
        switch (call++) {
          case 0:
            expect(cursor, isNull);
            return PageResult(
              items: [receipt(300), receipt(200)],
              hasMore: true,
              beforeSlot: 200,
            );
          case 1:
            expect(cursor, 200);
            throw StateError('temporary history outage');
          case 2:
            expect(cursor, 200);
            return PageResult(
              items: [receipt(180), receipt(100)],
              hasMore: true,
              beforeSlot: 100,
            );
          case 3:
            expect(cursor, isNull);
            return PageResult(
              items: [receipt(400), receipt(300)],
              hasMore: true,
              beforeSlot: 300,
            );
          default:
            expect(cursor, 100);
            return PageResult(
              items: [receipt(90)],
              hasMore: false,
              beforeSlot: 90,
            );
        }
      };
      await app.loadHistory();
      await app.loadHistory(more: true);
      expect(app.history.map((p) => p.slot), [300, 200]);
      expect(app.errors['history'], contains('temporary history outage'));
      expect(app.historyHasMore, isTrue);
      await app.loadHistory(more: true);
      expect(app.errors.containsKey('history'), isFalse);
      await app.loadHistory();
      expect(app.history.map((p) => p.slot), [400, 300, 200, 180, 100]);
      await app.loadHistory(more: true);
      expect(app.history.map((p) => p.slot), [400, 300, 200, 180, 100, 90]);
      expect(app.historyHasMore, isFalse);
      await app.loadHistory(more: true);
      expect(repo.historyRequests, hasLength(5));
    },
  );

  test(
    'non-advancing pagination cursor stops further load-more requests',
    () async {
      final repo = DeferredRepository();
      final wallet = MutableWallet(owner: 'A');
      final app = makeController(repo, wallet);
      addTearDown(app.dispose);
      repo.historyRequest = (_, cursor) async =>
          PageResult(items: [receipt(200)], hasMore: true, beforeSlot: 200);
      await app.loadHistory();
      await app.loadHistory(more: true);
      expect(app.history, hasLength(1));
      expect(app.historyHasMore, isFalse);
      await app.loadHistory(more: true);
      expect(repo.historyRequests, hasLength(2));
    },
  );

  test(
    'confirmation for an old wallet does not publish its signature on a new wallet',
    () async {
      final repo = DeferredRepository();
      final wallet = MutableWallet();
      final app = makeController(repo, wallet);
      addTearDown(app.dispose);
      wallet.switchTo('A');
      await settle();
      final completion = Completer<String>();
      final transaction = app.transact('Trade for A', () => completion.future);
      wallet.switchTo('B');
      completion.complete('signature-for-A');
      expect(await transaction, 'signature-for-A');
      await settle();
      expect(app.lastSignature, isNull);
      expect(app.lastAction, isNull);
      expect(app.transactionBusy, isFalse);
    },
  );

  test(
    'older same-wallet restore read cannot overwrite a later refresh',
    () async {
      final repo = DeferredRepository();
      final wallet = MutableWallet(restoredOwner: 'A');
      final app = makeController(repo, wallet);
      addTearDown(app.dispose);
      final earlier = Completer<WalletBalances>();
      var calls = 0;
      repo.balancesRequest = (_) =>
          calls++ == 0 ? earlier.future : Future.value(balance(200));
      await app.start();
      expect(calls, 2);
      expect(app.balances?.lamports, BigInt.from(200));
      earlier.complete(balance(999));
      await settle();
      expect(app.balances?.lamports, BigInt.from(200));
    },
  );

  test('successful wallet connection clears a prior restore error', () async {
    final repo = DeferredRepository();
    final wallet = MutableWallet(
      restoreFailure: StateError('cannot restore old wallet'),
    );
    final app = makeController(repo, wallet);
    addTearDown(app.dispose);
    await app.start();
    expect(app.errors, contains('wallet'));
    wallet.switchTo('A');
    await settle();
    expect(app.errors, isNot(contains('wallet')));
  });
}
