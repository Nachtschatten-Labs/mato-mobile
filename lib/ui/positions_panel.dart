import 'dart:async';
import 'dart:math' as math;
import 'package:flutter/material.dart';
import '../domain/amounts.dart';
import '../domain/models.dart';
import '../domain/settlement.dart';
import '../state/app_controller.dart';
import '../wallet/wallet_service.dart';
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
    final items = _closed ? app.history.length : app.positions.length;
    final totalPages = math.max(1, (items / 10).ceil());
    final page = _page.clamp(0, totalPages - 1);
    final ended =
        app.positions
            .where(
              (p) => !p.isPaused && (app.market?.currentSlot ?? 0) >= p.endSlot,
            )
            .toList()
          ..sort((a, b) => a.endSlot.compareTo(b.endSlot));
    return Semantics(
      label: 'Your streams',
      container: true,
      child: Panel(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Wrap(
              alignment: WrapAlignment.spaceBetween,
              spacing: 12,
              runSpacing: 12,
              children: [
                Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    _Tab(
                      'Active',
                      selected: !_closed,
                      onTap: () => _select(false),
                    ),
                    const SizedBox(width: 8),
                    _Tab(
                      'Closed',
                      selected: _closed,
                      onTap: () => _select(true),
                    ),
                  ],
                ),
                if (connected && !_closed && app.positions.length > 1)
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      _SmallButton(
                        'Close ended${_batchCount(ended.length)}',
                        icon: Icons.close,
                        onPressed: ended.isNotEmpty && _canMutate(app, _owner)
                            ? () => _reviewClose(
                                context,
                                app,
                                ended.take(2).toList(),
                              )
                            : null,
                      ),
                      _SmallButton(
                        'Close all${_batchCount(app.positions.length)}',
                        icon: Icons.close,
                        onPressed: _canMutate(app, _owner)
                            ? () {
                                final selected = [...app.positions]
                                  ..sort(
                                    (a, b) => a.endSlot.compareTo(b.endSlot),
                                  );
                                _reviewClose(
                                  context,
                                  app,
                                  selected.take(2).toList(),
                                );
                              }
                            : null,
                      ),
                    ],
                  ),
              ],
            ),
            const SizedBox(height: 20),
            if (!connected)
              _EmptyState(
                _closed
                    ? 'Connect your wallet to view closed positions.'
                    : 'Connect a wallet to see your streams.',
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
                if (app.history.isEmpty)
                  _EmptyState(
                    app.loading.contains('history')
                        ? 'Loading recent closes...'
                        : 'No closed positions yet.',
                  ),
                if (app.history.isNotEmpty) ...[
                  const _ClosedHeader(),
                  for (final event in app.history.skip(page * 10).take(10))
                    _ClosedCard(
                      key: ValueKey('${event.signature}:${event.eventIndex}'),
                      app: app,
                      event: event,
                    ),
                ],
                if (app.historyHasMore)
                  TextButton(
                    onPressed: app.loading.contains('history')
                        ? null
                        : () => app.loadHistory(more: true),
                    child: const Text('Load more closed positions'),
                  ),
              ] else ...[
                if (app.positions.isEmpty && app.loading.contains('positions'))
                  const _EmptyState('Loading active positions...'),
                if (app.positions.isEmpty && !app.loading.contains('positions'))
                  ConstrainedBox(
                    constraints: const BoxConstraints(minHeight: 80),
                    child: Align(
                      alignment: Alignment.centerLeft,
                      child: Wrap(
                        crossAxisAlignment: WrapCrossAlignment.center,
                        children: [
                          const Text('No streams running. ', style: _muted),
                          InkWell(
                            onTap: widget.onStart,
                            child: const Padding(
                              padding: EdgeInsets.symmetric(vertical: 12),
                              child: Text(
                                'Start one',
                                style: TextStyle(
                                  fontSize: 14,
                                  color: MatoColors.secondary,
                                  decoration: TextDecoration.underline,
                                ),
                              ),
                            ),
                          ),
                          const Text(' and it shows up here.', style: _muted),
                        ],
                      ),
                    ),
                  ),
                for (final position in app.positions.skip(page * 10).take(10))
                  Padding(
                    padding: const EdgeInsets.only(bottom: 16),
                    child: _ActivePositionCard(
                      key: ValueKey(position.address),
                      app: app,
                      position: position,
                      initialSettlement: _settlements[_positionKey(position)],
                    ),
                  ),
              ],
              if (totalPages > 1)
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        '${page * 10 + 1}–${math.min((page + 1) * 10, items)} of $items positions',
                        style: const TextStyle(
                          color: MatoColors.muted,
                          fontSize: 11,
                        ),
                      ),
                    ),
                    _IconAction(
                      'Previous page',
                      Icons.chevron_left,
                      onPressed: page > 0
                          ? () => setState(() => _page = page - 1)
                          : null,
                    ),
                    const SizedBox(width: 8),
                    _IconAction(
                      'Next page',
                      Icons.chevron_right,
                      onPressed: page < totalPages - 1
                          ? () => setState(() => _page = page + 1)
                          : null,
                    ),
                  ],
                ),
            ],
          ],
        ),
      ),
    );
  }

  void _select(bool value) {
    setState(() {
      _closed = value;
      _page = 0;
    });
    app.historyVisible = value;
    if (value) unawaited(app.loadHistory());
  }
}

const _muted = TextStyle(color: MatoColors.muted, fontSize: 14, height: 1.7);
String _batchCount(int count) => count == 0
    ? ''
    : ' (${math.min(2, count)}${count > 2 ? ' of $count' : ''})';

class _Tab extends StatelessWidget {
  const _Tab(this.label, {required this.selected, required this.onTap});
  final String label;
  final bool selected;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) => Semantics(
    selected: selected,
    button: true,
    child: Material(
      color: selected ? MatoColors.elevated : Colors.transparent,
      borderRadius: BorderRadius.circular(99),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(99),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 9),
          child: Text(
            label,
            style: TextStyle(
              fontSize: 14,
              color: selected ? MatoColors.text : MatoColors.muted,
            ),
          ),
        ),
      ),
    ),
  );
}

