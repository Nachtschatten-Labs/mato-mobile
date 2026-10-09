import 'dart:async';
import 'dart:math' as math;
import 'package:flutter/material.dart';
import '../domain/amounts.dart';
import '../domain/models.dart';
import '../domain/settlement.dart';
import '../state/app_controller.dart';
import 'price_chart.dart';
import 'theme.dart';
import 'widgets.dart';

class PositionsPanel extends StatefulWidget {
  const PositionsPanel({super.key, required this.app, this.onStart});
  final AppController app;
  final VoidCallback? onStart;
  @override
  State<PositionsPanel> createState() => _PositionsPanelState();
}

class _PositionsPanelState extends State<PositionsPanel> {
  bool _closed = false;
  int _page = 0;
  String? _owner;
  final Map<String, TradeSettlementSnapshot> _settlements = {};
  final Set<String> _loadingSettlements = {};
  AppController get app => widget.app;
  @override
  void initState() {
    super.initState();
    _owner = app.wallet.address;
    app.addListener(_updated);
    _loadSettlements();
  }

  @override
  void dispose() {
    app.removeListener(_updated);
    super.dispose();
  }

  void _updated() {
    if (!mounted) return;
    if (_owner != app.wallet.address) {
      _owner = app.wallet.address;
      _page = 0;
      _settlements.clear();
      _loadingSettlements.clear();
    }
    setState(() {});
    _loadSettlements();
  }

