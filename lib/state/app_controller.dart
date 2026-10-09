import 'dart:async';
import 'package:flutter/foundation.dart';
import '../data/config.dart';
import '../data/market_repository.dart';
import '../domain/models.dart';
import '../protocol/protocol.dart';
import '../wallet/wallet_service.dart';

class AppController extends ChangeNotifier {
  AppController({
    required this.config,
    required this.repository,
    required this.wallet,
  }) {
    trading = TradingClient(
      rpc: (method, params) => repository.rpc.call(method, params),
      signAndSend: (bytes, address) =>
          wallet.signAndSend(bytes, expectedAddress: address),
      walletAddress: () => wallet.address ?? '',
      transactionsEnabled: config.transactionsEnabled,
    );
    wallet.addListener(_walletChanged);
  }
  final AppConfig config;
  final MarketRepository repository;
  final WalletService wallet;
  late final TradingClient trading;
  StreamingMarketState? market;
  MarketPriceSnapshot? price;
  WalletBalances? balances;
  List<MarketCandle> candles = [];
  List<PositionRecord> positions = [];
  List<PositionRecord> book = [];
  List<IntervalAccount> intervals = [];
  List<ClosedPosition> history = [];
  final Map<String, String> errors = {};
  final Set<String> loading = {};
  final Map<String, int> _requestGenerations = {};
  DateTime? marketUpdatedAt;
  DateTime? _chartUpdatedAt;
  Timer? _poll;
  bool _disposed = false;
  bool _foreground = true;
  bool _refreshing = false;
  bool transactionBusy = false;
  bool historyHasMore = false;
  int? _historyCursor;
  int _accountEpoch = 0;
  int _chartEpoch = 0;
  String? _owner;
  String range = '1D';
  bool bookVisible = false;
  bool historyVisible = false;
  String? lastSignature;
  String? lastAction;
  double? get currentPrice => price?.price ?? market?.price;
  bool get marketFresh =>
      marketUpdatedAt != null &&
      !errors.containsKey('market') &&
      DateTime.now().difference(marketUpdatedAt!) < const Duration(seconds: 25);

  Future<void> start() async {
    try {
      await wallet.restore();
    } catch (error) {
      errors['wallet'] = error.toString();
    }
    if (_disposed) return;
    _owner = wallet.address;
    await refresh();
    if (!_disposed) {
      _poll = Timer.periodic(const Duration(seconds: 10), (_) {
        if (_foreground) unawaited(refresh());
      });
    }
  }

  void setForeground(bool foreground) {
    _foreground = foreground;
    if (foreground) unawaited(refresh(forceChart: true));
  }

  void _walletChanged() {
    if (wallet.isConnected && wallet.error == null) errors.remove('wallet');
    if (_owner != wallet.address) {
      _owner = wallet.address;
      _accountEpoch++;
      balances = null;
      positions = [];
      intervals = [];
      history = [];
      historyHasMore = false;
      _historyCursor = null;
      lastSignature = null;
      lastAction = null;
      for (final key in ['balances', 'positions', 'intervals', 'history']) {
        errors.remove(key);
        loading.remove(key);
      }
      unawaited(_refreshAccount());
    }
    _notify();
  }

  Future<void> _load<T>(
    String key,
    Future<T> Function() fetch,
    void Function(T) store, {
    int? accountEpoch,
  }) async {
    final generation = (_requestGenerations[key] ?? 0) + 1;
    _requestGenerations[key] = generation;
    bool isCurrent() =>
        !_disposed &&
        _requestGenerations[key] == generation &&
        (accountEpoch == null || accountEpoch == _accountEpoch);
    loading.add(key);
    _notify();
    try {
      final data = await fetch();
      if (!isCurrent()) return;
      store(data);
      errors.remove(key);
    } catch (e) {
      if (isCurrent()) {
        errors[key] = e.toString();
      }
    } finally {
      if (isCurrent()) {
        loading.remove(key);
      }
      _notify();
    }
  }

