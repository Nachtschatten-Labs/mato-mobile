import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../domain/amounts.dart';
import '../domain/models.dart';
import '../domain/order.dart';
import '../state/app_controller.dart';
import '../wallet/wallet_service.dart';
import 'positions_panel.dart';
import 'price_chart.dart';
import 'theme.dart';
import 'trade_presentation.dart';
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
  final _amountKey = GlobalKey();
  bool _isBuy = true;
  bool _smart = true;
  bool _candles = false;
  bool _showBook = false;
  bool _details = false;
  bool _inverse = false;
  bool _showPercentages = false;
  bool? _bookSide;
  double _seconds = 5;
  String _bookSort = 'endSlot';
  bool _bookAscending = true;
  int _chartReset = 0;
  bool _favorite = false;
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
  TradeQuote quoteAt(int? duration) => TradeQuote.calculate(
    amount: atoms,
    isBuy: _isBuy,
    durationSlots: duration,
    market: app.market,
  );
  String get durationLabel => slots == null
      ? 'Choose duration'
      : orderDuration(slots! * .2, custom: !_smart);

  @override
  void initState() {
    super.initState();
    SharedPreferences.getInstance()
        .then((preferences) {
          if (mounted) {
            setState(
              () =>
                  _favorite = preferences.getBool('mato.favorite.sol') ?? false,
            );
          }
        })
        .catchError((Object _) {});
  }

  @override
  void dispose() {
    _amount.dispose();
    _amountFocus.dispose();
    super.dispose();
  }

  void setPercent(double percent) {
    if (available == null) return;
    final amount = atomsFromPercent(available!, percent);
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
            Detail('Duration', exactTradeDuration(reviewedSlots * .2)),
            Detail(
              'Estimated price impact',
              reviewedImpact == null
                  ? 'Unavailable'
                  : '${number(reviewedImpact, 4)}%',
            ),
            Detail('Wallet', shortAddress(reviewedOwner)),
            const Notice(
              'Your stream trades in small pieces over time. The price and final amount received can change. You can pause or close the stream.',
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
      setState(_amount.clear);
      HapticFeedback.mediumImpact();
      showMatoToast(
        context,
        title: 'Stream started',
        description: 'The transaction was confirmed.',
        signature: sig,
      );
    } catch (e) {
      if (mounted) {
        final declined = e is WalletException && e.isCancellation;
        setState(() => _error = declined ? null : errorText(e));
        showMatoToast(
          context,
          title: declined ? 'Request declined' : 'Stream failed',
          description: declined ? 'Your stream was not started.' : errorText(e),
          error: true,
        );
      }
    }
  }

  Future<void> customize() async {
    _amountFocus.unfocus();
    final recommended = recommendDurationSlots(
      amountAtoms: atoms,
      isBuy: _isBuy,
      streamingState: app.market,
    );
    final pick = recommended == null ? null : recommended * .2;
    var seconds = slots == null ? _seconds : slots! * .2;
    var inverse = false;
    final steps = tradeDurationSteps(seconds, pick);
    final result = await showMatoSheet<double>(
      context,
      title: 'Customize duration',
      child: StatefulBuilder(
        builder: (context, setSheet) {
          final draftSlots = durationToSlots(seconds);
          final quote = quoteAt(draftSlots);
          final impact = signedTradeImpact(
            quote.impact,
            _isBuy,
            inverse: inverse,
          );
          final exceedsAmount =
              atoms != null &&
              app.market != null &&
              atoms! < BigInt.from(draftSlots + app.market!.interval ~/ 2);
          double? displayRate(double? value) => value == null || value <= 0
              ? null
              : inverse
              ? 1 / value
              : value;
          return Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const SizedBox(height: 8),
              Text(
                exactTradeDuration(seconds),
                textAlign: TextAlign.center,
                style: const TextStyle(fontSize: 32, letterSpacing: -.8),
              ),
              const SizedBox(height: 4),
              Text(
                '${impactLabel(impact)} impact',
                textAlign: TextAlign.center,
                style: TextStyle(color: _impactColor(impact), fontSize: 14),
              ),
              const SizedBox(height: 20),
              LayoutBuilder(
                builder: (context, constraints) {
                  void select(Offset at) => setSheet(() {
                    seconds = durationAtFraction(
                      ((at.dx - 8) / math.max(1, constraints.maxWidth - 16))
                          .clamp(0, 1),
                      steps,
                    );
                  });
                  return Semantics(
                    label: 'Duration and price impact',
                    value:
                        '${exactTradeDuration(seconds)}, ${impactLabel(impact)} impact',
                    increasedValue: exactTradeDuration(
                      steps[(steps.indexOf(seconds) + 1).clamp(
                        0,
                        steps.length - 1,
                      )],
                    ),
                    decreasedValue: exactTradeDuration(
                      steps[(steps.indexOf(seconds) - 1).clamp(
                        0,
                        steps.length - 1,
                      )],
                    ),
                    onIncrease: () => setSheet(
                      () => seconds =
                          steps[(steps.indexOf(seconds) + 1).clamp(
                            0,
                            steps.length - 1,
                          )],
                    ),
                    onDecrease: () => setSheet(
                      () => seconds =
                          steps[(steps.indexOf(seconds) - 1).clamp(
                            0,
                            steps.length - 1,
                          )],
                    ),
                    child: GestureDetector(
                      onTapDown: (event) => select(event.localPosition),
                      onHorizontalDragUpdate: (event) =>
                          select(event.localPosition),
                      child: SizedBox(
                        height: 155,
                        width: double.infinity,
                        child: CustomPaint(
                          painter: _ImpactCurve(
                            values: List.generate(
                              100,
                              (i) =>
                                  quoteAt(
                                    durationToSlots(
                                      5 *
                                          math.pow(
                                            maxOrderDurationSeconds / 5,
                                            i / 99,
                                          ),
                                    ),
                                  ).impact ??
                                  0,
                            ),
                            selected: durationFraction(seconds),
                            recommended: pick == null
                                ? null
                                : durationFraction(pick),
                          ),
                        ),
                      ),
                    ),
                  );
                },
              ),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 4),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    for (final label in ['5s', '1m', '1h', '1d', '1yr'])
                      Text(
                        label,
                        style: const TextStyle(
                          fontSize: 10,
                          color: MatoColors.faint,
                        ),
                      ),
                  ],
                ),
              ),
              const SizedBox(height: 20),
              Text(
                impact == null
                    ? 'Price impact is unavailable with current liquidity.'
                    : 'Estimate from liquidity right now. Price can move while the stream runs.',
                textAlign: TextAlign.center,
                style: const TextStyle(
                  color: MatoColors.muted,
                  fontSize: 13,
                  height: 1.5,
                ),
              ),
              const SizedBox(height: 18),
              Container(
                padding: const EdgeInsets.all(16),
                decoration: _blockDecoration(),
                child: Column(
                  children: [
                    Detail(
                      'Price now',
                      tradeNumber(
                        displayRate(app.market?.price),
                        inverse ? 6 : 4,
                      ),
                    ),
                    Detail(
                      'Est. price',
                      exceedsAmount
                          ? '—'
                          : '${tradeNumber(displayRate(quote.executionPrice), inverse ? 6 : 4)} (${impactLabel(impact)})',
                      color: _impactColor(impact),
                    ),
                    Row(
                      children: [
                        const Expanded(
                          child: Text(
                            'Including price impact',
                            style: TextStyle(
                              color: MatoColors.muted,
                              fontSize: 11,
                            ),
                          ),
                        ),
                        Text(
                          inverse ? 'SOL per USDC' : 'USDC per SOL',
                          style: const TextStyle(
                            color: MatoColors.muted,
                            fontSize: 11,
                          ),
                        ),
                        _iconButton(
                          'Flip price',
                          Icons.swap_horiz_rounded,
                          () => setSheet(() => inverse = !inverse),
                        ),
                      ],
                    ),
                    Detail(
                      _isBuy ? 'Buy with' : 'Sell',
                      '${formatAmount(atoms, decimals)} ${_isBuy ? 'USDC' : 'SOL'}',
                    ),
                    const Divider(height: 20),
                    Detail(
                      'Est. receive',
                      '${exceedsAmount || quote.netReceive == null ? '—' : '~${tradeNumber(quote.netReceive, 6)}'} ${_isBuy ? 'SOL' : 'USDC'}',
                    ),
                  ],
                ),
              ),
              if (exceedsAmount)
                const Notice(
                  'This amount is too small for this duration. Choose a shorter duration or increase the amount.',
                  error: true,
                ),
              const SizedBox(height: 20),
              _primaryButton(
                'Use ${exactTradeDuration(seconds)}',
                exceedsAmount ? null : () => Navigator.pop(context, seconds),
              ),
              if (pick != null && seconds != pick)
                TextButton(
                  onPressed: () => setSheet(() => seconds = pick),
                  child: Text(
                    'Reset to ${exactTradeDuration(pick)} (${impactLabel(signedTradeImpact(quoteAt(recommended).impact, _isBuy, inverse: inverse))})',
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      fontSize: 13,
                      decoration: TextDecoration.underline,
                    ),
                  ),
                ),
            ],
          );
        },
      ),
    );
    if (result == null || !mounted) return;
    setState(() {
      _smart = result == pick;
      _seconds = result;
    });
  }

  Color _impactColor(double? impact) => impact == null
      ? MatoColors.muted
      : impact.abs() > 1
      ? MatoColors.negative
      : impact.abs() < .01
      ? MatoColors.positive
      : MatoColors.secondary;

  BoxDecoration _blockDecoration({bool sunk = false, bool error = false}) =>
      BoxDecoration(
        color: sunk ? MatoColors.background : MatoColors.elevated,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
          color: error ? MatoColors.negative : MatoColors.border,
        ),
      );

  Widget _primaryButton(
    String label,
    VoidCallback? onPressed, {
    bool busy = false,
  }) => SizedBox(
    width: double.infinity,
    height: 48,
    child: FilledButton(
      onPressed: busy ? null : onPressed,
      style: FilledButton.styleFrom(
        shape: const StadiumBorder(),
        textStyle: const TextStyle(
          fontFamily: 'IBMPlexSans',
          fontSize: 14,
          fontWeight: FontWeight.w500,
        ),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          if (busy) ...[
            const SizedBox(
              width: 14,
              height: 14,
              child: CircularProgressIndicator(strokeWidth: 2),
            ),
            const SizedBox(width: 8),
          ],
          Flexible(child: Text(label, textAlign: TextAlign.center)),
        ],
      ),
    ),
  );

  Widget _chip(
    String label,
    VoidCallback? onPressed, {
    bool selected = false,
    IconData? icon,
    String? tooltip,
    double height = 30,
    double horizontalPadding = 12,
  }) {
    final child = TextButton(
      onPressed: onPressed,
      style: TextButton.styleFrom(
        minimumSize: Size(0, height),
        tapTargetSize: MaterialTapTargetSize.shrinkWrap,
        padding: EdgeInsets.symmetric(horizontal: horizontalPadding),
        shape: const StadiumBorder(),
        foregroundColor: selected ? MatoColors.text : MatoColors.muted,
        backgroundColor: selected ? MatoColors.elevated : Colors.transparent,
        textStyle: const TextStyle(
          fontFamily: 'IBMPlexSans',
          fontSize: 12,
          fontWeight: FontWeight.w400,
        ),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (icon != null) ...[Icon(icon, size: 14), const SizedBox(width: 6)],
          Flexible(child: Text(label)),
        ],
      ),
    );
    return Semantics(
      selected: selected,
      child: tooltip == null ? child : Tooltip(message: tooltip, child: child),
    );
  }

  Widget _iconButton(
    String label,
    IconData icon,
    VoidCallback onPressed, {
    bool selected = false,
  }) => IconButton(
    tooltip: label,
    onPressed: onPressed,
    constraints: const BoxConstraints.tightFor(width: 30, height: 30),
    padding: EdgeInsets.zero,
    style: IconButton.styleFrom(
      backgroundColor: selected ? MatoColors.elevated : Colors.transparent,
    ),
    icon: Icon(
      icon,
      size: 15,
      color: selected ? MatoColors.text : MatoColors.muted,
    ),
  );

  @override
  Widget build(BuildContext context) {
    final hasAmount = atoms != null && atoms! > BigInt.zero;
    final quote = quoteAt(slots);
    final validation = validateOrder(
      amountAtoms: atoms,
      isBuy: _isBuy,
      durationSlots: slots,
      streamingState: app.market,
      balances: app.balances,
      walletConnected: app.wallet.isConnected,
      transactionsEnabled: app.config.transactionsEnabled,
    );
    final minimum = _isBuy
        ? app.market?.minimumQuoteDepositAtoms ??
              MarketDefinition.sol.minimumQuoteDepositAtoms
        : app.market?.minimumBaseDepositAtoms ??
              MarketDefinition.sol.minimumBaseDepositAtoms;
    final belowMinimum = hasAmount && atoms! < minimum;
    final exceedsBalance =
        hasAmount && available != null && atoms! > available!;
    final insufficientSol =
        app.wallet.isConnected &&
        app.balances != null &&
        app.balances!.lamports < nativeFeeBufferAtoms;
    final amountError = exceedsBalance
        ? 'Amount exceeds available balance.'
        : belowMinimum
        ? 'Minimum ${formatAmount(minimum, decimals)} ${_isBuy ? 'USDC' : 'SOL'}'
        : _amount.text.isNotEmpty && atoms == null
        ? 'Enter a valid ${_isBuy ? 'USDC' : 'SOL'} amount.'
        : null;
    final button = !app.wallet.isSupported
        ? 'Open on Android to connect'
        : !app.wallet.isConnected
        ? 'Connect wallet to stream'
        : app.wallet.isBusy
        ? 'Approve in wallet'
        : app.transactionBusy
        ? 'Starting the stream'
        : exceedsBalance
        ? 'Amount exceeds balance'
        : belowMinimum
        ? 'Amount too small'
        : app.market == null
        ? app.errors.containsKey('market')
              ? 'Market unavailable'
              : 'Loading market...'
        : app.market!.isPaused
        ? 'Market paused'
        : insufficientSol
        ? 'Not enough SOL'
        : !hasAmount
        ? 'Enter an amount'
        : slots == null
        ? 'Smart fill unavailable'
        : validation == 'Amount is too small for this duration.'
        ? 'Choose a shorter duration'
        : (quote.impact ?? 0) > 1
        ? 'Review price impact'
        : validation != null
        ? 'Review unavailable'
        : '${_isBuy ? 'Buy' : 'Sell'} over the next $durationLabel';
    return RefreshIndicator(
      onRefresh: () => app.refresh(forceChart: true),
      child: ListView(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 48),
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
                        Container(
                          padding: const EdgeInsets.all(4),
                          decoration: BoxDecoration(
                            color: MatoColors.background,
                            borderRadius: BorderRadius.circular(100),
                            border: Border.all(color: MatoColors.border),
                          ),
                          child: Row(
                            children: [
                              for (final isBuy in [true, false])
                                Expanded(
                                  child: Semantics(
                                    selected: _isBuy == isBuy,
                                    child: TextButton(
                                      onPressed: () {
                                        if (_isBuy == isBuy) return;
                                        setState(() {
                                          _isBuy = isBuy;
                                          _amount.clear();
                                          _smart = true;
                                          _error = null;
                                        });
                                      },
                                      style: TextButton.styleFrom(
                                        minimumSize: const Size(0, 36),
                                        tapTargetSize:
                                            MaterialTapTargetSize.shrinkWrap,
                                        shape: const StadiumBorder(),
                                        backgroundColor: _isBuy == isBuy
                                            ? MatoColors.elevated
                                            : Colors.transparent,
                                        foregroundColor: _isBuy == isBuy
                                            ? MatoColors.text
                                            : MatoColors.muted,
                                        textStyle: const TextStyle(
                                          fontFamily: 'IBMPlexSans',
                                          fontSize: 14,
                                          fontWeight: FontWeight.w400,
                                        ),
                                      ),
                                      child: Text(isBuy ? 'Buy' : 'Sell'),
                                    ),
                                  ),
                                ),
                            ],
                          ),
                        ),
                        const SizedBox(height: 24),
                        _amountBox(amountError, minimum),
                        _durationRow(hasAmount),
                        _receiveBox(quote, hasAmount),
                        _costDetails(quote, hasAmount),
                        if ((quote.impact ?? 0) > 1)
                          const Notice(
                            'Price impact is above 1%. Review the execution price before submitting.',
                            error: true,
                          ),
                        if (insufficientSol)
                          Container(
                            padding: const EdgeInsets.all(14),
                            margin: const EdgeInsets.only(bottom: 16),
                            decoration: BoxDecoration(
                              color: MatoColors.caution.withValues(alpha: .08),
                              borderRadius: BorderRadius.circular(12),
                              border: Border.all(
                                color: MatoColors.caution.withValues(alpha: .2),
                              ),
                            ),
                            child: Row(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                const Icon(
                                  Icons.warning_amber_rounded,
                                  color: MatoColors.caution,
                                  size: 18,
                                ),
                                const SizedBox(width: 12),
                                Expanded(
                                  child: Column(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.start,
                                    children: [
                                      const Text(
                                        'Add SOL for network fees',
                                        style: TextStyle(
                                          fontSize: 14,
                                          fontWeight: FontWeight.w500,
                                        ),
                                      ),
                                      const SizedBox(height: 3),
                                      Text(
                                        'Your wallet has ${formatAmount(app.balances!.lamports, 9)} SOL. Keep at least 0.02 SOL for network fees and account rent.',
                                        style: const TextStyle(
                                          color: MatoColors.secondary,
                                          fontSize: 13,
                                          height: 1.5,
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                              ],
                            ),
                          ),
                        if (app.wallet.isConnected &&
                            hasAmount &&
                            validation != null &&
                            !insufficientSol &&
                            amountError == null)
                          Notice(validation),
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
                        _primaryButton(
                          button,
                          app.wallet.isSupported &&
                                  (!app.wallet.isConnected ||
                                      (validation == null &&
                                          app.marketFresh &&
                                          !app.errors.containsKey('balances')))
                              ? review
                              : null,
                          busy: app.transactionBusy || app.wallet.isBusy,
                        ),
                        const SizedBox(height: 16),
                        const Text(
                          'Estimate from liquidity right now. Price can move while the stream runs.',
                          textAlign: TextAlign.center,
                          style: TextStyle(
                            fontSize: 11,
                            height: 1.8,
                            color: MatoColors.muted,
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 32),
                  _marketPanel(),
                  const SizedBox(height: 32),
                  PositionsPanel(
                    app: app,
                    onStart: () {
                      final amountContext = _amountKey.currentContext;
                      if (amountContext != null) {
                        Scrollable.ensureVisible(
                          amountContext,
                          duration: const Duration(milliseconds: 200),
                        );
                      }
                      _amountFocus.requestFocus();
                    },
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _amountBox(String? error, BigInt minimum) {
    final input = _isBuy ? 'USDC' : 'SOL';
    final percent = toSliderPercent(atoms, available);
    return ListenableBuilder(
      listenable: _amountFocus,
      builder: (context, _) => Container(
        key: _amountKey,
        padding: const EdgeInsets.all(16),
        decoration: _blockDecoration(sunk: true, error: error != null).copyWith(
          border: Border.all(
            color: error != null
                ? MatoColors.negative
                : _amountFocus.hasFocus
                ? MatoColors.muted
                : MatoColors.border,
          ),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Wrap(
              alignment: WrapAlignment.spaceBetween,
              crossAxisAlignment: WrapCrossAlignment.center,
              spacing: 8,
              runSpacing: 6,
              children: [
                const Text('You pay', style: TextStyle(fontSize: 14)),
                Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Flexible(
                      child: Text(
                        'Balance ${app.wallet.isConnected ? formatAmount(available, decimals, precision: 4) : '0'}',
                        style: const TextStyle(
                          fontSize: 12,
                          color: MatoColors.muted,
                        ),
                      ),
                    ),
                    const SizedBox(width: 6),
                    Semantics(
                      label: 'Use maximum balance',
                      child: _chip(
                        'Max',
                        available == null ? null : () => setPercent(100),
                        selected: true,
                        height: 24,
                        horizontalPadding: 6,
                      ),
                    ),
                    Semantics(
                      label: 'Choose balance percentage',
                      expanded: _showPercentages,
                      child: _chip(
                        '%',
                        () => setState(
                          () => _showPercentages = !_showPercentages,
                        ),
                        selected: _showPercentages,
                        height: 24,
                        horizontalPadding: 6,
                      ),
                    ),
                  ],
                ),
              ],
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _amount,
                    focusNode: _amountFocus,
                    keyboardType: const TextInputType.numberWithOptions(
                      decimal: true,
                    ),
                    inputFormatters: [
                      TextInputFormatter.withFunction((old, next) {
                        // Never silently transform a pasted grouped/negative amount into a different order.
                        if (!RegExp(r'^\d*(\.\d*)?$').hasMatch(next.text)) {
                          return old;
                        }
                        return next;
                      }),
                    ],
                    style: TextStyle(
                      fontSize: 32,
                      letterSpacing: -.8,
                      fontWeight: FontWeight.w400,
                      color: error == null
                          ? MatoColors.text
                          : MatoColors.negative,
                    ),
                    decoration: const InputDecoration(
                      hintText: '0.00',
                      isDense: true,
                      contentPadding: EdgeInsets.symmetric(vertical: 4),
                      border: InputBorder.none,
                      enabledBorder: InputBorder.none,
                      focusedBorder: InputBorder.none,
                    ),
                    onChanged: (_) => setState(() => _error = null),
                  ),
                ),
                const SizedBox(width: 12),
                TokenBadge(input),
                const SizedBox(width: 8),
                Text(input, style: const TextStyle(fontSize: 16)),
              ],
            ),
            const SizedBox(height: 4),
            Text(
              error ?? 'Minimum ${formatAmount(minimum, decimals)} $input',
              style: TextStyle(
                fontSize: 12,
                height: 1.6,
                color: error == null ? MatoColors.muted : MatoColors.negative,
              ),
            ),
            if (_showPercentages) ...[
              const Divider(height: 32),
              Row(
                children: [
                  const Expanded(
                    child: Text(
                      'Use available balance',
                      style: TextStyle(fontSize: 12, color: MatoColors.muted),
                    ),
                  ),
                  Text(
                    '${percent.toStringAsFixed(1)}%',
                    style: const TextStyle(
                      fontSize: 12,
                      color: MatoColors.muted,
                    ),
                  ),
                ],
              ),
              Slider(
                value: percent,
                max: 100,
                divisions: 1000,
                label: '${percent.toStringAsFixed(1)}%',
                onChanged: available == null ? null : setPercent,
              ),
              Row(
                children: [
                  for (final value in [25, 50, 75, 100])
                    Expanded(
                      child: Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 2),
                        child: _chip(
                          '$value%',
                          available == null
                              ? null
                              : () => setPercent(value.toDouble()),
                          selected: (percent - value).abs() < .5,
                        ),
                      ),
                    ),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _durationRow(bool hasAmount) => Padding(
    padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 20),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (!hasAmount)
          Row(
            children: [
              const Text(
                'Smart fill',
                style: TextStyle(color: MatoColors.muted, fontSize: 14),
              ),
              const SizedBox(width: 6),
              Tooltip(
                message:
                    'Your ${_isBuy ? 'buy' : 'sell'} streams continuously over time instead of filling all at once.',
                triggerMode: TooltipTriggerMode.tap,
                child: const Icon(
                  Icons.info_outline_rounded,
                  size: 14,
                  color: MatoColors.faint,
                ),
              ),
            ],
          )
        else ...[
          Wrap(
            spacing: 8,
            runSpacing: 6,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              if (slots != null)
                const Text(
                  'Over the next',
                  style: TextStyle(color: MatoColors.muted, fontSize: 14),
                ),
              Semantics(
                label: 'Customize duration: $durationLabel',
                button: true,
                child: _chip(
                  durationLabel,
                  customize,
                  selected: true,
                  icon: Icons.tune_rounded,
                  height: 28,
                ),
              ),
            ],
          ),
          if (slots != null) ...[
            const SizedBox(height: 8),
            Text(
              streamFinishTime(slots! * .2),
              style: const TextStyle(fontSize: 12, color: MatoColors.muted),
            ),
          ],
        ],
      ],
    ),
  );

  Widget _receiveBox(TradeQuote quote, bool hasAmount) {
    final output = _isBuy ? 'SOL' : 'USDC';
    final balance = _isBuy ? app.balances?.totalSol : app.balances?.usdc;
    return Container(
      constraints: const BoxConstraints(minHeight: 140),
      padding: const EdgeInsets.all(16),
      decoration: _blockDecoration(),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Wrap(
            alignment: WrapAlignment.spaceBetween,
            spacing: 8,
            runSpacing: 4,
            children: [
              const Text(
                'Est. receive',
                style: TextStyle(color: MatoColors.muted, fontSize: 14),
              ),
              Text(
                'Balance ${app.wallet.isConnected ? formatAmount(balance, _isBuy ? 9 : 6, precision: 4) : '0'}',
                style: const TextStyle(color: MatoColors.muted, fontSize: 12),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: Text(
                  !hasAmount
                      ? '0'
                      : quote.netReceive == null
                      ? '—'
                      : '~${tradeNumber(quote.netReceive, 6)}',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 32,
                    height: 1.5,
                    letterSpacing: -.8,
                  ),
                ),
              ),
              const SizedBox(width: 12),
              TokenBadge(output),
              const SizedBox(width: 8),
              Text(output, style: const TextStyle(fontSize: 16)),
            ],
          ),
        ],
      ),
    );
  }

  Widget _costDetails(TradeQuote quote, bool hasAmount) {
    final impact = signedTradeImpact(quote.impact, _isBuy);
    final output = _isBuy ? 'SOL' : 'USDC';
    String cost(double? value) =>
        '${value == null ? '' : '≈'}${tradeNumber(value, _isBuy ? 6 : 2)} $output';
    final fee = quote.feePercent == null
        ? '—'
        : '${tradeNumber(quote.feePercent, 2)}%';
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            '1 SOL ≈ ${tradeNumber(app.market?.price, 4)} USDC',
            style: const TextStyle(fontSize: 14, color: MatoColors.muted),
          ),
          if (hasAmount) ...[
            const SizedBox(height: 8),
            Semantics(
              label: 'Price impact and fee details',
              expanded: _details,
              button: true,
              child: InkWell(
                borderRadius: BorderRadius.circular(4),
                onTap: () => setState(() => _details = !_details),
                child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 3),
                  child: Wrap(
                    spacing: 4,
                    crossAxisAlignment: WrapCrossAlignment.center,
                    children: [
                      const Text(
                        'Impact',
                        style: TextStyle(fontSize: 14, color: MatoColors.muted),
                      ),
                      Text(
                        impactLabel(impact),
                        style: TextStyle(
                          fontSize: 14,
                          color: (impact?.abs() ?? 0) > 1
                              ? MatoColors.negative
                              : MatoColors.text,
                        ),
                      ),
                      const Text(
                        '· Fee',
                        style: TextStyle(fontSize: 14, color: MatoColors.muted),
                      ),
                      Text(fee, style: const TextStyle(fontSize: 14)),
                      Icon(
                        _details
                            ? Icons.keyboard_arrow_up
                            : Icons.keyboard_arrow_down,
                        size: 16,
                        color: MatoColors.muted,
                      ),
                    ],
                  ),
                ),
              ),
            ),
            if (_details) ...[
              const SizedBox(height: 12),
              Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 14,
                  vertical: 10,
                ),
                decoration: _blockDecoration(),
                child: Column(
                  children: [
                    InkWell(
                      onTap: () => setState(() => _inverse = !_inverse),
                      child: Detail(
                        'Estimated Rate ⇄',
                        _inverse
                            ? '1 USDC ≈ ${tradeNumber(quote.executionPrice == null ? null : 1 / quote.executionPrice!, 6)} SOL'
                            : '1 SOL ≈ ${tradeNumber(quote.executionPrice, 4)} USDC',
                      ),
                    ),
                    Detail(
                      'Price impact',
                      '${impactLabel(impact)} · ${cost(quote.impactCost)}',
                      color: (impact?.abs() ?? 0) > 1
                          ? MatoColors.negative
                          : null,
                    ),
                    Detail('Fee', '$fee · ${cost(quote.feeAmount)}'),
                    Text(
                      'The fee is deducted from the $output you receive and is already included in Est. receive.',
                      style: const TextStyle(
                        fontSize: 11,
                        height: 1.5,
                        color: MatoColors.muted,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ],
        ],
      ),
    );
  }

  Widget _marketPanel() {
    final price = app.currentPrice;
    return Panel(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Wrap(
            spacing: 12,
            runSpacing: 16,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              TextButton(
                onPressed: app.transactionBusy ? null : _markets,
                style: TextButton.styleFrom(
                  backgroundColor: MatoColors.elevated,
                  shape: const StadiumBorder(),
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  minimumSize: const Size(0, 48),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    _pairLogos(),
                    const SizedBox(width: 12),
                    const Flexible(
                      child: Text(
                        'SOL / USDC',
                        style: TextStyle(
                          fontSize: 17,
                          letterSpacing: -.4,
                          fontWeight: FontWeight.w400,
                        ),
                      ),
                    ),
                    const SizedBox(width: 10),
                    const Icon(
                      Icons.keyboard_arrow_down,
                      size: 16,
                      color: MatoColors.muted,
                    ),
                  ],
                ),
              ),
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'SOL/USDC',
                    style: TextStyle(fontSize: 10, color: MatoColors.muted),
                  ),
                  const SizedBox(height: 4),
                  Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        price == null ? '—' : '\$${tradeNumber(price, 2)}',
                        style: const TextStyle(fontSize: 14),
                      ),
                      const SizedBox(width: 12),
                      const Text(
                        '24h —',
                        style: TextStyle(fontSize: 12, color: MatoColors.muted),
                      ),
                    ],
                  ),
                ],
              ),
              if (!_showBook)
                Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    for (final range in ['1H', '1D', '1W'])
                      _chip(
                        range,
                        () => app.setRange(range),
                        selected: app.range == range,
                        height: 32,
                      ),
                  ],
                ),
            ],
          ),
          const SizedBox(height: 20),
          if (app.errors['price'] != null)
            const Notice(
              'Live price could not be refreshed. Showing the last available data.',
              error: true,
            ),
          if (_showBook)
            _orderBook()
          else ...[
            Container(
              decoration: _blockDecoration(
                sunk: true,
              ).copyWith(borderRadius: BorderRadius.circular(8)),
              clipBehavior: Clip.antiAlias,
              child: app.loading.contains('chart') && app.candles.isEmpty
                  ? const SizedBox(
                      height: 300,
                      child: Center(
                        child: Text(
                          'Loading market history…',
                          style: TextStyle(
                            color: MatoColors.muted,
                            fontSize: 13,
                          ),
                        ),
                      ),
                    )
                  : PriceChart(
                      height: 300,
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
                      resetSignal: _chartReset,
                    ),
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                const Expanded(
                  child: Text(
                    'SOL/USDC',
                    style: TextStyle(fontSize: 11, color: MatoColors.muted),
                  ),
                ),
                _iconButton(
                  'Candles',
                  Icons.candlestick_chart_outlined,
                  () => setState(() => _candles = true),
                  selected: _candles,
                ),
                _iconButton(
                  'Line',
                  Icons.show_chart,
                  () => setState(() => _candles = false),
                  selected: !_candles,
                ),
                _iconButton(
                  'Reset chart',
                  Icons.refresh_rounded,
                  () => setState(() => _chartReset++),
                ),
              ],
            ),
            if (app.errors['chart'] != null)
              Notice(
                'Price history is unavailable.',
                error: true,
                onRetry: app.loadChart,
              ),
          ],
          const Divider(height: 32),
          Wrap(
            spacing: 4,
            runSpacing: 4,
            children: [
              _chip(
                'Chart',
                () => setState(() {
                  _showBook = false;
                  app.bookVisible = false;
                }),
                selected: !_showBook,
                icon: Icons.candlestick_chart_outlined,
              ),
              _chip(
                'Order book',
                () {
                  setState(() {
                    _showBook = true;
                    app.bookVisible = true;
                  });
                  app.loadBook();
                },
                selected: _showBook,
                icon: Icons.list_rounded,
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _pairLogos() => const SizedBox(
    width: 40,
    height: 24,
    child: Stack(
      children: [
        Positioned(right: 0, child: TokenBadge('USDC')),
        Positioned(left: 0, child: TokenBadge('SOL')),
      ],
    ),
  );

  Future<void> _markets() async {
    var query = '';
    var tab = 'All';
    await showMatoSheet<void>(
      context,
      title: 'Markets',
      child: StatefulBuilder(
        builder: (context, setSheet) {
          final matches =
              'sol usdc solana'.contains(query.toLowerCase().trim()) &&
              tab != 'Equities' &&
              (tab != 'Favorites' || _favorite);
          return Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Text(
                'Choose a market to start streaming.',
                style: TextStyle(color: MatoColors.muted, fontSize: 13),
              ),
              const SizedBox(height: 20),
              Container(
                decoration: _blockDecoration(sunk: true),
                padding: const EdgeInsets.symmetric(horizontal: 12),
                child: TextField(
                  decoration: const InputDecoration(
                    hintText: 'Search markets',
                    prefixIcon: Icon(Icons.search, size: 18),
                    border: InputBorder.none,
                  ),
                  onChanged: (value) => setSheet(() => query = value),
                ),
              ),
              const SizedBox(height: 16),
              Wrap(
                spacing: 4,
                children: [
                  for (final name in ['Favorites', 'All', 'Crypto', 'Equities'])
                    _chip(
                      name,
                      () => setSheet(() => tab = name),
                      selected: tab == name,
                    ),
                ],
              ),
              const SizedBox(height: 20),
              const Row(
                children: [
                  Expanded(
                    child: Text(
                      'Market',
                      style: TextStyle(color: MatoColors.muted, fontSize: 12),
                    ),
                  ),
                  Text(
                    'Price',
                    style: TextStyle(color: MatoColors.muted, fontSize: 12),
                  ),
                ],
              ),
              const Divider(height: 24),
              if (matches)
                Row(
                  children: [
                    IconButton(
                      tooltip: _favorite
                          ? 'Remove SOL from favorites'
                          : 'Add SOL to favorites',
                      onPressed: () async {
                        setSheet(() => _favorite = !_favorite);
                        final preferences =
                            await SharedPreferences.getInstance();
                        await preferences.setBool(
                          'mato.favorite.sol',
                          _favorite,
                        );
                      },
                      icon: Icon(
                        _favorite
                            ? Icons.star_rounded
                            : Icons.star_border_rounded,
                        size: 20,
                        color: _favorite ? MatoColors.accent : MatoColors.muted,
                      ),
                    ),
                    Expanded(
                      child: InkWell(
                        onTap: () => Navigator.pop(context),
                        child: Padding(
                          padding: const EdgeInsets.symmetric(vertical: 12),
                          child: Row(
                            children: [
                              _pairLogos(),
                              const SizedBox(width: 10),
                              const Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      'SOL / USDC',
                                      style: TextStyle(fontSize: 14),
                                    ),
                                    SizedBox(height: 3),
                                    Text(
                                      'Solana',
                                      style: TextStyle(
                                        fontSize: 12,
                                        color: MatoColors.muted,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                              Text(
                                app.currentPrice == null
                                    ? '—'
                                    : '\$${tradeNumber(app.currentPrice, 6)}',
                                style: const TextStyle(fontSize: 13),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ),
                  ],
                )
              else
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 34),
                  child: Column(
                    children: [
                      Text(
                        query.isNotEmpty
                            ? 'No markets match “$query”.'
                            : tab == 'Favorites'
                            ? 'No favorites yet.'
                            : 'No markets in this category yet.',
                        textAlign: TextAlign.center,
                        style: const TextStyle(
                          color: MatoColors.muted,
                          fontSize: 13,
                        ),
                      ),
                      if (tab != 'All')
                        TextButton(
                          onPressed: () => setSheet(() => tab = 'All'),
                          child: const Text('Browse all markets'),
                        ),
                    ],
                  ),
                ),
              const Divider(height: 24),
              Text(
                'Market prices in USDC. 24h statistics are not available yet.\n${matches ? '1' : '0'} of 1',
                style: const TextStyle(
                  color: MatoColors.muted,
                  fontSize: 10,
                  height: 1.8,
                ),
              ),
            ],
          );
        },
      ),
    );
  }

  Widget _orderBook() {
    final active = app.book
        .where(
          (p) => !p.isPaused && p.endSlot >= (app.market?.currentSlot ?? 0),
        )
        .toList();
    final rows = active
        .where((p) => _bookSide == null || p.isBuy == _bookSide)
        .toList();
    BigInt value(PositionRecord p, String key) => switch (key) {
      'size' => p.amount,
      'flow' =>
        p.amount ~/
            BigInt.from(math.max(1, p.endSlot - intValue(p.data['startSlot']))),
      'startSlot' => BigInt.from(intValue(p.data['startSlot'])),
      'direction' => BigInt.from(p.isBuy ? 0 : 1),
      _ => BigInt.from(p.endSlot),
    };
    rows.sort(
      (a, b) =>
          value(a, _bookSort).compareTo(value(b, _bookSort)) *
          (_bookAscending ? 1 : -1),
    );
    final columns = [
      ('Direction', 'direction'),
      ('Position', ''),
      ('Size', 'size'),
      ('Flow', 'flow'),
      ('Start slot', 'startSlot'),
      ('End slot', 'endSlot'),
    ];
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            for (final side in <bool?>[null, true, false])
              Padding(
                padding: const EdgeInsets.only(right: 8),
                child: _chip(
                  side == null
                      ? 'All'
                      : side
                      ? 'Buy'
                      : 'Sell',
                  () => setState(() => _bookSide = side),
                  selected: _bookSide == side,
                ),
              ),
          ],
        ),
        const SizedBox(height: 12),
        Container(
          decoration: _blockDecoration(
            sunk: true,
          ).copyWith(borderRadius: BorderRadius.circular(8)),
          clipBehavior: Clip.antiAlias,
          constraints: const BoxConstraints(minHeight: 300, maxHeight: 420),
          child: app.errors['book'] != null
              ? Notice(
                  'Order book could not load.',
                  error: true,
                  onRetry: app.loadBook,
                )
              : rows.isEmpty
              ? Center(
                  child: Padding(
                    padding: const EdgeInsets.all(24),
                    child: Text(
                      app.loading.contains('book')
                          ? 'Loading active orders...'
                          : active.isEmpty
                          ? 'No active orders are open for this market.'
                          : 'No active orders match the selected direction.',
                      textAlign: TextAlign.center,
                      style: const TextStyle(
                        color: MatoColors.muted,
                        fontSize: 13,
                      ),
                    ),
                  ),
                )
              : SingleChildScrollView(
                  scrollDirection: Axis.horizontal,
                  child: SizedBox(
                    width: 780,
                    child: SingleChildScrollView(
                      child: DataTable(
                        headingRowColor: const WidgetStatePropertyAll(
                          MatoColors.elevated,
                        ),
                        horizontalMargin: 16,
                        columnSpacing: 24,
                        dataRowMinHeight: 48,
                        dataRowMaxHeight: 52,
                        headingRowHeight: 44,
                        sortColumnIndex: columns.indexWhere(
                          (column) => column.$2 == _bookSort,
                        ),
                        sortAscending: _bookAscending,
                        headingTextStyle: const TextStyle(
                          fontFamily: 'IBMPlexSans',
                          fontSize: 12,
                          color: MatoColors.muted,
                        ),
                        dataTextStyle: const TextStyle(
                          fontFamily: 'IBMPlexSans',
                          fontSize: 12,
                          color: MatoColors.text,
                        ),
                        columns: [
                          for (final column in columns)
                            DataColumn(
                              label: Text(column.$1),
                              onSort: column.$2.isEmpty
                                  ? null
                                  : (_, ascending) => setState(() {
                                      _bookAscending = _bookSort == column.$2
                                          ? ascending
                                          : column.$2 == 'endSlot';
                                      _bookSort = column.$2;
                                    }),
                            ),
                        ],
                        rows: [
                          for (final p in rows)
                            DataRow(
                              cells: [
                                DataCell(
                                  Container(
                                    padding: const EdgeInsets.symmetric(
                                      horizontal: 10,
                                      vertical: 4,
                                    ),
                                    decoration: BoxDecoration(
                                      color:
                                          (p.isBuy
                                                  ? MatoColors.positive
                                                  : MatoColors.negative)
                                              .withValues(alpha: .12),
                                      borderRadius: BorderRadius.circular(100),
                                    ),
                                    child: Text(
                                      p.isBuy ? 'Buy' : 'Sell',
                                      style: TextStyle(
                                        color: p.isBuy
                                            ? MatoColors.positive
                                            : MatoColors.negative,
                                      ),
                                    ),
                                  ),
                                ),
                                DataCell(
                                  Text(
                                    '${shortAddress(p.address)} ↗',
                                    style: const TextStyle(
                                      color: MatoColors.muted,
                                    ),
                                  ),
                                  onTap: () => openExplorer(context, p.address),
                                ),
                                DataCell(
                                  Text(
                                    '${formatAmount(p.amount, p.isBuy ? 6 : 9)} ${p.isBuy ? 'USDC' : 'SOL'}',
                                  ),
                                ),
                                DataCell(
                                  Text(
                                    '${formatAmount(value(p, 'flow'), p.isBuy ? 6 : 9)} ${p.isBuy ? 'USDC' : 'SOL'}/slot',
                                    style: const TextStyle(
                                      color: MatoColors.muted,
                                    ),
                                  ),
                                ),
                                DataCell(Text('${p.data['startSlot']}')),
                                DataCell(Text('${p.endSlot}')),
                              ],
                            ),
                        ],
                      ),
                    ),
                  ),
                ),
        ),
      ],
    );
  }
}

