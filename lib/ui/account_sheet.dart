import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../data/config.dart';
import '../domain/amounts.dart';
import '../domain/models.dart';
import '../state/app_controller.dart';
import '../wallet/wallet_service.dart';
import 'theme.dart';
import 'widgets.dart';

/// Native counterpart of the v1 wallet menu. MWA lets Android offer the installed
/// wallets; it does not expose the browser's connector list or connector name.
class AccountSheet extends StatefulWidget {
  const AccountSheet({super.key, required this.app});
  final AppController app;
  @override
  State<AccountSheet> createState() => _AccountSheetState();
}

class _AccountSheetState extends State<AccountSheet> {
  bool _details = false;
  bool _accounts = false;
  bool _copied = false;
  bool _connecting = false;
  int _accountLimit = 10;
  String? _error;
  Timer? _copyTimer;
  AppController get app => widget.app;

  @override
  void dispose() {
    _copyTimer?.cancel();
    super.dispose();
  }

  Future<void> run(Future<void> Function() action) async {
    setState(() => _error = null);
    try {
      await action();
    } catch (e) {
      if (mounted) setState(() => _error = errorText(e));
    }
  }

  Future<void> connect() async {
    if (_connecting || app.wallet.isBusy) return;
    setState(() {
      _connecting = true;
      _error = null;
    });
    try {
      await app.wallet.connect();
      if (mounted && app.wallet.isConnected && Navigator.canPop(context)) {
        Navigator.pop(context);
      }
    } catch (error) {
      if (mounted) {
        setState(() {
          _error = error is WalletException && error.isCancellation
              ? 'The request was declined or closed in your wallet.'
              : errorText(error);
        });
      }
    } finally {
      if (mounted) setState(() => _connecting = false);
    }
  }

  Future<void> copyAddress(String address) async {
    try {
      await Clipboard.setData(ClipboardData(text: address));
      if (!mounted) return;
      _copyTimer?.cancel();
      setState(() => _copied = true);
      _copyTimer = Timer(const Duration(milliseconds: 1500), () {
        if (mounted) setState(() => _copied = false);
      });
    } catch (_) {
      if (mounted) {
        setState(() => _error = 'Could not copy your wallet address.');
      }
    }
  }