class _EmptyState extends StatelessWidget {
  const _EmptyState(this.copy);
  final String copy;
  @override
  Widget build(BuildContext context) => ConstrainedBox(
    constraints: const BoxConstraints(minHeight: 80),
    child: Align(
      alignment: Alignment.centerLeft,
      child: Text(copy, style: _muted),
    ),
  );
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

class _ActivePositionCard extends StatefulWidget {
  const _ActivePositionCard({
    super.key,
    required this.app,
    required this.position,
    this.initialSettlement,
  });
  final AppController app;
  final PositionRecord position;
  final TradeSettlementSnapshot? initialSettlement;
  @override
  State<_ActivePositionCard> createState() => _ActivePositionCardState();
}

class _ActivePositionCardState extends State<_ActivePositionCard> {
  late final String? _owner = widget.app.wallet.address;
  TradeSettlementSnapshot? _settlement;
  String? _settlementError, _error, _pendingAction;
  bool _loading = false, _expanded = true;
  AppController get app => widget.app;
  @override
  void initState() {
    super.initState();
    _settlement = widget.initialSettlement;
    if (_settlement == null) unawaited(_loadSettlement());
  }

  @override
  void didUpdateWidget(covariant _ActivePositionCard oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (_positionKey(oldWidget.position) != _positionKey(widget.position)) {
      _settlement = widget.initialSettlement;
      _settlementError = null;
      if (_settlement == null) unawaited(_loadSettlement());
    } else if (widget.initialSettlement != null) {
      _settlement = widget.initialSettlement;
    }
  }