  void _loadSettlements() {
    final owner = app.wallet.address;
    final currentSlot = app.market?.currentSlot;
    if (owner == null || currentSlot == null) return;
    for (final position in app.positions) {
      if (_loadingSettlements.length >= 4) break;
      final key = _positionKey(position);
      if (position.isPaused ||
          currentSlot < position.endSlot ||
          _settlements.containsKey(key) ||
          _loadingSettlements.contains(key)) {
        continue;
      }
      _loadingSettlements.add(key);
      unawaited(
        app.repository
            .fetchSettlement(position)
            .then((snapshot) {
              if (mounted && app.wallet.address == owner && snapshot != null) {
                setState(() => _settlements[key] = snapshot);
              }
            })
            .catchError((Object _) {
              // The card keeps amounts unknown; its detail view exposes retry/errors.
            })
            .whenComplete(() => _loadingSettlements.remove(key)),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final connected = app.wallet.isConnected;
    final totalPages = math.max(1, (app.positions.length / 10).ceil());
    final page = _page.clamp(0, totalPages - 1);
    final visible = app.positions.skip(page * 10).take(10).toList();
    final ended =
        app.positions
            .where(
              (p) => !p.isPaused && (app.market?.currentSlot ?? 0) > p.endSlot,
            )
            .toList()
          ..sort((a, b) => a.endSlot.compareTo(b.endSlot));
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            const Text(
              'Your streams',
              style: TextStyle(fontSize: 22, letterSpacing: -.5),
            ),
            const Spacer(),
            if (connected)
              TextButton(
                onPressed: app.loading.contains('positions')
                    ? null
                    : () => app.refresh(),
                child: const Text('Refresh'),
              ),
          ],
        ),
        const SizedBox(height: 12),
        PillTabs<bool>(
          values: {false: 'Active · ${app.positions.length}', true: 'Closed'},
          selected: _closed,
          onChanged: (value) {
            setState(() {
              _closed = value;
              _page = 0;
            });
            app.historyVisible = value;
            if (value) unawaited(app.loadHistory());
          },
        ),
        const SizedBox(height: 16),
        if (!connected)
          Panel(
            child: Column(
              children: [
                const Icon(
                  Icons.waterfall_chart_rounded,
                  size: 34,
                  color: MatoColors.muted,
                ),
                const SizedBox(height: 14),
                const Text(
                  'Your trades, at your pace',
                  style: TextStyle(fontSize: 18),
                ),
                const SizedBox(height: 8),
                const Text(
                  'Connect your wallet to follow your streams and view past trades.',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: MatoColors.muted, height: 1.5),
                ),
                const SizedBox(height: 16),
                ActionButton(
                  'Connect wallet',
                  onPressed: app.wallet.isSupported && !app.wallet.isBusy
                      ? () async {
                          try {
                            await app.wallet.connect();
                          } catch (e) {
                            if (context.mounted) {
                              ScaffoldMessenger.of(context).showSnackBar(
                                SnackBar(content: Text(errorText(e))),
                              );
                            }
                          }
                        }
                      : null,
                  busy: app.wallet.isBusy,
                ),
                if (!app.wallet.isSupported)
                  const Notice(
                    'Wallet signing is available in the Android app.',
                  ),
              ],
            ),
          )
        else ...[
          if (app.errors[_closed ? 'history' : 'positions']
              case final String error)
            Notice(
              error,
              error: true,
              onRetry: () => _closed ? app.loadHistory() : app.refresh(),
            ),
          if (_closed) ...[
            if (app.history.isEmpty && app.loading.contains('history'))
              const _LoadingRows(),
            if (app.history.isEmpty && !app.loading.contains('history'))
              const Panel(
                child: Padding(
                  padding: EdgeInsets.all(12),
                  child: Text(
                    'Your completed trades will appear here.',
                    textAlign: TextAlign.center,
                    style: TextStyle(color: MatoColors.muted),
                  ),
                ),
              ),
            for (final event in app.history)
              Padding(
                padding: const EdgeInsets.only(bottom: 10),
                child: _ClosedCard(
                  event: event,
                  onTap: () => showMatoSheet(
                    context,
                    title: 'Trade receipt',
                    child: _ClosedReceipt(app: app, event: event),
                  ),
                ),
              ),
            if (app.historyHasMore)
              ActionButton(
                'Load more closed trades',
                secondary: true,
                busy: app.loading.contains('history'),
                onPressed: () => app.loadHistory(more: true),
              ),
          ] else ...[
            if (ended.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: ActionButton(
                  'Close ${math.min(2, ended.length)} completed ${ended.length == 1 ? 'stream' : 'streams'}',
                  secondary: true,
                  onPressed: _canMutate(app, _owner)
                      ? () => _reviewClose(context, app, ended.take(2).toList())
                      : null,
                ),
              ),
            if (app.positions.isEmpty && app.loading.contains('positions'))
              const _LoadingRows(),
            if (app.positions.isEmpty && !app.loading.contains('positions'))
              Panel(
                child: Column(
                  children: [
                    const Text(
                      'No active streams',
                      style: TextStyle(fontSize: 18),
                    ),
                    const SizedBox(height: 8),
                    const Text(
                      'Choose an amount and a duration to start your first trade.',
                      textAlign: TextAlign.center,
                      style: TextStyle(color: MatoColors.muted, height: 1.5),
                    ),
                    if (widget.onStart != null) ...[
                      const SizedBox(height: 16),
                      ActionButton('Start a trade', onPressed: widget.onStart),
                    ],
                  ],
                ),
              ),
            for (final position in visible)
              Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: _PositionCard(
                  position: position,
                  metrics: getActivePositionMetrics(
                    position: position,
                    streamingState: app.market,
                    endSlotBookkeepingSnapshot:
                        _settlements[_positionKey(position)],
                  ),
                  currentSlot: app.market?.currentSlot,
                  onTap: () => showMatoSheet(
                    context,
                    title:
                        '${position.isBuy ? 'Buy' : 'Sell'} SOL · stream #${position.id}',
                    child: _PositionDetail(
                      app: app,
                      position: position,
                      initialSettlement: _settlements[_positionKey(position)],
                    ),
                  ),
                ),
              ),
            if (totalPages > 1)
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  TextButton(
                    onPressed: page > 0
                        ? () => setState(() => _page = page - 1)
                        : null,
                    child: const Text('Previous'),
                  ),
                  Text(
                    '${page + 1} / $totalPages',
                    style: const TextStyle(color: MatoColors.muted),
                  ),
                  TextButton(
                    onPressed: page < totalPages - 1
                        ? () => setState(() => _page = page + 1)
                        : null,
                    child: const Text('Next'),
                  ),
                ],
              ),
            if (app.positions.length > 1)
              TextButton(
                onPressed: _canMutate(app, _owner)
                    ? () {
                        final selected = [...app.positions]
                          ..sort((a, b) => a.endSlot.compareTo(b.endSlot));
                        _reviewClose(context, app, selected.take(2).toList());
                      }
                    : null,
                child: const Text('Review closing up to 2 streams'),
              ),
          ],
          if (app.lastSignature != null)
            Notice('${app.lastAction ?? 'Transaction'} confirmed.'),
          if (app.lastSignature case final String signature)
            TextButton(
              onPressed: () =>
                  openExplorer(context, signature, transaction: true),
              child: const Text('View confirmed transaction ↗'),
            ),
        ],
      ],
    );
  }
}