  Future<void> reclaim(List<IntervalAccount> accounts) async {
    final owner = app.wallet.address;
    if (owner == null) return;
    final amount = accounts.fold(
      BigInt.zero,
      (sum, item) => sum + item.lamports,
    );
    final agreed = await showMatoSheet<bool>(
      context,
      title: 'Reclaim account rent?',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            'Close ${accounts.length} unused market accounts and return their SOL deposit to your wallet.',
            style: const TextStyle(color: MatoColors.secondary, height: 1.5),
          ),
          const SizedBox(height: 16),
          Detail(
            'Estimated return',
            '${formatAmount(amount, 9, precision: 9)} SOL',
          ),
          Detail('Receiver', shortAddress(owner)),
          const Notice('The network transaction fee is deducted separately.'),
          ActionButton(
            'Reclaim rent',
            onPressed: () => Navigator.pop(context, true),
          ),
        ],
      ),
    );
    if (agreed != true || !mounted) return;
    await run(() async {
      if (app.wallet.address != owner) {
        throw StateError('Your wallet changed. Review again.');
      }
      final signature = await app.transact('Account rent reclaimed', () async {
        final result = await app.trading.reclaimRent(
          maxAccounts: accounts.length,
        );
        return result.signature;
      });
      if (mounted) {
        showMatoToast(
          context,
          title: 'Rent reclaimed',
          description:
              'The unused account deposits were returned to your wallet.',
          signature: signature,
        );
      }
    });
  }

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
    animation: app,
    builder: (context, _) {
      final address = app.wallet.address;
      final eligible = address == null || app.market == null
          ? <IntervalAccount>[]
          : app.intervals
                .where((a) => a.isReclaimable(app.market!.currentSlot, address))
                .take(10)
                .toList();
      final returnAtoms = eligible.fold(
        BigInt.zero,
        (sum, item) => sum + item.lamports,
      );
      final maintenanceAllowed =
          address != null &&
          app.wallet.isSupported &&
          app.config.transactionsEnabled &&
          !app.transactionBusy &&
          !app.wallet.isBusy &&
          app.marketFresh &&
          app.balances != null &&
          app.balances!.lamports >= maintenanceFeeBufferAtoms &&
          !app.errors.containsKey('balances');
      final busy = app.transactionBusy || app.wallet.isBusy;
      return Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (address == null) ...[
            const Text(
              'Choose your wallet to start trading.',
              style: TextStyle(
                color: MatoColors.muted,
                fontSize: 13,
                height: 1.5,
              ),
            ),
            const SizedBox(height: 16),
            if (_error != null) ...[
              _connectionError(),
              const SizedBox(height: 12),
            ],
            _menuAction(
              'Mobile wallet',
              Icons.account_balance_wallet_outlined,
              onPressed: app.wallet.isSupported && !busy && !_connecting
                  ? connect
                  : null,
              trailing: _connecting || app.wallet.isBusy
                  ? const Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        SizedBox(
                          width: 12,
                          height: 12,
                          child: CircularProgressIndicator(strokeWidth: 1.5),
                        ),
                        SizedBox(width: 8),
                        Text(
                          'Approve in wallet',
                          style: TextStyle(
                            fontSize: 12,
                            color: MatoColors.muted,
                          ),
                        ),
                      ],
                    )
                  : const Text(
                      'Connect',
                      style: TextStyle(fontSize: 12, color: MatoColors.muted),
                    ),
            ),
            const SizedBox(height: 12),
            Text(
              app.wallet.isSupported
                  ? 'Android will open your installed wallet to approve the connection.'
                  : 'Wallet connections are available in the Android app. You can explore live markets on this device.',
              style: const TextStyle(
                color: MatoColors.muted,
                fontSize: 12,
                height: 1.5,
              ),
            ),
          ] else ...[
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: MatoColors.elevated,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: MatoColors.border),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const Row(
                    children: [
                      Icon(Icons.circle, size: 6, color: MatoColors.positive),
                      SizedBox(width: 6),
                      Expanded(
                        child: Text(
                          'Connected',
                          style: TextStyle(
                            fontSize: 12,
                            color: MatoColors.muted,
                          ),
                        ),
                      ),
                      Text(
                        'Mobile wallet',
                        style: TextStyle(fontSize: 12, color: MatoColors.muted),
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  Align(
                    alignment: Alignment.centerLeft,
                    child: Semantics(
                      label: _copied ? 'Address copied' : 'Copy wallet address',
                      button: true,
                      child: InkWell(
                        borderRadius: BorderRadius.circular(4),
                        onTap: () => copyAddress(address),
                        child: Padding(
                          padding: const EdgeInsets.symmetric(vertical: 6),
                          child: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Icon(
                                _copied
                                    ? Icons.check_rounded
                                    : Icons.copy_outlined,
                                size: 16,
                                color: _copied
                                    ? MatoColors.positive
                                    : MatoColors.secondary,
                              ),
                              const SizedBox(width: 8),
                              Text(
                                shortAddress(address),
                                style: const TextStyle(fontSize: 14),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
            if (eligible.isNotEmpty) ...[
              const SizedBox(height: 12),
              _menuAction(
                app.wallet.isBusy
                    ? 'Approve in wallet'
                    : app.transactionBusy
                    ? 'Reclaiming rent…'
                    : 'Reclaim Rent',
                Icons.savings_outlined,
                onPressed:
                    maintenanceAllowed && !app.errors.containsKey('intervals')
                    ? () => reclaim(eligible)
                    : null,
              ),
              if (app.balances != null &&
                  app.balances!.lamports < maintenanceFeeBufferAtoms)
                const Notice('Add at least 0.001 SOL for the transaction fee.'),
            ],
            const SizedBox(height: 12),
            _menuAction(
              'Disconnect',
              Icons.logout_rounded,
              onPressed: busy
                  ? null
                  : () => run(() async {
                      await app.wallet.disconnect();
                      if (context.mounted && Navigator.canPop(context)) {
                        Navigator.pop(context);
                      }
                    }),
            ),
            const SizedBox(height: 4),
            TextButton(
              onPressed: () => setState(() => _details = !_details),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Flexible(
                    child: Text(
                      _details ? 'Hide account details' : 'Account details',
                      textAlign: TextAlign.center,
                      style: const TextStyle(fontSize: 12),
                    ),
                  ),
                  const SizedBox(width: 4),
                  Icon(
                    _details
                        ? Icons.keyboard_arrow_up
                        : Icons.keyboard_arrow_down,
                    size: 16,
                  ),
                ],
              ),
            ),
            if (_error != null) Notice(_error!, error: true),
            if (_details) ...[
              const Divider(),
              const SizedBox(height: 12),
              const Text('Balances', style: TextStyle(fontSize: 15)),
              const SizedBox(height: 4),
              if (app.balances == null && app.loading.contains('balances'))
                const Padding(
                  padding: EdgeInsets.all(16),
                  child: Center(
                    child: CircularProgressIndicator(strokeWidth: 2),
                  ),
                )
              else ...[
                _balance(
                  'SOL',
                  'Solana',
                  formatAmount(app.balances?.totalSol, 9),
                ),
                _balance(
                  'USDC',
                  'USD Coin',
                  formatAmount(app.balances?.usdc, 6),
                ),
                if (app.balances != null &&
                    app.balances!.wrappedSol > BigInt.zero)
                  Detail(
                    'Wrapped SOL included',
                    '${formatAmount(app.balances!.wrappedSol, 9)} SOL',
                  ),
              ],
              if (app.errors['balances'] != null)
                const Notice('Balances could not be refreshed.', error: true),
              const Text(
                'Trading reserves 0.02 SOL for network fees and account rent.',
                style: TextStyle(
                  color: MatoColors.muted,
                  fontSize: 12,
                  height: 1.5,
                ),
              ),
              const SizedBox(height: 24),
              const Text('Account rent', style: TextStyle(fontSize: 15)),
              const SizedBox(height: 8),
              Detail(
                'Available to reclaim',
                '${formatAmount(returnAtoms, 9)} SOL',
              ),
              Detail('Eligible accounts in this batch', '${eligible.length}'),
              Detail('Total funded accounts', '${app.intervals.length}'),
              if (app.errors['intervals'] != null)
                const Notice('Could not check account rent.', error: true),
              TextButton(
                onPressed: () => setState(() => _accounts = !_accounts),
                child: Text(
                  _accounts ? 'Hide funded accounts' : 'View funded accounts',
                ),
              ),
              if (_accounts) ...[
                if (app.intervals.isEmpty)
                  const Notice('No funded market interval accounts.'),
                ...app.intervals
                    .take(_accountLimit)
                    .map(
                      (account) => Column(
                        children: [
                          const Divider(),
                          InkWell(
                            onTap: () => openExplorer(context, account.address),
                            child: Detail(
                              'Account ↗',
                              shortAddress(account.address),
                            ),
                          ),
                          Detail('Interval', '${account.index}'),
                          Detail(
                            'Open positions',
                            '${account.data['openPositions']}',
                          ),
                          Detail(
                            'Deposit',
                            '${formatAmount(account.lamports, 9)} SOL',
                          ),
                        ],
                      ),
                    ),
                if (app.intervals.length > _accountLimit)
                  TextButton(
                    onPressed: () => setState(() => _accountLimit += 10),
                    child: const Text('Show more'),
                  ),
              ],
              const Divider(),
              const Detail('Network', 'Solana mainnet'),
              const Detail('Market', 'SOL / USDC'),
              Detail(
                'Trading',
                app.config.transactionsEnabled
                    ? 'Enabled on Android'
                    : 'Read-only',
              ),
              TextButton(
                onPressed: () => openExplorer(context, address),
                child: const Text('View wallet ↗'),
              ),
              TextButton(
                onPressed: () => openExplorer(context, AppConfig.programId),
                child: const Text('View program ↗'),
              ),
              TextButton(
                onPressed: busy
                    ? null
                    : () => run(() => app.refresh(forceChart: true)),
                child: const Text('Refresh account'),
              ),
            ],
          ],
        ],
      );
    },
  );

  Widget _connectionError() => Container(
    padding: const EdgeInsets.all(12),
    decoration: BoxDecoration(
      color: MatoColors.negative.withValues(alpha: .08),
      border: Border.all(color: MatoColors.negative.withValues(alpha: .3)),
      borderRadius: BorderRadius.circular(8),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text(
          "Wallet didn't connect",
          style: TextStyle(
            fontWeight: FontWeight.w500,
            color: MatoColors.negative,
            fontSize: 13,
          ),
        ),
        const SizedBox(height: 4),
        Text(
          _error!,
          style: const TextStyle(
            color: MatoColors.secondary,
            fontSize: 12,
            height: 1.5,
          ),
        ),
        TextButton(
          onPressed: _connecting || app.wallet.isBusy ? null : connect,
          child: const Text('Try again'),
        ),
      ],
    ),
  );

  Widget _menuAction(
    String label,
    IconData icon, {
    VoidCallback? onPressed,
    Widget? trailing,
  }) => OutlinedButton(
    onPressed: onPressed,
    style: OutlinedButton.styleFrom(
      foregroundColor: MatoColors.text,
      disabledForegroundColor: MatoColors.muted,
      side: const BorderSide(color: MatoColors.border),
      backgroundColor: MatoColors.elevated.withValues(alpha: .3),
      minimumSize: const Size(0, 46),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      textStyle: const TextStyle(
        fontFamily: 'IBMPlexSans',
        fontSize: 13,
        fontWeight: FontWeight.w400,
      ),
    ),
    child: Row(
      children: [
        Expanded(child: Text(label)),
        const SizedBox(width: 8),
        trailing ?? Icon(icon, size: 16, color: MatoColors.muted),
      ],
    ),
  );

  Widget _balance(String symbol, String name, String value) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 12),
    child: Row(
      children: [
        TokenBadge(symbol, size: 28),
        const SizedBox(width: 10),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(name, style: const TextStyle(fontSize: 13)),
              Text(
                symbol,
                style: const TextStyle(color: MatoColors.muted, fontSize: 11),
              ),
            ],
          ),
        ),
        Text(value, style: const TextStyle(fontSize: 18, letterSpacing: -.3)),
      ],
    ),
  );
}