  Future<void> _loadSettlement() async {
    final position = widget.position;
    final key = _positionKey(position);
    if (position.isPaused ||
        (app.market?.currentSlot ?? 0) < position.endSlot ||
        _loading) {
      return;
    }
    setState(() {
      _loading = true;
      _settlementError = null;
    });
    try {
      final result = await app.repository.fetchSettlement(position);
      if (mounted &&
          _owner == app.wallet.address &&
          key == _positionKey(widget.position)) {
        setState(() {
          _settlement = result;
          if (result == null) {
            _settlementError =
                'Settlement is not ready yet. Refresh after the next market update.';
          }
        });
      }
    } catch (e) {
      if (mounted && key == _positionKey(widget.position)) {
        setState(() => _settlementError = errorText(e));
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _action(String action, PositionRecord position) async {
    if (!_canMutate(app, _owner)) return;
    setState(() {
      _error = null;
      _pendingAction = action;
    });
    final label = switch (action) {
      'pause' => 'Stream paused',
      'resume' => 'Stream resumed',
      _ => 'Sent to wallet',
    };
    try {
      final signature = await app.transact(
        label,
        () => switch (action) {
          'pause' => app.trading.pause(position.address),
          'resume' => app.trading.resume(position.address),
          _ => app.trading.withdraw(position.address),
        },
      );
      if (mounted) {
        showMatoToast(
          context,
          title: label,
          description: action == 'withdraw'
              ? 'The available tokens were sent to your wallet. Your stream keeps running.'
              : action == 'pause'
              ? 'Your stream will wait until you resume it.'
              : 'Your stream is running again.',
          signature: signature,
        );
      }
    } catch (e) {
      if (mounted) {
        final declined = e is WalletException && e.isCancellation;
        setState(() => _error = declined ? null : errorText(e));
        showMatoToast(
          context,
          title: declined ? 'Request declined' : 'Could not update stream',
          description: declined
              ? 'You declined it in your wallet. Nothing changed.'
              : errorText(e),
          error: !declined,
        );
      }
    } finally {
      if (mounted) setState(() => _pendingAction = null);
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
      final netAvailable = _afterFee(metrics.claimableSwappedAtoms, position);
      final withdrawn = bigIntValue(position.data['withdrawnAmount']);
      final netWithdrawn = _afterFee(withdrawn, position);
      final hasFee = intValue(position.data['feeBpsAtSubmission']) > 0;
      final state = position.isPaused
          ? 'Paused'
          : metrics.hasPositionEnded
          ? 'Ended'
          : 'Streaming';
      final remainingSlots = position.isPaused
          ? intValue(position.data['remainingSlots'])
          : app.market == null
          ? null
          : math.max(0, position.endSlot - app.market!.currentSlot);
      final flow = bigIntValue(position.data['flow']);
      final duration = flow > BigInt.zero
          ? (metrics.amountAtoms * flowPrecision ~/ flow).toDouble() *
                slotDurationSeconds
          : null;
      final pausedSeconds = position.isPaused && app.market != null
          ? math.max(
                  0,
                  app.market!.currentSlot -
                      intValue(position.data['pausedAtSlot']),
                ) *
                slotDurationSeconds
          : null;
      final toggleAction = position.isPaused ? 'resume' : 'pause';
      final toggling = _pendingAction == toggleAction;
      return Semantics(
        label: '${position.isBuy ? 'Buy' : 'Sell'} SOL stream',
        container: true,
        child: Container(
          decoration: BoxDecoration(
            border: Border.all(color: MatoColors.border),
            borderRadius: BorderRadius.circular(8),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Padding(
                padding: const EdgeInsets.symmetric(
                  horizontal: 12,
                  vertical: 16,
                ),
                child: Column(
                  children: [
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Semantics(
                                button: true,
                                expanded: _expanded,
                                label:
                                    '${_expanded ? 'Collapse' : 'Expand'} SOL position',
                                child: InkWell(
                                  key: ValueKey(
                                    'stream-toggle-${position.address}',
                                  ),
                                  onTap: () =>
                                      setState(() => _expanded = !_expanded),
                                  borderRadius: BorderRadius.circular(4),
                                  child: Padding(
                                    padding: const EdgeInsets.symmetric(
                                      vertical: 2,
                                    ),
                                    child: Row(
                                      children: [
                                        Icon(
                                          _expanded
                                              ? Icons.keyboard_arrow_up
                                              : Icons.keyboard_arrow_down,
                                          size: 14,
                                          color: MatoColors.muted,
                                        ),
                                        const SizedBox(width: 6),
                                        if (MediaQuery.sizeOf(context).width >=
                                            380) ...[
                                          SizedBox(
                                            width: 32,
                                            height: 20,
                                            child: Stack(
                                              children: [
                                                Positioned(
                                                  left: 12,
                                                  child: TokenBadge(
                                                    metrics.outputSymbol,
                                                    size: 20,
                                                  ),
                                                ),
                                                TokenBadge(
                                                  metrics.depositSymbol,
                                                  size: 20,
                                                ),
                                              ],
                                            ),
                                          ),
                                          const SizedBox(width: 6),
                                        ],
                                        Flexible(
                                          child: Text(
                                            metrics.depositSymbol,
                                            style: const TextStyle(
                                              fontSize: 12,
                                            ),
                                          ),
                                        ),
                                        const Padding(
                                          padding: EdgeInsets.symmetric(
                                            horizontal: 6,
                                          ),
                                          child: Icon(
                                            Icons.arrow_forward,
                                            size: 12,
                                            color: MatoColors.muted,
                                          ),
                                        ),
                                        Flexible(
                                          child: Text(
                                            metrics.outputSymbol,
                                            style: const TextStyle(
                                              fontSize: 12,
                                            ),
                                          ),
                                        ),
                                      ],
                                    ),
                                  ),
                                ),
                              ),
                              Padding(
                                padding: const EdgeInsets.only(
                                  left: 24,
                                  top: 8,
                                ),
                                child: Row(
                                  children: [
                                    Container(
                                      width: 4,
                                      height: 4,
                                      decoration: BoxDecoration(
                                        shape: BoxShape.circle,
                                        color: position.isPaused
                                            ? MatoColors.muted
                                            : metrics.hasPositionEnded
                                            ? MatoColors.positive
                                            : MatoColors.action,
                                      ),
                                    ),
                                    const SizedBox(width: 6),
                                    Text(
                                      state,
                                      style: TextStyle(
                                        fontSize: 10,
                                        color: position.isPaused
                                            ? MatoColors.muted
                                            : metrics.hasPositionEnded
                                            ? MatoColors.positive
                                            : MatoColors.action,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(width: 8),
                        _IconAction(
                          toggling
                              ? (app.wallet.isBusy
                                    ? 'Approve in wallet'
                                    : position.isPaused
                                    ? 'Resuming…'
                                    : 'Pausing…')
                              : position.isPaused
                              ? 'Resume position'
                              : 'Pause position',
                          position.isPaused
                              ? Icons.play_arrow_outlined
                              : Icons.pause,
                          busy: toggling,
                          onPressed: canAct && !metrics.hasPositionEnded
                              ? () => _action(toggleAction, position)
                              : null,
                        ),
                        const SizedBox(width: 8),
                        _IconAction(
                          'Close position',
                          Icons.close,
                          onPressed: canAct
                              ? () => _reviewClose(context, app, [position])
                              : null,
                        ),
                      ],
                    ),
                    const SizedBox(height: 16),
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                position.isBuy ? 'Spent' : 'Sold',
                                style: const TextStyle(
                                  fontSize: 11,
                                  color: MatoColors.muted,
                                ),
                              ),
                              const SizedBox(height: 8),
                              Tooltip(
                                message:
                                    '${_amount(metrics.consumedAtoms, metrics.depositDecimals, metrics.depositSymbol)} of ${_amount(metrics.amountAtoms, metrics.depositDecimals, metrics.depositSymbol)}',
                                child: Text.rich(
                                  TextSpan(
                                    children: [
                                      TextSpan(
                                        text: formatAmount(
                                          metrics.consumedAtoms,
                                          metrics.depositDecimals,
                                        ),
                                      ),
                                      TextSpan(
                                        text:
                                            ' / ${formatAmount(metrics.amountAtoms, metrics.depositDecimals)}',
                                        style: const TextStyle(
                                          color: MatoColors.muted,
                                        ),
                                      ),
                                    ],
                                  ),
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: const TextStyle(fontSize: 13),
                                ),
                              ),
                              const SizedBox(height: 8),
                              LinearProgressIndicator(
                                value: ((metrics.progressPercent ?? 0) / 100)
                                    .clamp(0, 1),
                                minHeight: 4,
                                borderRadius: BorderRadius.circular(8),
                                color: MatoColors.action,
                                backgroundColor: MatoColors.track,
                                semanticsLabel:
                                    '${position.isBuy ? 'Buy' : 'Sell'} position progress',
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(width: 16),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.end,
                            children: [
                              const Text(
                                'Avg. fill',
                                style: TextStyle(
                                  fontSize: 11,
                                  color: MatoColors.muted,
                                ),
                              ),
                              const SizedBox(height: 8),
                              Text(
                                _price(metrics.averagePrice),
                                style: const TextStyle(fontSize: 13),
                              ),
                              const SizedBox(height: 4),
                              Text(
                                metrics.progressPercent == null
                                    ? 'Updating fill…'
                                    : '${number(metrics.progressPercent, 1)}% filled',
                                style: const TextStyle(
                                  fontSize: 10,
                                  color: MatoColors.muted,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
              if (_expanded)
                Container(
                  margin: const EdgeInsets.fromLTRB(12, 0, 12, 12),
                  padding: const EdgeInsets.all(14),
                  decoration: BoxDecoration(
                    color: MatoColors.elevated,
                    border: Border.all(color: MatoColors.border),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      LayoutBuilder(
                        builder: (context, constraints) {
                          final received = _Stat(
                            label: 'Received',
                            hint: 'before fees',
                            value: _amount(
                              metrics.swappedAtoms,
                              metrics.outputDecimals,
                              metrics.outputSymbol,
                            ),
                          );
                          final available = Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              _Stat(
                                label: 'Available after fee',
                                value: _amount(
                                  netAvailable,
                                  metrics.outputDecimals,
                                  metrics.outputSymbol,
                                ),
                              ),
                              if (withdrawn > BigInt.zero) ...[
                                const SizedBox(height: 4),
                                Tooltip(
                                  message:
                                      'Estimated total sent after fees. Each send rounds its fee separately, so the exact total may be slightly lower.',
                                  child: Text(
                                    '${hasFee ? '≈ ' : ''}${_amount(netWithdrawn, metrics.outputDecimals, metrics.outputSymbol)} withdrawn',
                                    style: const TextStyle(
                                      fontSize: 10,
                                      color: MatoColors.muted,
                                    ),
                                  ),
                                ),
                              ],
                              const SizedBox(height: 12),
                              _SmallButton(
                                _pendingAction == 'withdraw'
                                    ? app.wallet.isBusy
                                          ? 'Approve in wallet'
                                          : 'Sending…'
                                    : 'Send to wallet',
                                icon: Icons.download_outlined,
                                busy: _pendingAction == 'withdraw',
                                onPressed:
                                    canAct &&
                                        !metrics.hasPositionEnded &&
                                        (netAvailable ?? BigInt.zero) >
                                            BigInt.zero
                                    ? () => _action('withdraw', position)
                                    : null,
                              ),
                            ],
                          );
                          return MediaQuery.sizeOf(context).width >= 380
                              ? Row(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Expanded(child: received),
                                    const SizedBox(width: 16),
                                    Expanded(child: available),
                                  ],
                                )
                              : Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    received,
                                    const SizedBox(height: 20),
                                    available,
                                  ],
                                );
                        },
                      ),
                      const SizedBox(height: 20),
                      Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Expanded(
                            child: _Stat(
                              label: 'Time left',
                              value: remainingSlots == null
                                  ? '—'
                                  : remainingSlots == 0
                                  ? 'Ended'
                                  : '≈ ${_streamDuration(remainingSlots * slotDurationSeconds)}',
                              suffix: duration == null
                                  ? null
                                  : 'of ${_streamDuration(duration)}',
                            ),
                          ),
                          if (position.isPaused)
                            Expanded(
                              child: Padding(
                                padding: const EdgeInsets.only(top: 8),
                                child: Text(
                                  'Paused${pausedSeconds == null ? '' : ' for ≈ ${_streamDuration(pausedSeconds)}'}',
                                  textAlign: TextAlign.right,
                                  style: const TextStyle(
                                    fontSize: 10,
                                    color: MatoColors.muted,
                                  ),
                                ),
                              ),
                            ),
                        ],
                      ),
                      const SizedBox(height: 20),
                      _PositionHistory(
                        app: app,
                        startSlot: intValue(position.data['startSlot']),
                        endSlot:
                            position.endSlot +
                            (position.isPaused && app.market != null
                                ? math.max(
                                    0,
                                    app.market!.currentSlot -
                                        intValue(position.data['pausedAtSlot']),
                                  )
                                : 0),
                        throughSlot: metrics.hasPositionEnded
                            ? position.endSlot
                            : math.max(
                                intValue(position.data['startSlot']),
                                app.market?.currentSlot ??
                                    intValue(position.data['startSlot']),
                              ),
                        paused: position.isPaused,
                        ended: metrics.hasPositionEnded,
                        reference: metrics.averagePrice,
                      ),
                      const SizedBox(height: 12),
                      Wrap(
                        alignment: WrapAlignment.spaceBetween,
                        spacing: 8,
                        runSpacing: 8,
                        children: [
                          _ExplorerLink(
                            'View position',
                            () => openExplorer(context, position.address),
                          ),
                          const Text(
                            'Fill estimates · USDC/SOL',
                            style: TextStyle(
                              fontSize: 10,
                              color: MatoColors.muted,
                            ),
                          ),
                        ],
                      ),
                      if (changedOwner)
                        const Notice(
                          'Wallet changed. Select a stream from your current wallet.',
                          error: true,
                        ),
                      if (metrics.remainingAtoms == null)
                        Notice(
                          _settlementError ??
                              'Waiting for confirmed settlement. Amounts will appear when accounting is available.',
                          error: _settlementError != null,
                          onRetry: _loading ? null : _loadSettlement,
                        ),
                      if (_error != null) Notice(_error!, error: true),
                      if (!_canMutate(app, _owner) &&
                          !app.transactionBusy &&
                          !changedOwner &&
                          candidates.isNotEmpty)
                        Notice(
                          !app.config.transactionsEnabled
                              ? 'Transactions are disabled in this build.'
                              : app.balances != null &&
                                    app.balances!.lamports <
                                        maintenanceFeeBufferAtoms
                              ? 'Keep at least 0.001 SOL for network fees.'
                              : 'Refresh live market data and wallet balances to manage this stream.',
                        ),
                    ],
                  ),
                ),
            ],
          ),
        ),
      );
    },
  );
}

BigInt? _afterFee(BigInt? atoms, PositionRecord position) {
  if (atoms == null) return null;
  final bps = intValue(position.data['feeBpsAtSubmission']);
  if (atoms <= BigInt.zero || bps <= 0) return atoms;
  final fee =
      (atoms * BigInt.from(bps) + BigInt.from(9999)) ~/ BigInt.from(10000);
  return atoms - fee;
}

String _price(double? value) => value == null || !value.isFinite || value <= 0
    ? '—'
    : value
          .toStringAsFixed(value >= 1 ? 4 : 6)
          .replaceFirst(RegExp(r'0+$'), '')
          .replaceFirst(RegExp(r'\.$'), '');
String _streamDuration(num seconds) {
  final rounded = math.max(0, seconds.ceil());
  if (rounded < 60) return '${rounded}s';
  if (rounded < 3600) return '${(rounded / 60).ceil()}m';
  final hours = rounded ~/ 3600, minutes = rounded % 3600 ~/ 60;
  if (hours >= 24) return '${hours ~/ 24}d ${hours % 24}h';
  return '${hours}h${minutes == 0 ? '' : ' ${minutes}m'}';
}

class _Stat extends StatelessWidget {
  const _Stat({
    required this.label,
    required this.value,
    this.hint,
    this.suffix,
  });
  final String label, value;
  final String? hint, suffix;
  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Text.rich(
        TextSpan(
          text: label,
          children: [
            if (hint != null)
              TextSpan(text: ' $hint', style: const TextStyle(fontSize: 10)),
          ],
        ),
        style: const TextStyle(fontSize: 11, color: MatoColors.muted),
      ),
      const SizedBox(height: 8),
      Text.rich(
        TextSpan(
          text: value,
          children: [
            if (suffix != null)
              TextSpan(
                text: '  $suffix',
                style: const TextStyle(fontSize: 10, color: MatoColors.muted),
              ),
          ],
        ),
        style: const TextStyle(fontSize: 15),
      ),
    ],
  );
}

class _IconAction extends StatelessWidget {
  const _IconAction(this.label, this.icon, {this.onPressed, this.busy = false});
  final String label;
  final IconData icon;
  final VoidCallback? onPressed;
  final bool busy;
  @override
  Widget build(BuildContext context) => SizedBox(
    width: 32,
    height: 32,
    child: IconButton.outlined(
      tooltip: label,
      onPressed: onPressed,
      padding: EdgeInsets.zero,
      iconSize: 14,
      style: IconButton.styleFrom(
        foregroundColor: MatoColors.muted,
        side: const BorderSide(color: MatoColors.border),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
      ),
      icon: busy
          ? const SizedBox(
              width: 14,
              height: 14,
              child: CircularProgressIndicator(strokeWidth: 1.5),
            )
          : Icon(icon),
    ),
  );
}

class _SmallButton extends StatelessWidget {
  const _SmallButton(
    this.label, {
    this.icon,
    this.onPressed,
    this.busy = false,
  });
  final String label;
  final IconData? icon;
  final VoidCallback? onPressed;
  final bool busy;
  @override
  Widget build(BuildContext context) => OutlinedButton(
    onPressed: busy ? null : onPressed,
    style: OutlinedButton.styleFrom(
      minimumSize: const Size(0, 28),
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      tapTargetSize: MaterialTapTargetSize.shrinkWrap,
      foregroundColor: MatoColors.secondary,
      side: const BorderSide(color: MatoColors.border),
      textStyle: const TextStyle(fontFamily: 'IBMPlexSans', fontSize: 11),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(6)),
    ),
    child: Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        if (busy)
          const SizedBox(
            width: 12,
            height: 12,
            child: CircularProgressIndicator(strokeWidth: 1.5),
          )
        else if (icon != null)
          Icon(icon, size: 12),
        if (icon != null || busy) const SizedBox(width: 6),
        Flexible(child: Text(label)),
      ],
    ),
  );
}