  Future<void> refresh({bool forceChart = false}) async {
    if (_refreshing || _disposed) return;
    _refreshing = true;
    try {
      await Future.wait([
        _load('market', repository.fetchMarketState, (data) {
          market = data;
          marketUpdatedAt = DateTime.now();
        }),
        _load('price', repository.fetchPrice, (data) => price = data),
        if (forceChart ||
            _chartUpdatedAt == null ||
            DateTime.now().difference(_chartUpdatedAt!) >
                const Duration(seconds: 55))
          loadChart(),
        if (bookVisible) loadBook(),
        _refreshAccount(),
      ]);
    } finally {
      _refreshing = false;
      _notify();
    }
  }

  Future<void> _refreshAccount() async {
    final owner = wallet.address;
    if (owner == null || _disposed) return;
    final epoch = _accountEpoch;
    await Future.wait([
      _load(
        'balances',
        () => repository.fetchBalances(owner),
        (data) => balances = data,
        accountEpoch: epoch,
      ),
      _load(
        'positions',
        () => repository.fetchPositions(owner),
        (data) => positions = data,
        accountEpoch: epoch,
      ),
      _load(
        'intervals',
        () => repository.fetchOwnedIntervals(owner),
        (data) => intervals = data,
        accountEpoch: epoch,
      ),
      if (historyVisible) loadHistory(),
    ]);
  }

  Future<void> setRange(String next) async {
    if (range == next) return;
    range = next;
    candles = [];
    _notify();
    await loadChart();
  }

  Future<void> loadChart() async {
    final epoch = ++_chartEpoch;
    final duration = switch (range) {
      '1D' => const Duration(days: 1),
      '1W' => const Duration(days: 7),
      _ => const Duration(hours: 1),
    };
    final interval = switch (range) {
      '1D' => '5m',
      '1W' => '1h',
      _ => '1m',
    };
    final now = DateTime.now();
    await _load(
      'chart',
      () => repository.fetchCandles(
        from: now.subtract(duration),
        to: now,
        interval: interval,
        maxPoints: 320,
      ),
      (data) {
        if (epoch != _chartEpoch) return;
        candles = data;
        _chartUpdatedAt = DateTime.now();
      },
    );
  }

  Future<void> loadBook() =>
      _load('book', repository.fetchMarketPositions, (data) => book = data);

  Future<void> loadHistory({bool more = false}) async {
    final owner = wallet.address;
    if (owner == null || loading.contains('history')) return;
    if (more && (!historyHasMore || _historyCursor == null)) return;
    final epoch = _accountEpoch;
    final previousCursor = _historyCursor;
    await _load(
      'history',
      () => repository.fetchClosedPositions(
        owner,
        beforeSlot: more ? _historyCursor : null,
        limit: 50,
      ),
      (page) {
        history = {
          for (final item in [...history, ...page.items]) item.id: item,
        }.values.toList()..sort((a, b) => b.slot.compareTo(a.slot));
        if (more || previousCursor == null) {
          _historyCursor = page.beforeSlot;
          historyHasMore =
              page.hasMore &&
              page.beforeSlot != null &&
              (!more || page.beforeSlot! < previousCursor!);
        }
      },
      accountEpoch: epoch,
    );
  }

  Future<String> transact(
    String label,
    Future<String> Function() operation,
  ) async {
    if (transactionBusy) {
      throw StateError('A transaction is already in progress.');
    }
    if (!config.transactionsEnabled) {
      throw StateError('Trading is disabled in this build.');
    }
    transactionBusy = true;
    final epoch = _accountEpoch;
    final owner = wallet.address;
    lastSignature = null;
    _notify();
    try {
      final signature = await operation();
      if (!_disposed && epoch == _accountEpoch && owner == wallet.address) {
        lastSignature = signature;
        lastAction = label;
        unawaited(refresh());
      }
      return signature;
    } finally {
      transactionBusy = false;
      _notify();
    }
  }

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    _poll?.cancel();
    wallet.removeListener(_walletChanged);
    repository.close();
    wallet.dispose();
    super.dispose();
  }
}