String _positionKey(PositionRecord p) =>
    '${p.address}:${['authority', 'market', 'payer', 'operator', 'baseReceiver', 'quoteReceiver', 'amount', 'flow', 'startSlot', 'lastUpdateSlot', 'remainingSlots', 'pausedAtSlot', 'bookkeepingSnapshot', 'slotsWithoutTradesSnapshot', 'inactiveRefund', 'withdrawnAmount', 'swappedAmountAtSnapshot', 'side', 'feeBpsAtSubmission'].map((key) => p.data[key]).join(':')}';
bool _canMutate(AppController app, String? owner) =>
    owner != null &&
    owner == app.wallet.address &&
    app.wallet.isSupported &&
    app.config.transactionsEnabled &&
    !app.transactionBusy &&
    !app.wallet.isBusy &&
    app.marketFresh &&
    !app.errors.containsKey('positions') &&
    !app.errors.containsKey('balances') &&
    app.balances != null &&
    app.balances!.lamports >= maintenanceFeeBufferAtoms;
String _amount(BigInt? value, int decimals, String symbol) =>
    '${formatAmount(value, decimals, precision: decimals)} $symbol';

class _LoadingRows extends StatelessWidget {
  const _LoadingRows();
  @override
  Widget build(BuildContext context) => const SizedBox(
    height: 130,
    child: Center(child: CircularProgressIndicator(strokeWidth: 2)),
  );
}