class _ExplorerLink extends StatelessWidget {
  const _ExplorerLink(this.label, this.onTap);
  final String label;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) => InkWell(
    onTap: onTap,
    child: Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            label,
            style: const TextStyle(
              fontSize: 10,
              color: MatoColors.muted,
              decoration: TextDecoration.underline,
            ),
          ),
          const SizedBox(width: 4),
          const Icon(Icons.open_in_new, size: 12, color: MatoColors.muted),
        ],
      ),
    ),
  );
}

class _ClosedHeader extends StatelessWidget {
  const _ClosedHeader();
  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(vertical: 12),
    decoration: const BoxDecoration(
      border: Border(bottom: BorderSide(color: MatoColors.border)),
    ),
    child: const Row(
      children: [
        Expanded(
          flex: 32,
          child: Padding(
            padding: EdgeInsets.only(left: 24, right: 2),
            child: Text(
              'Asset',
              style: TextStyle(fontSize: 12, color: MatoColors.muted),
            ),
          ),
        ),
        Expanded(
          flex: 40,
          child: Padding(
            padding: EdgeInsets.symmetric(horizontal: 8),
            child: Text(
              'Size',
              style: TextStyle(fontSize: 12, color: MatoColors.muted),
            ),
          ),
        ),
        Expanded(
          flex: 28,
          child: Padding(
            padding: EdgeInsets.symmetric(horizontal: 8),
            child: Text(
              'Avg. fill',
              textAlign: TextAlign.right,
              style: TextStyle(fontSize: 12, color: MatoColors.muted),
            ),
          ),
        ),
      ],
    ),
  );
}

