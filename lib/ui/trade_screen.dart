import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../domain/amounts.dart';
import '../domain/models.dart';
import '../domain/order.dart';
import '../state/app_controller.dart';
import 'positions_panel.dart';
import 'price_chart.dart';
import 'theme.dart';
import 'widgets.dart';

class TradeScreen extends StatefulWidget {
  const TradeScreen({super.key, required this.app});
  final AppController app;
  @override
  State<TradeScreen> createState() => _TradeScreenState();
}

class _TradeScreenState extends State<TradeScreen> {
  final _amount = TextEditingController();
  final _amountFocus = FocusNode();
  bool _isBuy = true;
  bool _smart = true;
  bool _candles = false;
  bool _showBook = false;
  bool _details = false;
  bool _inverse = false;
  bool? _bookSide;
  int _seconds = 300;
  String? _error;
  AppController get app => widget.app;
  int get decimals => _isBuy ? 6 : 9;
  BigInt? get atoms => parseTokenAmount(_amount.text, decimals);
  BigInt? get available => app.balances == null
      ? null
      : _isBuy
      ? app.balances!.usdc
      : app.balances!.spendableSol;
  int? get slots => _smart
      ? recommendDurationSlots(
          amountAtoms: atoms,
          isBuy: _isBuy,
          streamingState: app.market,
        )
      : durationToSlots(_seconds);
  double? impactAt(int? duration) => duration == null
      ? null
      : computePriceImpactPercent(
          amountAtoms: atoms,
          isBuy: _isBuy,
          durationSlots: duration,
          streamingState: app.market,
        );
  double? get execution => app.market?.price == null || impactAt(slots) == null
      ? null
      : app.market!.price! * (1 + (_isBuy ? 1 : -1) * impactAt(slots)! / 100);
  double? get receive => atoms == null || execution == null || execution! <= 0
      ? null
      : atoms!.toDouble() /
            math.pow(10, decimals) *
            (_isBuy ? 1 / execution! : execution!);

  @override
  void dispose() {
    _amount.dispose();
    _amountFocus.dispose();
    super.dispose();
  }

  void setPercent(double percent) {
    if (available == null) return;
    final precision = BigInt.from(10).pow(decimals - (_isBuy ? 2 : 3));
    final amount =
        atomsFromPercent(available!, percent) ~/ precision * precision;
    setState(() {
      _amount.text = formatAtomsToInput(amount, decimals);
      _error = null;
    });
  }