class _PositionCard extends StatelessWidget {
  const _PositionCard({
    required this.position,
    required this.metrics,
    required this.currentSlot,
    required this.onTap,
  });
  final PositionRecord position;
  final PositionProgress metrics;
  final int? currentSlot;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) {
    final remaining = currentSlot == null
        ? null
        : math.max(0, position.endSlot - currentSlot!) * slotDurationSeconds;
    final status = position.isPaused
        ? 'Paused'
        : metrics.hasPositionEnded
        ? 'Ready to close'
        : 'Streaming';
    return Semantics(
      button: true,
      label:
          '${position.isBuy ? 'Buy' : 'Sell'} SOL stream ${position.id}, $status',
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(22),
        child: Panel(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                children: [
                  const TokenBadge('SOL', size: 30),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Text(
                      '${position.isBuy ? 'Buy' : 'Sell'} SOL',
                      style: const TextStyle(fontSize: 17),
                    ),
                  ),
                  Text(
                    status,
                    style: TextStyle(
                      fontSize: 12,
                      color: position.isPaused
                          ? MatoColors.caution
                          : MatoColors.positive,
                    ),
                  ),
                  const SizedBox(width: 6),
                  const Icon(
                    Icons.chevron_right,
                    size: 18,
                    color: MatoColors.muted,
                  ),
                ],
              ),
              const SizedBox(height: 17),
              Text(
                _amount(
                  metrics.amountAtoms,
                  metrics.depositDecimals,
                  metrics.depositSymbol,
                ),
                style: const TextStyle(fontSize: 25, letterSpacing: -.7),
              ),
              const SizedBox(height: 15),
              LinearProgressIndicator(
                value: metrics.progressPercent == null
                    ? 0
                    : (metrics.progressPercent! / 100).clamp(0, 1),
                minHeight: 3,
                borderRadius: BorderRadius.circular(8),
                color: MatoColors.positive,
                backgroundColor: MatoColors.track,
              ),
              const SizedBox(height: 10),
              Row(
                children: [
                  Text(
                    metrics.progressPercent == null
                        ? 'Awaiting settlement'
                        : '${number(metrics.progressPercent, 1)}% traded',
                    style: const TextStyle(
                      fontSize: 12,
                      color: MatoColors.muted,
                    ),
                  ),
                  const Spacer(),
                  Text(
                    position.isPaused
                        ? '${durationText(intValue(position.data['remainingSlots']) * slotDurationSeconds)} remaining'
                        : metrics.hasPositionEnded
                        ? 'Finished'
                        : remaining == null
                        ? '—'
                        : '${durationText(remaining)} left',
                    style: const TextStyle(
                      fontSize: 12,
                      color: MatoColors.muted,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 9),
              Detail(
                'Received so far',
                _amount(
                  metrics.swappedAtoms,
                  metrics.outputDecimals,
                  metrics.outputSymbol,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ClosedCard extends StatelessWidget {
  const _ClosedCard({required this.event, required this.onTap});
  final ClosedPosition event;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) => InkWell(
    onTap: onTap,
    borderRadius: BorderRadius.circular(22),
    child: Panel(
      child: Row(
        children: [
          const TokenBadge('SOL', size: 30),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '${event.isBuy ? 'Bought' : 'Sold'} SOL',
                  style: const TextStyle(fontSize: 16),
                ),
                const SizedBox(height: 6),
                Text(
                  event.eventTime.toLocal().toString().substring(0, 16),
                  style: const TextStyle(color: MatoColors.muted, fontSize: 12),
                ),
              ],
            ),
          ),
          Flexible(
            child: Text(
              _amount(
                event.receivedAmount,
                event.outputDecimals,
                event.outputSymbol,
              ),
              textAlign: TextAlign.right,
            ),
          ),
          const SizedBox(width: 6),
          const Icon(Icons.chevron_right, size: 18, color: MatoColors.muted),
        ],
      ),
    ),
  );
}

class _PositionDetail extends StatefulWidget {
  const _PositionDetail({
    required this.app,
    required this.position,
    this.initialSettlement,
  });
  final AppController app;
  final PositionRecord position;
  final TradeSettlementSnapshot? initialSettlement;
  @override
  State<_PositionDetail> createState() => _PositionDetailState();
}

class _PositionDetailState extends State<_PositionDetail> {
  late final String? _owner = widget.app.wallet.address;
  TradeSettlementSnapshot? _settlement;
  String? _settlementError, _error, _signature;
  bool _loading = false;
  AppController get app => widget.app;
  @override
  void initState() {
    super.initState();
    _settlement = widget.initialSettlement;
    if (_settlement == null) unawaited(_loadSettlement());
  }

  Future<void> _loadSettlement() async {
    if (widget.position.isPaused ||
        (app.market?.currentSlot ?? 0) < widget.position.endSlot ||
        _loading) {
      return;
    }
    setState(() {
      _loading = true;
      _settlementError = null;
    });
    try {
      final result = await app.repository.fetchSettlement(widget.position);
      if (mounted) {
        setState(() {
          _settlement = result;
          if (result == null) {
            _settlementError =
                'Settlement is not ready yet. Refresh after the next market update.';
          }
        });
      }
    } catch (e) {
      if (mounted) setState(() => _settlementError = errorText(e));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _action(
    String label,
    Future<String> Function() operation,
  ) async {
    if (!_canMutate(app, _owner)) return;
    setState(() {
      _error = null;
      _signature = null;
    });
    try {
      final result = await app.transact(label, operation);
      if (mounted) setState(() => _signature = result);
    } catch (e) {
      if (mounted) setState(() => _error = errorText(e));
    }
  }

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
    animation: app,
    builder: (context, _) {
      final candidates = app.positions.where(
        (p) => p.address == widget.position.address,
      );
      final position = candidates.isEmpty ? widget.position : candidates.first;
      final changedOwner = _owner != app.wallet.address;
      final metrics = getActivePositionMetrics(
        position: position,
        streamingState: app.market,
        endSlotBookkeepingSnapshot:
            _positionKey(position) == _positionKey(widget.position)
            ? _settlement
            : null,
      );
      final canAct =
          !changedOwner && candidates.isNotEmpty && _canMutate(app, _owner);
      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (changedOwner)
            const Notice(
              'Wallet changed. Close this view and select a stream from your current wallet.',
              error: true,
            ),
          if (candidates.isEmpty && !changedOwner)
            const Notice(
              'This stream is no longer active. Refresh closed trades to view its receipt.',
            ),
          Text(
            _amount(
              metrics.amountAtoms,
              metrics.depositDecimals,
              metrics.depositSymbol,
            ),
            style: const TextStyle(fontSize: 32, letterSpacing: -1),
          ),
          const SizedBox(height: 6),
          Text(
            position.isPaused
                ? 'Paused'
                : metrics.hasPositionEnded
                ? 'Stream finished · ready to close'
                : 'Streaming ${metrics.depositSymbol} → ${metrics.outputSymbol}',
            style: const TextStyle(color: MatoColors.muted),
          ),
          const SizedBox(height: 18),
          _PositionHistory(
            app: app,
            startSlot: intValue(position.data['startSlot']),
            endSlot: position.isPaused
                ? intValue(position.data['pausedAtSlot'])
                : math.min(
                    position.endSlot,
                    app.market?.currentSlot ?? position.endSlot,
                  ),
            reference: metrics.averagePrice,
          ),
          Detail(
            'Traded',
            _amount(
              metrics.consumedAtoms,
              metrics.depositDecimals,
              metrics.depositSymbol,
            ),
          ),
          Detail(
            'Unspent amount',
            _amount(
              metrics.remainingAtoms,
              metrics.depositDecimals,
              metrics.depositSymbol,
            ),
          ),
          Detail(
            'Gross received',
            _amount(
              metrics.swappedAtoms,
              metrics.outputDecimals,
              metrics.outputSymbol,
            ),
          ),
          Detail(
            'Already withdrawn',
            _amount(
              bigIntValue(position.data['withdrawnAmount']),
              metrics.outputDecimals,
              metrics.outputSymbol,
            ),
          ),
          Detail(
            'Available before fee',
            _amount(
              metrics.claimableSwappedAtoms,
              metrics.outputDecimals,
              metrics.outputSymbol,
            ),
          ),
          Detail(
            'Average fill price',
            metrics.averagePrice == null
                ? '—'
                : '${number(metrics.averagePrice, 4)} USDC / SOL',
          ),
          Detail(
            'Trade fee',
            '${number(intValue(position.data['feeBpsAtSubmission']) / 100)}%',
          ),
          if (metrics.remainingAtoms == null)
            Notice(
              _settlementError ??
                  'Waiting for confirmed settlement. Amounts will appear when accounting is available.',
              error: _settlementError != null,
              onRetry: _loading ? null : _loadSettlement,
            ),
          if (_loading) const LinearProgressIndicator(minHeight: 2),
          if (_error != null) Notice(_error!, error: true),
          if (_signature != null)
            TextButton(
              onPressed: () =>
                  openExplorer(context, _signature!, transaction: true),
              child: const Text('Transaction confirmed · View ↗'),
            ),
          if (!_canMutate(app, _owner) &&
              !app.transactionBusy &&
              !changedOwner &&
              candidates.isNotEmpty)
            Notice(
              !app.config.transactionsEnabled
                  ? 'Transactions are disabled in this build.'
                  : app.balances != null &&
                        app.balances!.lamports < maintenanceFeeBufferAtoms
                  ? 'Keep at least 0.001 SOL for network fees.'
                  : 'Refresh live market data and wallet balances to manage this stream.',
            ),
          const SizedBox(height: 14),
          if (!metrics.hasPositionEnded) ...[
            ActionButton(
              position.isPaused ? 'Resume stream' : 'Pause stream',
              secondary: true,
              busy: app.transactionBusy,
              onPressed: canAct
                  ? () => _action(
                      position.isPaused ? 'Stream resumed' : 'Stream paused',
                      () => position.isPaused
                          ? app.trading.resume(position.address)
                          : app.trading.pause(position.address),
                    )
                  : null,
            ),
            const SizedBox(height: 8),
            ActionButton(
              'Withdraw received ${metrics.outputSymbol}',
              secondary: true,
              onPressed:
                  canAct &&
                      (metrics.claimableSwappedAtoms ?? BigInt.zero) >
                          BigInt.zero
                  ? () => _action(
                      'Withdrawal',
                      () => app.trading.withdraw(position.address),
                    )
                  : null,
            ),
            const SizedBox(height: 8),
          ],
          ActionButton(
            metrics.hasPositionEnded
                ? 'Review close & receive funds'
                : 'Review ending this stream',
            onPressed: canAct
                ? () => _reviewClose(context, app, [position])
                : null,
          ),
          TextButton(
            onPressed: () => openExplorer(context, position.address),
            child: const Text('View stream on Solana Explorer ↗'),
          ),
        ],
      );
    },
  );
}