class _ClosedCard extends StatefulWidget {
  const _ClosedCard({super.key, required this.app, required this.event});
  final AppController app;
  final ClosedPosition event;
  @override
  State<_ClosedCard> createState() => _ClosedCardState();
}

class _ClosedCardState extends State<_ClosedCard> {
  bool _expanded = false;
  @override
  Widget build(BuildContext context) {
    final event = widget.event;
    return Container(
      decoration: const BoxDecoration(
        border: Border(bottom: BorderSide(color: MatoColors.border)),
      ),
      child: Column(
        children: [
          Semantics(
            button: true,
            expanded: _expanded,
            label:
                '${_expanded ? 'Collapse' : 'Expand'} ${event.isBuy ? 'Buy' : 'Sell'} SOL position',
            child: InkWell(
              onTap: () => setState(() => _expanded = !_expanded),
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 16),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(
                      flex: 32,
                      child: Padding(
                        padding: const EdgeInsets.only(right: 2, top: 4),
                        child: Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Icon(
                              _expanded
                                  ? Icons.keyboard_arrow_up
                                  : Icons.keyboard_arrow_down,
                              size: 14,
                              color: MatoColors.muted,
                            ),
                            const SizedBox(width: 8),
                            Expanded(
                              child: Wrap(
                                spacing: 6,
                                runSpacing: 4,
                                crossAxisAlignment: WrapCrossAlignment.center,
                                children: [
                                  const Text(
                                    'SOL',
                                    style: TextStyle(fontSize: 12),
                                  ),
                                  Container(
                                    padding: const EdgeInsets.symmetric(
                                      horizontal: 6,
                                      vertical: 2,
                                    ),
                                    decoration: BoxDecoration(
                                      color: MatoColors.elevated,
                                      borderRadius: BorderRadius.circular(3),
                                    ),
                                    child: Text(
                                      event.isBuy ? 'Buy' : 'Sell',
                                      style: const TextStyle(
                                        fontSize: 12,
                                        color: MatoColors.secondary,
                                      ),
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                    Expanded(
                      flex: 40,
                      child: Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 8),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              _amount(
                                event.consumedAmount,
                                event.depositDecimals,
                                event.depositSymbol,
                              ),
                              style: const TextStyle(fontSize: 12),
                            ),
                            const SizedBox(height: 4),
                            Text(
                              '→ ${_amount(event.receivedAmount, event.outputDecimals, event.outputSymbol)}',
                              style: const TextStyle(fontSize: 12),
                            ),
                          ],
                        ),
                      ),
                    ),
                    Expanded(
                      flex: 28,
                      child: Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 8),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.end,
                          children: [
                            Text(
                              _price(event.averagePrice),
                              textAlign: TextAlign.right,
                              style: const TextStyle(fontSize: 12),
                            ),
                            const SizedBox(height: 4),
                            const Text(
                              'USDC/SOL',
                              textAlign: TextAlign.right,
                              style: TextStyle(
                                fontSize: 10,
                                color: MatoColors.muted,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
          if (_expanded)
            Padding(
              padding: const EdgeInsets.only(top: 8, bottom: 20),
              child: _ClosedReceipt(app: widget.app, event: event),
            ),
        ],
      ),
    );
  }
}

String _time(DateTime time, {bool seconds = false}) {
  final local = time.toLocal();
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  final hour = local.hour % 12 == 0 ? 12 : local.hour % 12;
  return '${months[local.month - 1]} ${local.day}, $hour:${local.minute.toString().padLeft(2, '0')}'
      '${seconds ? ':${local.second.toString().padLeft(2, '0')}' : ''} ${local.hour < 12 ? 'am' : 'pm'}';
}

class _ClosedReceipt extends StatelessWidget {
  const _ClosedReceipt({required this.app, required this.event});
  final AppController app;
  final ClosedPosition event;
  @override
  Widget build(BuildContext context) {
    final end = event.endSlot == null
        ? event.slot
        : math.min(event.endSlot!, event.slot);
    // The close event's timestamp is authoritative. Other slot times are estimates.
    final endTime = event.eventTime.subtract(
      Duration(
        milliseconds: ((event.slot - end) * slotDurationSeconds * 1000).round(),
      ),
    );
    final startTime = event.startSlot == null
        ? null
        : event.eventTime.subtract(
            Duration(
              milliseconds:
                  ((event.slot - event.startSlot!) * slotDurationSeconds * 1000)
                      .round(),
            ),
          );
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: MatoColors.elevated,
        border: Border.all(color: MatoColors.border),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _Stat(
            label: 'Started',
            value: startTime == null ? 'Unavailable' : '≈ ${_time(startTime)}',
          ),
          const SizedBox(height: 16),
          _Stat(
            label: 'Ended',
            value: '${end == event.slot ? '' : '≈ '}${_time(endTime)}',
          ),
          const SizedBox(height: 16),
          _Stat(
            label: 'Fee paid',
            value: _amount(
              event.feeAmount,
              event.outputDecimals,
              event.outputSymbol,
            ),
          ),
          const SizedBox(height: 20),
          if (event.startSlot != null && event.startSlot! <= end)
            _PositionHistory(
              app: app,
              startSlot: event.startSlot!,
              endSlot: end,
              throughSlot: end,
              reference: event.averagePrice,
              ended: true,
              receipt: true,
              knownStart: startTime,
              knownEnd: endTime,
            )
          else
            const _EmptyState('Price history is unavailable.'),
          const SizedBox(height: 20),
          Wrap(
            alignment: WrapAlignment.spaceBetween,
            crossAxisAlignment: WrapCrossAlignment.center,
            spacing: 12,
            runSpacing: 8,
            children: [
              _ExplorerLink(
                'View transaction',
                () => openExplorer(context, event.signature, transaction: true),
              ),
              if (event.remainingAmount > BigInt.zero)
                Text(
                  'Refunded ${_amount(event.remainingAmount, event.depositDecimals, event.depositSymbol)}',
                  style: const TextStyle(fontSize: 12, color: MatoColors.muted),
                ),
            ],
          ),
        ],
      ),
    );
  }
}

class _PositionHistory extends StatefulWidget {
  const _PositionHistory({
    required this.app,
    required this.startSlot,
    required this.endSlot,
    required this.throughSlot,
    this.reference,
    this.paused = false,
    this.ended = false,
    this.receipt = false,
    this.knownStart,
    this.knownEnd,
  });
  final AppController app;
  final int startSlot, endSlot, throughSlot;
  final double? reference;
  final bool paused, ended, receipt;
  final DateTime? knownStart, knownEnd;
  @override
  State<_PositionHistory> createState() => _PositionHistoryState();
}

class _PositionHistoryState extends State<_PositionHistory> {
  late Future<List<MarketUpdate>> _history;
  ChartPoint? _selected;
  int _lastLoadedSlot = 0;
  final Map<int, MarketPriceSnapshot> _observed = {};
  @override
  void initState() {
    super.initState();
    _recordLivePrice();
    _load();
  }

  @override
  void didUpdateWidget(covariant _PositionHistory oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.startSlot != oldWidget.startSlot) _observed.clear();
    _recordLivePrice();
    if (widget.startSlot != oldWidget.startSlot ||
        widget.endSlot != oldWidget.endSlot ||
        widget.paused != oldWidget.paused ||
        widget.ended != oldWidget.ended ||
        widget.throughSlot - _lastLoadedSlot >= 50) {
      _load();
    }
  }

  void _recordLivePrice() {
    final price = widget.app.price;
    if (widget.receipt ||
        price?.slot == null ||
        price?.eventTime == null ||
        price?.price == null ||
        !price!.price!.isFinite ||
        price.price! <= 0 ||
        price.slot! < widget.startSlot ||
        (widget.ended && price.slot! >= widget.endSlot)) {
      return;
    }
    _observed[price.slot!] = price;
    if (_observed.length > 1500) {
      final slots = _observed.keys.toList()..sort();
      for (final slot in slots.take(_observed.length - 1500)) {
        _observed.remove(slot);
      }
    }
  }

  void _load() {
    _lastLoadedSlot = widget.throughSlot;
    _selected = null;
    _history = widget.app.repository.fetchHistory(
      startSlot: widget.startSlot,
      endSlot: widget.throughSlot,
    );
  }

  @override
  Widget build(BuildContext context) => FutureBuilder<List<MarketUpdate>>(
    future: _history,
    builder: (context, result) {
      final updates = [...?result.data]
        ..sort(
          (a, b) => a.slot == b.slot
              ? a.eventIndex.compareTo(b.eventIndex)
              : a.slot.compareTo(b.slot),
        );
      final perSlot = <int, ChartPoint>{};
      for (final event in updates) {
        if (event.price == null ||
            !event.price!.isFinite ||
            event.price! <= 0 ||
            event.slot < widget.startSlot ||
            event.slot > widget.throughSlot ||
            (!widget.receipt && widget.ended && event.slot == widget.endSlot)) {
          continue;
        }
        perSlot[event.slot] = ChartPoint(
          time: event.createdAt,
          open: event.price!,
          high: event.price!,
          low: event.price!,
          close: event.price!,
        );
      }
      final lastIndexed = perSlot.isEmpty ? -1 : perSlot.keys.reduce(math.max);
      for (final observation in _observed.values) {
        if (observation.slot! > lastIndexed &&
            observation.slot! <= widget.throughSlot) {
          perSlot[observation.slot!] = ChartPoint(
            time: observation.eventTime!,
            open: observation.price!,
            high: observation.price!,
            low: observation.price!,
            close: observation.price!,
          );
        }
      }
      final slots = perSlot.keys.toList()..sort();
      final points = slots.map((slot) => perSlot[slot]!).toList();
      final anchorTime = points.isEmpty ? null : points.first.time;
      final anchorSlot = slots.isEmpty ? widget.startSlot : slots.first;
      // The last observed price continues until the current slot, never past a completed stream.
      if (!widget.ended &&
          slots.isNotEmpty &&
          slots.last < widget.throughSlot) {
        final last = points.last;
        points.add(
          ChartPoint(
            time: last.time.add(
              Duration(
                milliseconds:
                    ((widget.throughSlot - slots.last) *
                            slotDurationSeconds *
                            1000)
                        .round(),
              ),
            ),
            open: last.close,
            high: last.close,
            low: last.close,
            close: last.close,
          ),
        );
      }
      final start =
          widget.knownStart ??
          anchorTime?.subtract(
            Duration(
              milliseconds:
                  (((anchorSlot - widget.startSlot) *
                          slotDurationSeconds *
                          1000))
                      .round(),
            ),
          );
      final end =
          widget.knownEnd ??
          start?.add(
            Duration(
              milliseconds:
                  ((widget.endSlot - widget.startSlot) *
                          slotDurationSeconds *
                          1000)
                      .round(),
            ),
          );
      final value =
          _selected?.close ?? (points.isEmpty ? null : points.last.close);
      final loading = result.connectionState != ConnectionState.done;
      return Container(
        decoration: BoxDecoration(
          color: MatoColors.background,
          border: Border.all(color: MatoColors.border),
          borderRadius: BorderRadius.circular(8),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
              decoration: const BoxDecoration(
                border: Border(bottom: BorderSide(color: MatoColors.border)),
              ),
              child: Wrap(
                alignment: WrapAlignment.spaceBetween,
                spacing: 12,
                runSpacing: 8,
                children: [
                  Text.rich(
                    TextSpan(
                      text: widget.receipt
                          ? 'SOL/USDC price movement'
                          : 'SOL/USDC  ',
                      children: [
                        if (!widget.receipt)
                          TextSpan(
                            text: _price(value),
                            style: const TextStyle(color: MatoColors.text),
                          ),
                      ],
                    ),
                    style: const TextStyle(
                      fontSize: 11,
                      color: MatoColors.muted,
                    ),
                  ),
                  if (widget.receipt && points.isNotEmpty)
                    Text(
                      'Started at ${_price(points.first.close)}',
                      style: const TextStyle(
                        fontSize: 11,
                        color: MatoColors.muted,
                      ),
                    )
                  else if (!widget.receipt)
                    Wrap(
                      spacing: 8,
                      runSpacing: 4,
                      crossAxisAlignment: WrapCrossAlignment.center,
                      children: [
                        Container(
                          width: 16,
                          height: 1,
                          color: MatoColors.action,
                        ),
                        const Text(
                          'Market price',
                          style: TextStyle(
                            fontSize: 11,
                            color: MatoColors.muted,
                          ),
                        ),
                        if (widget.paused) ...[
                          const Text(
                            'Stream paused',
                            style: TextStyle(
                              fontSize: 10,
                              color: MatoColors.muted,
                            ),
                          ),
                        ],
                      ],
                    ),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(14, 12, 14, 0),
              child: points.isEmpty
                  ? SizedBox(
                      height: widget.receipt ? 112 : 128,
                      child: Center(
                        child: result.hasError
                            ? InkWell(
                                onTap: () => setState(_load),
                                child: const Text(
                                  'Price history is unavailable. Retry',
                                  textAlign: TextAlign.center,
                                  style: TextStyle(
                                    fontSize: 12,
                                    color: MatoColors.muted,
                                  ),
                                ),
                              )
                            : Text(
                                loading
                                    ? 'Loading price history…'
                                    : widget.receipt
                                    ? 'Price history is unavailable.'
                                    : 'Waiting for market prices after this stream started.',
                                textAlign: TextAlign.center,
                                style: const TextStyle(
                                  fontSize: 12,
                                  color: MatoColors.muted,
                                ),
                              ),
                      ),
                    )
                  : PriceChart(
                      points: points,
                      reference: widget.receipt
                          ? widget.reference
                          : points.first.close,
                      height: widget.receipt ? 112 : 128,
                      compact: true,
                      stepped: !widget.receipt,
                      paused: widget.paused,
                      startTime: start,
                      endTime: end,
                      onCrosshairMove: (point) =>
                          setState(() => _selected = point),
                    ),
            ),
            Container(
              margin: const EdgeInsets.symmetric(horizontal: 14),
              padding: const EdgeInsets.only(top: 8, bottom: 12),
              decoration: const BoxDecoration(
                border: Border(top: BorderSide(color: MatoColors.border)),
              ),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: Text(
                      _selected != null
                          ? _time(_selected!.time, seconds: true)
                          : start == null
                          ? 'Start time unavailable'
                          : '≈ ${_time(start, seconds: !widget.receipt)}',
                      style: const TextStyle(
                        fontSize: 10,
                        color: MatoColors.muted,
                      ),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Text(
                      end == null
                          ? 'Market price'
                          : '${widget.ended ? '≈ End' : 'Est. end'} ${_time(end, seconds: !widget.receipt)}',
                      textAlign: TextAlign.right,
                      style: const TextStyle(
                        fontSize: 10,
                        color: MatoColors.muted,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
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
      ? 'Close this stream?'
      : 'Close ${positions.length} streams?',
  // Keep approval and confirmation attached to this review. The explicit
  // cancel button remains available until a wallet transaction begins.
  dismissible: false,
  showClose: false,
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
            const Duration(seconds: 15)) {
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
      if (mounted) {
        setState(() => _signature = signature);
        showMatoToast(
          context,
          title: widget.positions.length == 1
              ? 'Stream closed'
              : 'Streams closed',
          description: 'Received tokens and unspent funds were returned.',
          signature: signature,
        );
        Navigator.of(context).pop();
      }
    } catch (e) {
      if (mounted) {
        final declined = e is WalletException && e.isCancellation;
        setState(() => _error = declined ? null : errorText(e));
        showMatoToast(
          context,
          title: declined ? 'Request declined' : 'Could not close stream',
          description: declined
              ? 'You declined it in your wallet. Nothing changed.'
              : errorText(e),
          error: !declined,
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
    animation: app,
    builder: (context, _) {
      final changed = !_samePositions;
      final fresh =
          _simulatedAt != null &&
          DateTime.now().difference(_simulatedAt!) <=
              const Duration(seconds: 15);
      final paused = widget.positions.every((position) => position.isPaused);
      return PopScope(
        canPop: !app.transactionBusy,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text(
              "This ends the stream. It can't be resumed.",
              style: TextStyle(
                fontSize: 12,
                height: 1.65,
                color: MatoColors.muted,
              ),
            ),
            const SizedBox(height: 16),
            Container(
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: MatoColors.elevated,
                borderRadius: BorderRadius.circular(8),
                border: Border.all(color: MatoColors.border),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const Text("You'll get back", style: TextStyle(fontSize: 12)),
                  const SizedBox(height: 12),
                  if (_loading && _previews == null)
                    const Padding(
                      padding: EdgeInsets.symmetric(vertical: 12),
                      child: Row(
                        children: [
                          SizedBox(
                            width: 14,
                            height: 14,
                            child: CircularProgressIndicator(strokeWidth: 1.5),
                          ),
                          SizedBox(width: 8),
                          Expanded(
                            child: Text(
                              'Calculating your returns…',
                              style: TextStyle(
                                fontSize: 12,
                                color: MatoColors.muted,
                              ),
                            ),
                          ),
                        ],
                      ),
                    )
                  else if (_previews == null)
                    const Text(
                      'A current preview is required before closing.',
                      style: TextStyle(fontSize: 12, color: MatoColors.muted),
                    ),
                  for (final preview
                      in _previews ?? <Map<String, dynamic>>[]) ...[
                    if (widget.positions.length > 1)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 12),
                        child: Text(
                          '${preview['isBuy'] == true ? 'Buy' : 'Sell'} SOL · ${shortAddress(preview['positionAddress'] as String)}',
                          style: const TextStyle(fontSize: 12),
                        ),
                      ),
                    _Payout(
                      token: preview['isBuy'] == true ? 'SOL' : 'USDC',
                      label: 'Received, after fee',
                      value: formatAmount(
                        bigIntValue(preview['receivedAtoms']),
                        preview['isBuy'] == true ? 9 : 6,
                        precision: 9,
                      ),
                      receiver:
                          preview[preview['isBuy'] == true
                                  ? 'baseReceiver'
                                  : 'quoteReceiver']
                              as String,
                      owner: _owner,
                    ),
                    const SizedBox(height: 12),
                    _Payout(
                      token: preview['isBuy'] == true ? 'USDC' : 'SOL',
                      label: 'Unspent deposit',
                      value: formatAmount(
                        bigIntValue(preview['remainingDepositAtoms']),
                        preview['isBuy'] == true ? 6 : 9,
                        precision: 9,
                      ),
                      receiver:
                          preview[preview['isBuy'] == true
                                  ? 'quoteReceiver'
                                  : 'baseReceiver']
                              as String,
                      owner: _owner,
                    ),
                    const Divider(height: 25),
                    Detail(
                      'Trading fee included',
                      _amount(
                        bigIntValue(preview['feeAtoms']),
                        preview['isBuy'] == true ? 9 : 6,
                        preview['isBuy'] == true ? 'SOL' : 'USDC',
                      ),
                    ),
                    Detail(
                      'Position rent returned',
                      _amount(
                        bigIntValue(preview['positionRentLamports']),
                        9,
                        'SOL',
                      ),
                    ),
                    if (preview['rentReceiver'] != _owner)
                      Text(
                        'Rent goes to ${shortAddress(preview['rentReceiver'] as String)}.',
                        style: const TextStyle(
                          fontSize: 10,
                          color: MatoColors.muted,
                        ),
                      ),
                  ],
                ],
              ),
            ),
            if (changed)
              const Notice(
                'The wallet or stream changed. Close this review and select the streams again.',
                error: true,
              ),
            if (_error != null)
              Notice(
                _error!,
                error: true,
                onRetry: app.transactionBusy || _loading ? null : _refresh,
              ),
            const SizedBox(height: 12),
            Text(
              '${_loading && _previews != null ? 'Updating returns… ' : ''}Amounts may change until confirmed. Network fees and any token-account rent are separate.',
              style: const TextStyle(
                fontSize: 10,
                height: 1.6,
                color: MatoColors.muted,
              ),
            ),
            const SizedBox(height: 16),
            Row(
              children: [
                Expanded(
                  child: ActionButton(
                    app.transactionBusy
                        ? app.wallet.isBusy
                              ? 'Approve in wallet'
                              : 'Closing…'
                        : 'Close stream',
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
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: ActionButton(
                    paused ? 'Keep it paused' : 'Keep it running',
                    secondary: true,
                    onPressed: app.transactionBusy
                        ? null
                        : () => Navigator.of(context).pop(),
                  ),
                ),
              ],
            ),
            if (!fresh || _error != null)
              TextButton(
                onPressed: !changed && !_loading && !app.transactionBusy
                    ? _refresh
                    : null,
                child: const Text('Refresh preview'),
              ),
          ],
        ),
      );
    },
  );
}

class _Payout extends StatelessWidget {
  const _Payout({
    required this.token,
    required this.label,
    required this.value,
    required this.receiver,
    required this.owner,
  });
  final String token, label, value, receiver;
  final String? owner;
  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Row(
        children: [
          TokenBadge(token, size: 24),
          const SizedBox(width: 8),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(token, style: const TextStyle(fontSize: 12)),
                const SizedBox(height: 2),
                Text(
                  label,
                  style: const TextStyle(fontSize: 10, color: MatoColors.muted),
                ),
              ],
            ),
          ),
          const SizedBox(width: 12),
          Flexible(
            child: Text(
              value,
              textAlign: TextAlign.right,
              style: const TextStyle(fontSize: 13),
            ),
          ),
        ],
      ),
      if (receiver != owner)
        Padding(
          padding: const EdgeInsets.only(top: 4),
          child: Text(
            'To ${shortAddress(receiver)}',
            style: const TextStyle(fontSize: 10, color: MatoColors.muted),
          ),
        ),
    ],
  );
}