  Future<void> review() async {
    _amountFocus.unfocus();
    if (app.wallet.address == null) {
      try {
        await app.wallet.connect();
      } catch (e) {
        if (mounted) setState(() => _error = errorText(e));
      }
      return;
    }
    final reviewedAtoms = atoms;
    final reviewedSlots = slots;
    final reviewedBuy = _isBuy;
    final reviewedOwner = app.wallet.address!;
    final reviewedImpact = impactAt(slots);
    final validation = validateOrder(
      amountAtoms: reviewedAtoms,
      isBuy: reviewedBuy,
      durationSlots: reviewedSlots,
      streamingState: app.market,
      balances: app.balances,
      walletConnected: true,
      transactionsEnabled: app.config.transactionsEnabled,
    );
    if (!app.marketFresh ||
        app.errors.containsKey('balances') ||
        validation != null) {
      setState(
        () => _error =
            validation ??
            'Refresh market data and balances before starting a stream.',
      );
      return;
    }
    if (reviewedAtoms == null || reviewedSlots == null) return;
    var acknowledged = false;
    final accepted = await showMatoSheet<bool>(
      context,
      title: 'Review your stream',
      child: StatefulBuilder(
        builder: (context, setSheet) => Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              '${reviewedBuy ? 'Buy' : 'Sell'} SOL',
              style: const TextStyle(fontSize: 28, letterSpacing: -.7),
            ),
            const SizedBox(height: 16),
            Detail(
              'You ${reviewedBuy ? 'spend' : 'sell'}',
              '${formatAmount(reviewedAtoms, reviewedBuy ? 6 : 9, precision: 9)} ${reviewedBuy ? 'USDC' : 'SOL'}',
            ),
            Detail('Duration', durationText(reviewedSlots * .2)),
            Detail(
              'Estimated price impact',
              reviewedImpact == null
                  ? 'Unavailable'
                  : '${number(reviewedImpact, 4)}%',
            ),
            Detail('Wallet', shortAddress(reviewedOwner)),
            const Notice(
              'Your order trades in small pieces over time. The price and final amount received can change. You can pause or close the stream.',
            ),
            if (reviewedImpact != null && reviewedImpact > 1)
              const Notice(
                'This stream has high estimated price impact. Consider a longer duration.',
                error: true,
              ),
            CheckboxListTile(
              contentPadding: EdgeInsets.zero,
              controlAffinity: ListTileControlAffinity.leading,
              value: acknowledged,
              onChanged: (value) =>
                  setSheet(() => acknowledged = value ?? false),
              title: const Text(
                'I understand that the final price is not guaranteed.',
                style: TextStyle(fontSize: 13),
              ),
            ),
            const SizedBox(height: 12),
            ActionButton(
              'Start stream',
              onPressed: acknowledged
                  ? () => Navigator.pop(context, true)
                  : null,
            ),
          ],
        ),
      ),
    );
    if (accepted != true || !mounted) return;
    setState(() => _error = null);
    try {
      final sig = await app.transact('Stream started', () async {
        if (app.wallet.address != reviewedOwner) {
          throw StateError('Your wallet changed. Review the stream again.');
        }
        final freshMarket = await app.repository.fetchMarketState();
        final freshBalances = await app.repository.fetchBalances(reviewedOwner);
        if (app.wallet.address != reviewedOwner) {
          throw StateError('Your wallet changed. Review the stream again.');
        }
        final error = validateOrder(
          amountAtoms: reviewedAtoms,
          isBuy: reviewedBuy,
          durationSlots: reviewedSlots,
          streamingState: freshMarket,
          balances: freshBalances,
          walletConnected: true,
          transactionsEnabled: app.config.transactionsEnabled,
        );
        if (error != null) throw StateError(error);
        final freshImpact = computePriceImpactPercent(
          amountAtoms: reviewedAtoms,
          isBuy: reviewedBuy,
          durationSlots: reviewedSlots,
          streamingState: freshMarket,
        );
        if (requiresNewImpactReview(reviewedImpact, freshImpact)) {
          throw StateError(
            'Market conditions changed. Review the updated price impact.',
          );
        }
        return app.trading.submitOrder(
          amount: reviewedAtoms,
          durationSlots: reviewedSlots,
          id: math.Random.secure().nextInt(0x100000000),
          isBuy: reviewedBuy,
        );
      });
      if (!mounted) return;
      _amount.clear();
      HapticFeedback.mediumImpact();
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: const Text('Stream started'),
          action: SnackBarAction(
            label: 'View',
            onPressed: () => openExplorer(context, sig, transaction: true),
          ),
        ),
      );
    } catch (e) {
      if (mounted) setState(() => _error = errorText(e));
    }
  }

  Future<void> customize() async {
    _amountFocus.unfocus();
    var seconds = slots == null
        ? _seconds
        : (slots! * .2).round().clamp(5, maxOrderDurationSeconds);
    final result = await showMatoSheet<int>(
      context,
      title: 'Customize your stream',
      child: StatefulBuilder(
        builder: (context, setSheet) {
          final impact = impactAt(durationToSlots(seconds));
          return Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Text(
                'A slower stream moves the price less. A faster stream finishes sooner.',
                style: TextStyle(color: MatoColors.muted, height: 1.6),
              ),
              const SizedBox(height: 28),
              Text(
                durationText(seconds),
                style: const TextStyle(fontSize: 36, letterSpacing: -1),
              ),
              const SizedBox(height: 20),
              SizedBox(
                height: 120,
                child: CustomPaint(
                  painter: _ImpactCurve(
                    values: List.generate(
                      70,
                      (i) =>
                          impactAt(
                            durationToSlots(
                              5 * math.pow(maxOrderDurationSeconds / 5, i / 69),
                            ),
                          ) ??
                          0,
                    ),
                    selected:
                        math.log(seconds / 5) /
                        math.log(maxOrderDurationSeconds / 5),
                  ),
                ),
              ),
              Slider(
                value:
                    (math.log(seconds / 5) /
                            math.log(maxOrderDurationSeconds / 5))
                        .clamp(0, 1),
                label: durationText(seconds),
                onChanged: (v) => setSheet(
                  () => seconds = (5 * math.pow(maxOrderDurationSeconds / 5, v))
                      .round()
                      .clamp(5, maxOrderDurationSeconds),
                ),
              ),
              const Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(
                    '5 seconds',
                    style: TextStyle(color: MatoColors.muted, fontSize: 12),
                  ),
                  Text(
                    '1 year',
                    style: TextStyle(color: MatoColors.muted, fontSize: 12),
                  ),
                ],
              ),
              const SizedBox(height: 20),
              Wrap(
                spacing: 6,
                runSpacing: 4,
                children: [60, 300, 3600, 86400, 604800]
                    .map(
                      (s) => ActionChip(
                        label: Text(durationText(s)),
                        onPressed: () => setSheet(() => seconds = s),
                      ),
                    )
                    .toList(),
              ),
              Detail(
                'Estimated impact',
                impact == null
                    ? 'Waiting for live liquidity'
                    : '${number(impact, 4)}%',
              ),
              const SizedBox(height: 14),
              ActionButton(
                'Use this duration',
                onPressed: () => Navigator.pop(context, seconds),
              ),
              TextButton(
                onPressed: () => Navigator.pop(context, -1),
                child: const Text('Use mato’s recommended duration'),
              ),
            ],
          );
        },
      ),
    );
    if (result == null || !mounted) return;
    setState(() {
      _smart = result == -1;
      if (result > 0) _seconds = result;
    });
  }

  @override
  Widget build(BuildContext context) {
    final input = _isBuy ? 'USDC' : 'SOL';
    final output = _isBuy ? 'SOL' : 'USDC';
    final hasAmount = atoms != null && atoms! > BigInt.zero;
    final impact = impactAt(slots);
    final validation = validateOrder(
      amountAtoms: atoms,
      isBuy: _isBuy,
      durationSlots: slots,
      streamingState: app.market,
      balances: app.balances,
      walletConnected: app.wallet.isConnected,
      transactionsEnabled: app.config.transactionsEnabled,
    );
    final button = !app.wallet.isSupported
        ? 'Open on Android to connect'
        : !app.wallet.isConnected
        ? 'Connect wallet to stream'
        : !hasAmount
        ? 'Enter amount'
        : validation != null
        ? 'Review unavailable'
        : '${_isBuy ? 'Buy' : 'Sell'} over ${durationText(slots! * .2)}';
    return RefreshIndicator(
      onRefresh: () => app.refresh(forceChart: true),
      child: ListView(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 28),
        children: [
          Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 600),
              child: Column(
                children: [
                  Panel(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        PillTabs(
                          values: const {true: 'Buy', false: 'Sell'},
                          selected: _isBuy,
                          onChanged: (value) => setState(() {
                            _isBuy = value;
                            _amount.clear();
                            _smart = true;
                            _error = null;
                          }),
                        ),
                        const SizedBox(height: 20),
                        Container(
                          padding: const EdgeInsets.all(16),
                          decoration: BoxDecoration(
                            color: const Color(0xff111111),
                            borderRadius: BorderRadius.circular(14),
                            border: Border.all(color: MatoColors.border),
                          ),
                          child: Column(
                            children: [
                              Row(
                                children: [
                                  Text(
                                    _isBuy ? 'Buy with' : 'Sell',
                                    style: const TextStyle(
                                      color: MatoColors.muted,
                                      fontSize: 13,
                                    ),
                                  ),
                                  const Spacer(),
                                  if (app.wallet.isConnected)
                                    Text(
                                      'Balance ${formatAmount(available, decimals, precision: _isBuy ? 2 : 3)}',
                                      style: const TextStyle(
                                        color: MatoColors.muted,
                                        fontSize: 12,
                                      ),
                                    ),
                                ],
                              ),
                              Row(
                                children: [
                                  Expanded(
                                    child: TextField(
                                      controller: _amount,
                                      focusNode: _amountFocus,
                                      keyboardType:
                                          const TextInputType.numberWithOptions(
                                            decimal: true,
                                          ),
                                      inputFormatters: [
                                        TextInputFormatter.withFunction(
                                          (old, next) =>
                                              RegExp(
                                                r'^\d*(\.\d*)?$',
                                              ).hasMatch(next.text)
                                              ? next
                                              : old,
                                        ),
                                      ],
                                      style: const TextStyle(
                                        fontSize: 35,
                                        letterSpacing: -.7,
                                      ),
                                      decoration: const InputDecoration(
                                        hintText: '0',
                                      ),
                                      onChanged: (_) =>
                                          setState(() => _error = null),
                                    ),
                                  ),
                                  TokenBadge(input),
                                  const SizedBox(width: 8),
                                  Text(
                                    input,
                                    style: const TextStyle(fontSize: 17),
                                  ),
                                ],
                              ),
                              if (app.wallet.isConnected) ...[
                                Row(
                                  mainAxisAlignment: MainAxisAlignment.end,
                                  children: [25, 50, 75, 100]
                                      .map(
                                        (p) => Flexible(
                                          child: TextButton(
                                            style: TextButton.styleFrom(
                                              minimumSize: const Size(40, 36),
                                              padding:
                                                  const EdgeInsets.symmetric(
                                                    horizontal: 8,
                                                  ),
                                            ),
                                            onPressed: available == null
                                                ? null
                                                : () =>
                                                      setPercent(p.toDouble()),
                                            child: Text(
                                              p == 100 ? 'Max' : '$p%',
                                              style: const TextStyle(
                                                fontSize: 12,
                                              ),
                                            ),
                                          ),
                                        ),
                                      )
                                      .toList(),
                                ),
                                Slider(
                                  value: toSliderPercent(atoms, available),
                                  min: 0,
                                  max: 100,
                                  semanticFormatterCallback: (v) =>
                                      '${v.round()} percent of available balance',
                                  onChanged: available == null
                                      ? null
                                      : setPercent,
                                ),
                              ],
                            ],
                          ),
                        ),
                        const SizedBox(height: 8),
                        Wrap(
                          spacing: 12,
                          alignment: WrapAlignment.spaceBetween,
                          crossAxisAlignment: WrapCrossAlignment.center,
                          children: [
                            const Text(
                              'Over the next',
                              style: TextStyle(
                                color: MatoColors.muted,
                                fontSize: 13,
                              ),
                            ),
                            TextButton(
                              onPressed: customize,
                              child: Row(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  Text(
                                    slots == null
                                        ? 'Auto'
                                        : durationText(slots! * .2),
                                  ),
                                  const SizedBox(width: 8),
                                  const Icon(Icons.tune_rounded, size: 16),
                                ],
                              ),
                            ),
                          ],
                        ),
                        if (!_smart)
                          Align(
                            alignment: Alignment.centerRight,
                            child: TextButton(
                              onPressed: () => setState(() => _smart = true),
                              child: const Text(
                                'Reset to mato’s pick',
                                style: TextStyle(fontSize: 12),
                              ),
                            ),
                          ),
                        const SizedBox(height: 6),
                        Container(
                          padding: const EdgeInsets.all(16),
                          decoration: BoxDecoration(
                            color: const Color(0xff171717),
                            borderRadius: BorderRadius.circular(14),
                          ),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              const Text(
                                'Est. receive',
                                style: TextStyle(
                                  color: MatoColors.muted,
                                  fontSize: 13,
                                ),
                              ),
                              const SizedBox(height: 10),
                              Row(
                                children: [
                                  Expanded(
                                    child: Text(
                                      receive == null
                                          ? (hasAmount ? '—' : '0')
                                          : number(receive, _isBuy ? 4 : 2),
                                      style: const TextStyle(
                                        fontSize: 32,
                                        letterSpacing: -.6,
                                      ),
                                    ),
                                  ),
                                  TokenBadge(output),
                                  const SizedBox(width: 8),
                                  Text(
                                    output,
                                    style: const TextStyle(fontSize: 17),
                                  ),
                                ],
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(height: 20),
                        Text(
                          '1 SOL ≈ ${number(app.currentPrice)} USDC',
                          style: const TextStyle(
                            color: MatoColors.muted,
                            fontSize: 13,
                          ),
                        ),
                        if (hasAmount) ...[
                          InkWell(
                            onTap: () => setState(() => _details = !_details),
                            child: Padding(
                              padding: const EdgeInsets.symmetric(vertical: 14),
                              child: Row(
                                children: [
                                  const Text(
                                    'Impact',
                                    style: TextStyle(
                                      color: MatoColors.muted,
                                      fontSize: 13,
                                    ),
                                  ),
                                  const SizedBox(width: 10),
                                  Text(
                                    impact == null
                                        ? '—'
                                        : '${number(impact, 4)}%',
                                    style: TextStyle(
                                      color: (impact ?? 0) > 1
                                          ? MatoColors.negative
                                          : MatoColors.secondary,
                                      fontSize: 13,
                                    ),
                                  ),
                                  Icon(
                                    _details
                                        ? Icons.keyboard_arrow_up
                                        : Icons.keyboard_arrow_down,
                                    size: 18,
                                    color: MatoColors.muted,
                                  ),
                                ],
                              ),
                            ),
                          ),
                          if (_details) ...[
                            InkWell(
                              onTap: () => setState(() => _inverse = !_inverse),
                              child: Detail(
                                'Rate  ⇄',
                                _inverse
                                    ? '1 USDC ≈ ${number(app.currentPrice == null ? null : 1 / app.currentPrice!, 6)} SOL'
                                    : '1 SOL ≈ ${number(app.currentPrice, 4)} USDC',
                              ),
                            ),
                            Detail(
                              'Est. execution price',
                              '${number(execution, 4)} USDC',
                            ),
                            const Text(
                              'Estimates use current liquidity. Actual execution changes as the market moves.',
                              style: TextStyle(
                                color: MatoColors.muted,
                                fontSize: 12,
                                height: 1.5,
                              ),
                            ),
                          ],
                          if (app.wallet.isConnected && validation != null)
                            Notice(validation),
                        ],
                        if (app.errors['market'] != null)
                          Notice(
                            'On-chain market data is unavailable. ${errorText(app.errors['market']!)}',
                            error: true,
                            onRetry: () => app.refresh(),
                          ),
                        if (app.errors['balances'] != null)
                          const Notice(
                            'Could not refresh wallet balances.',
                            error: true,
                          ),
                        if (_error != null) Notice(_error!, error: true),
                        const SizedBox(height: 16),
                        ActionButton(
                          button,
                          busy: app.transactionBusy || app.wallet.isBusy,
                          onPressed:
                              app.wallet.isSupported &&
                                  (!app.wallet.isConnected ||
                                      (validation == null && app.marketFresh))
                              ? review
                              : null,
                        ),
                        const SizedBox(height: 12),
                        const Text(
                          'Small trades. Spread over time.',
                          textAlign: TextAlign.center,
                          style: TextStyle(
                            fontSize: 12,
                            color: MatoColors.faint,
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 20),
                  _marketPanel(),
                  const SizedBox(height: 20),
                  PositionsPanel(
                    app: app,
                    onStart: () => _amountFocus.requestFocus(),
                  ),
                  const SizedBox(height: 22),
                  const Text(
                    'Continuous clearing. On Solana.',
                    style: TextStyle(color: MatoColors.faint, fontSize: 12),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _marketPanel() {
    final price = app.currentPrice;
    final first = app.candles.isEmpty ? null : app.candles.first.open;
    final change = price == null || first == null || first == 0
        ? null
        : (price - first) / first * 100;
    return Panel(
      padding: const EdgeInsets.all(18),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              const TokenBadge('SOL', size: 32),
              const SizedBox(width: 10),
              const Expanded(
                child: Text('SOL / USDC', style: TextStyle(fontSize: 17)),
              ),
              IconButton(
                tooltip: 'Price chart',
                onPressed: () => setState(() {
                  _showBook = false;
                  app.bookVisible = false;
                }),
                icon: Icon(
                  Icons.show_chart_rounded,
                  color: !_showBook ? MatoColors.text : MatoColors.faint,
                  size: 21,
                ),
              ),
              IconButton(
                tooltip: 'Order book',
                onPressed: () {
                  setState(() {
                    _showBook = true;
                    app.bookVisible = true;
                  });
                  app.loadBook();
                },
                icon: Icon(
                  Icons.format_list_bulleted_rounded,
                  color: _showBook ? MatoColors.text : MatoColors.faint,
                  size: 21,
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          Wrap(
            spacing: 12,
            crossAxisAlignment: WrapCrossAlignment.end,
            children: [
              Text(
                price == null ? '—' : '\$${number(price)}',
                style: const TextStyle(fontSize: 31, letterSpacing: -.8),
              ),
              Padding(
                padding: const EdgeInsets.only(bottom: 5),
                child: Text(
                  change == null
                      ? 'Live market'
                      : '${change >= 0 ? '+' : ''}${number(change)}% · ${app.range}',
                  style: TextStyle(
                    fontSize: 12,
                    color: change == null
                        ? MatoColors.muted
                        : change >= 0
                        ? MatoColors.positive
                        : MatoColors.negative,
                  ),
                ),
              ),
            ],
          ),
          if (app.errors['price'] != null)
            const Notice(
              'Live price could not be refreshed. Showing the last available data.',
              error: true,
            ),
          if (_showBook)
            _orderBook()
          else ...[
            const SizedBox(height: 16),
            if (app.loading.contains('chart') && app.candles.isEmpty)
              const SizedBox(
                height: 210,
                child: Center(child: CircularProgressIndicator(strokeWidth: 2)),
              )
            else
              PriceChart(
                points: app.candles
                    .map(
                      (p) => ChartPoint(
                        time: DateTime.fromMillisecondsSinceEpoch(
                          p.time * 1000,
                        ),
                        open: p.open,
                        high: p.high,
                        low: p.low,
                        close: p.close,
                      ),
                    )
                    .toList(),
                candles: _candles,
              ),
            if (app.errors['chart'] != null)
              Notice(
                'Price history is unavailable.',
                error: true,
                onRetry: app.loadChart,
              ),
            Row(
              children: [
                for (final range in ['1H', '1D', '1W'])
                  TextButton(
                    onPressed: () => app.setRange(range),
                    style: TextButton.styleFrom(
                      foregroundColor: app.range == range
                          ? MatoColors.text
                          : MatoColors.faint,
                      minimumSize: const Size(44, 40),
                    ),
                    child: Text(range),
                  ),
                const Spacer(),
                IconButton(
                  tooltip: _candles ? 'Show line chart' : 'Show candles',
                  onPressed: () => setState(() => _candles = !_candles),
                  icon: Icon(
                    _candles
                        ? Icons.show_chart
                        : Icons.candlestick_chart_outlined,
                    size: 20,
                  ),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }

  Widget _orderBook() {
    final rows = app.book
        .where(
          (p) =>
              !p.isPaused &&
              p.endSlot > (app.market?.currentSlot ?? 0) &&
              (_bookSide == null || p.isBuy == _bookSide),
        )
        .toList();
    return Column(
      children: [
        const SizedBox(height: 16),
        PillTabs<bool?>(
          values: const {null: 'All', true: 'Buy', false: 'Sell'},
          selected: _bookSide,
          onChanged: (value) => setState(() => _bookSide = value),
        ),
        if (app.errors['book'] != null)
          Notice(
            'Order book could not load.',
            error: true,
            onRetry: app.loadBook,
          )
        else if (app.loading.contains('book') && rows.isEmpty)
          const Padding(
            padding: EdgeInsets.all(28),
            child: CircularProgressIndicator(strokeWidth: 2),
          )
        else if (rows.isEmpty)
          const Padding(
            padding: EdgeInsets.all(26),
            child: Text(
              'No active streams on this side.',
              style: TextStyle(color: MatoColors.muted),
            ),
          )
        else
          ...rows
              .take(30)
              .map(
                (p) => Padding(
                  padding: const EdgeInsets.symmetric(vertical: 10),
                  child: Row(
                    children: [
                      SizedBox(
                        width: 42,
                        child: Text(
                          p.isBuy ? 'Buy' : 'Sell',
                          style: TextStyle(
                            color: p.isBuy
                                ? MatoColors.positive
                                : MatoColors.negative,
                            fontSize: 13,
                          ),
                        ),
                      ),
                      Expanded(
                        child: Text(
                          '${formatAmount(p.amount, p.isBuy ? 6 : 9)} ${p.isBuy ? 'USDC' : 'SOL'}',
                          style: const TextStyle(fontSize: 13),
                        ),
                      ),
                      Text(
                        durationText(
                          math.max(
                                0,
                                p.endSlot - (app.market?.currentSlot ?? 0),
                              ) *
                              .2,
                        ),
                        style: const TextStyle(
                          color: MatoColors.muted,
                          fontSize: 12,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
        if (rows.length > 30)
          Text(
            '${rows.length} active streams · showing first 30',
            style: const TextStyle(color: MatoColors.muted, fontSize: 12),
          ),
      ],
    );
  }
}

class _ImpactCurve extends CustomPainter {
  _ImpactCurve({required this.values, required this.selected});
  final List<double> values;
  final double selected;
  @override
  void paint(Canvas canvas, Size size) {
    final maxValue = math.max(.001, math.log(1 + values.reduce(math.max)));
    final path = Path();
    for (var i = 0; i < values.length; i++) {
      final x = i / (values.length - 1) * size.width;
      final y =
          size.height - math.log(1 + values[i]) / maxValue * (size.height - 10);
      if (i == 0) {
        path.moveTo(x, y);
      } else {
        path.lineTo(x, y);
      }
    }
    canvas.drawPath(
      path,
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 2
        ..color = MatoColors.orange,
    );
    canvas.drawLine(
      Offset(selected * size.width, 0),
      Offset(selected * size.width, size.height),
      Paint()..color = MatoColors.secondary.withValues(alpha: .4),
    );
  }

  @override
  bool shouldRepaint(_ImpactCurve old) => true;
}