class _ClosedReceipt extends StatelessWidget {
  const _ClosedReceipt({required this.app, required this.event});
  final AppController app;
  final ClosedPosition event;
  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      Text(
        '${event.isBuy ? 'Bought' : 'Sold'} SOL',
        style: const TextStyle(fontSize: 28, letterSpacing: -.7),
      ),
      Text(
        event.eventTime.toLocal().toString().substring(0, 16),
        style: const TextStyle(color: MatoColors.muted),
      ),
      const SizedBox(height: 16),
      if (event.startSlot != null && event.endSlot != null)
        _PositionHistory(
          app: app,
          startSlot: event.startSlot!,
          endSlot: event.endSlot!,
          reference: event.averagePrice,
        ),
      Detail(
        'Deposited',
        _amount(
          event.depositAmount,
          event.depositDecimals,
          event.depositSymbol,
        ),
      ),
      Detail(
        'Traded',
        _amount(
          event.consumedAmount,
          event.depositDecimals,
          event.depositSymbol,
        ),
      ),
      Detail(
        'Unspent refunded',
        _amount(
          event.remainingAmount,
          event.depositDecimals,
          event.depositSymbol,
        ),
      ),
      Detail(
        'Gross received',
        _amount(event.swappedAmount, event.outputDecimals, event.outputSymbol),
      ),
      Detail(
        'Trade fee',
        _amount(event.feeAmount, event.outputDecimals, event.outputSymbol),
      ),
      Detail(
        'Net received',
        _amount(event.receivedAmount, event.outputDecimals, event.outputSymbol),
        color: MatoColors.positive,
      ),
      Detail(
        'Average fill price',
        event.averagePrice == null
            ? '—'
            : '${number(event.averagePrice, 4)} USDC / SOL',
      ),
      const SizedBox(height: 12),
      ActionButton(
        'View transaction ↗',
        secondary: true,
        onPressed: () =>
            openExplorer(context, event.signature, transaction: true),
      ),
    ],
  );
}