class _ImpactCurve extends CustomPainter {
  _ImpactCurve({
    required this.values,
    required this.selected,
    this.recommended,
  });
  final List<double> values;
  final double selected;
  final double? recommended;
  @override
  void paint(Canvas canvas, Size size) {
    final plot = Rect.fromLTRB(8, 8, size.width - 8, size.height - 6);
    final maxValue = math.max(.001, math.log(1 + values.reduce(math.max)));
    double x(double fraction) => plot.left + fraction * plot.width;
    double y(double value) =>
        plot.bottom - math.log(1 + value) / maxValue * (plot.height - 8);
    double valueAt(double fraction) {
      final index = (fraction * (values.length - 1)).round().clamp(
        0,
        values.length - 1,
      );
      return values[index];
    }

    final path = Path();
    for (var i = 0; i < values.length; i++) {
      final point = Offset(x(i / (values.length - 1)), y(values[i]));
      if (i == 0) {
        path.moveTo(point.dx, point.dy);
      } else {
        path.lineTo(point.dx, point.dy);
      }
    }
    final fill = Path.from(path)
      ..lineTo(plot.right, plot.bottom)
      ..lineTo(plot.left, plot.bottom)
      ..close();
    canvas.drawPath(
      fill,
      Paint()
        ..shader = LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [
            MatoColors.orange.withValues(alpha: .15),
            MatoColors.orange.withValues(alpha: 0),
          ],
        ).createShader(plot),
    );
    final reference = values.reduce(math.max) > 1.2
        ? 1.0
        : values.reduce(math.max) > .2
        ? .1
        : .01;
    final lineY = y(reference);
    if (lineY >= plot.top && lineY <= plot.bottom) {
      for (double xx = plot.left; xx < plot.right; xx += 7) {
        canvas.drawLine(
          Offset(xx, lineY),
          Offset(math.min(xx + 3, plot.right), lineY),
          Paint()..color = MatoColors.faint.withValues(alpha: .45),
        );
      }
      final label = TextPainter(
        text: TextSpan(
          text: '${tradeNumber(reference, 2)}%',
          style: const TextStyle(
            fontFamily: 'IBMPlexSans',
            fontSize: 10,
            color: MatoColors.muted,
          ),
        ),
        textDirection: TextDirection.ltr,
      )..layout();
      label.paint(
        canvas,
        Offset(plot.right - label.width, math.max(plot.top, lineY - 15)),
      );
    }
    canvas.drawPath(
      path,
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 2
        ..color = MatoColors.orange,
    );
    if (recommended != null) {
      canvas.drawCircle(
        Offset(x(recommended!), y(valueAt(recommended!))),
        6,
        Paint()
          ..style = PaintingStyle.stroke
          ..strokeWidth = 1.5
          ..color = MatoColors.secondary,
      );
    }
    final point = Offset(x(selected), y(valueAt(selected)));
    canvas.drawLine(
      Offset(point.dx, plot.top),
      Offset(point.dx, plot.bottom),
      Paint()..color = MatoColors.secondary.withValues(alpha: .4),
    );
    canvas.drawCircle(point, 7, Paint()..color = MatoColors.accent);
    canvas.drawCircle(point, 3, Paint()..color = MatoColors.background);
  }

  @override
  bool shouldRepaint(_ImpactCurve old) =>
      old.values != values ||
      old.selected != selected ||
      old.recommended != recommended;
}