class _PositionHistory extends StatefulWidget {
  const _PositionHistory({
    required this.app,
    required this.startSlot,
    required this.endSlot,
    this.reference,
  });
  final AppController app;
  final int startSlot, endSlot;
  final double? reference;
  @override
  State<_PositionHistory> createState() => _PositionHistoryState();
}

class _PositionHistoryState extends State<_PositionHistory> {
  late Future<List<MarketUpdate>> _history;
  @override
  void initState() {
    super.initState();
    _load();
  }

  void _load() {
    _history = widget.app.repository.fetchHistory(
      startSlot: widget.startSlot,
      endSlot: widget.endSlot,
    );
  }

  @override
  Widget build(BuildContext context) => FutureBuilder<List<MarketUpdate>>(
    future: _history,
    builder: (context, result) {
      if (result.connectionState != ConnectionState.done) {
        return const SizedBox(
          height: 120,
          child: Center(child: CircularProgressIndicator(strokeWidth: 2)),
        );
      }
      if (result.hasError) {
        return Notice(
          'Price history is unavailable. ${errorText(result.error!)}',
          onRetry: () => setState(_load),
        );
      }
      final updates = [...?result.data]
        ..sort(
          (a, b) => a.slot == b.slot
              ? a.eventIndex.compareTo(b.eventIndex)
              : a.slot.compareTo(b.slot),
        );
      final points = updates
          .where(
            (event) =>
                event.price != null &&
                event.slot >= widget.startSlot &&
                event.slot <= widget.endSlot,
          )
          .map(
            (event) => ChartPoint(
              time: event.createdAt,
              open: event.price!,
              high: event.price!,
              low: event.price!,
              close: event.price!,
            ),
          )
          .toList();
      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Market price during your stream',
            style: TextStyle(fontSize: 12, color: MatoColors.muted),
          ),
          PriceChart(points: points, reference: widget.reference, height: 150),
        ],
      );
    },
  );
}

Future<void> _reviewClose(
  BuildContext context,
  AppController app,
  List<PositionRecord> positions,
) => showMatoSheet(
  context,
  title: positions.length == 1
      ? 'Review closing stream'
      : 'Review closing ${positions.length} streams',
  child: _CloseReview(app: app, positions: List.unmodifiable(positions)),
);

class _CloseReview extends StatefulWidget {
  const _CloseReview({required this.app, required this.positions});
  final AppController app;
  final List<PositionRecord> positions;
  @override
  State<_CloseReview> createState() => _CloseReviewState();
}

class _CloseReviewState extends State<_CloseReview> {
  late final String? _owner = widget.app.wallet.address;
  List<Map<String, dynamic>>? _previews;
  String? _error, _signature;
  bool _loading = false;
  DateTime? _simulatedAt;
  Timer? _timer;
  AppController get app => widget.app;
  @override
  void initState() {
    super.initState();
    unawaited(_refresh());
    _timer = Timer.periodic(const Duration(seconds: 10), (_) {
      if (!app.transactionBusy && _signature == null) unawaited(_refresh());
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  bool get _samePositions =>
      _owner == app.wallet.address &&
      widget.positions.every(
        (reviewed) => app.positions.any(
          (current) =>
              _positionKey(current) == _positionKey(reviewed) &&
              current.data['authority'] == _owner,
        ),
      );
  Future<void> _refresh() async {
    if (_loading || !_samePositions) return;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final result = await app.trading.simulateClosePositions(
        widget.positions.map((p) => p.address).toList(),
      );
      final previews = (result['positions'] as List)
          .map((value) => Map<String, dynamic>.from(value as Map))
          .toList();
      if (previews.length != widget.positions.length) {
        throw StateError(
          'Preview did not settle every selected stream. Refresh and try again.',
        );
      }
      if (mounted && _samePositions) {
        setState(() {
          _previews = previews;
          _simulatedAt = DateTime.now();
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = errorText(e);
          _previews = null;
        });
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _confirm() async {
    if (!_samePositions ||
        !_canMutate(app, _owner) ||
        _previews == null ||
        _loading ||
        _error != null ||
        _simulatedAt == null ||
        DateTime.now().difference(_simulatedAt!) >
            const Duration(seconds: 30)) {
      return;
    }
    setState(() => _error = null);
    try {
      final signature = await app.transact(
        'Stream close',
        () => app.trading.closePositions(
          widget.positions.map((p) => p.address).toList(),
        ),
      );
      if (mounted) setState(() => _signature = signature);
    } catch (e) {
      if (mounted) setState(() => _error = errorText(e));
    }
  }

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
    animation: app,
    builder: (context, _) {
      if (_signature != null) {
        return Column(
          children: [
            const Icon(
              Icons.check_circle_outline,
              color: MatoColors.positive,
              size: 42,
            ),
            const SizedBox(height: 14),
            const Text('Streams closed. Funds have been returned.'),
            const SizedBox(height: 14),
            ActionButton(
              'View transaction ↗',
              onPressed: () =>
                  openExplorer(context, _signature!, transaction: true),
            ),
            TextButton(
              onPressed: () => Navigator.of(context).pop(),
              child: const Text('Done'),
            ),
          ],
        );
      }
      final changed = !_samePositions;
      final fresh =
          _simulatedAt != null &&
          DateTime.now().difference(_simulatedAt!) <=
              const Duration(seconds: 30);
      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Notice(
            'Closing stops the selected streams and returns unspent funds and received tokens to their configured receivers. Network fees are paid separately.',
          ),
          if (changed)
            const Notice(
              'The wallet or stream changed. Close this review and select the streams again.',
              error: true,
            ),
          if (_loading)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 12),
              child: LinearProgressIndicator(minHeight: 2),
            ),
          if (_error != null) Notice(_error!, error: true),
          for (final preview in _previews ?? <Map<String, dynamic>>[]) ...[
            const SizedBox(height: 14),
            Text(
              '${preview['isBuy'] == true ? 'Buy' : 'Sell'} SOL · ${shortAddress(preview['positionAddress'] as String)}',
              style: const TextStyle(fontSize: 16),
            ),
            Detail(
              'Unspent refunded',
              _amount(
                bigIntValue(preview['remainingDepositAtoms']),
                preview['isBuy'] == true ? 6 : 9,
                preview['isBuy'] == true ? 'USDC' : 'SOL',
              ),
            ),
            Detail(
              'Received after fee',
              _amount(
                bigIntValue(preview['receivedAtoms']),
                preview['isBuy'] == true ? 9 : 6,
                preview['isBuy'] == true ? 'SOL' : 'USDC',
              ),
              color: MatoColors.positive,
            ),
            Detail(
              'Trade fee',
              _amount(
                bigIntValue(preview['feeAtoms']),
                preview['isBuy'] == true ? 9 : 6,
                preview['isBuy'] == true ? 'SOL' : 'USDC',
              ),
            ),
            Detail(
              'Account rent returned',
              _amount(bigIntValue(preview['positionRentLamports']), 9, 'SOL'),
            ),
            Detail(
              'SOL receiver',
              shortAddress(preview['baseReceiver'] as String),
            ),
            Detail(
              'USDC receiver',
              shortAddress(preview['quoteReceiver'] as String),
            ),
            Detail(
              'Rent receiver',
              shortAddress(preview['rentReceiver'] as String),
            ),
            const Divider(height: 25),
          ],
          if (_simulatedAt != null)
            const Text(
              'Amounts are simulated from current chain state and may change while an active stream trades.',
              style: TextStyle(
                fontSize: 12,
                color: MatoColors.muted,
                height: 1.5,
              ),
            ),
          const SizedBox(height: 18),
          ActionButton(
            'Confirm close in wallet',
            busy: app.transactionBusy,
            onPressed:
                !changed &&
                    fresh &&
                    _previews != null &&
                    _error == null &&
                    !_loading &&
                    _canMutate(app, _owner)
                ? _confirm
                : null,
          ),
          TextButton(
            onPressed: !changed && !_loading && !app.transactionBusy
                ? _refresh
                : null,
            child: const Text('Refresh settlement preview'),
          ),
        ],
      );
    },
  );
}
