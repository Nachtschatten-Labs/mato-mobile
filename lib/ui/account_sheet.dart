import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../data/config.dart';
import '../domain/amounts.dart';
import '../domain/models.dart';
import '../state/app_controller.dart';
import 'theme.dart';
import 'widgets.dart';

class AccountSheet extends StatefulWidget {
  const AccountSheet({super.key, required this.app});
  final AppController app;
  @override
  State<AccountSheet> createState() => _AccountSheetState();
}

class _AccountSheetState extends State<AccountSheet> {
  bool _accounts = false;
  int _accountLimit = 10;
  String? _error;
  AppController get app => widget.app;
  Future<void> run(Future<void> Function() action) async {
    setState(() => _error = null);
    try {
      await action();
    } catch (e) {
      if (mounted) setState(() => _error = errorText(e));
    }
  }

  Future<void> reclaim(List<IntervalAccount> accounts) async {
    final owner = app.wallet.address;
    final amount = accounts.fold(
      BigInt.zero,
      (sum, item) => sum + item.lamports,
    );
    final agreed = await showMatoSheet<bool>(
      context,
      title: 'Reclaim account rent?',
      child: Column(
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
          Detail('Receiver', shortAddress(owner!)),
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
      await app.transact('Account rent reclaimed', () async {
        final result = await app.trading.reclaimRent(
          maxAccounts: accounts.length,
        );
        return result.signature;
      });
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
      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (address == null) ...[
            const Icon(
              Icons.account_balance_wallet_outlined,
              size: 40,
              color: MatoColors.secondary,
            ),
            const SizedBox(height: 20),
            const Text(
              'Your wallet. Your streams.',
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 22),
            ),
            const SizedBox(height: 12),
            const Text(
              'Connect to see balances, manage streams, and reclaim unused account deposits.',
              textAlign: TextAlign.center,
              style: TextStyle(color: MatoColors.muted, height: 1.6),
            ),
            const SizedBox(height: 24),
            if (!app.wallet.isSupported)
              const Notice(
                'Wallet connections are available on Android. Live market data is available on this device.',
              ),
            ActionButton(
              'Connect wallet',
              busy: app.wallet.isBusy,
              onPressed: app.wallet.isSupported
                  ? () => run(app.wallet.connect)
                  : null,
            ),
          ] else ...[
            SelectableText(
              address,
              style: const TextStyle(fontSize: 16, height: 1.6),
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                Expanded(
                  child: TextButton.icon(
                    icon: const Icon(Icons.copy_rounded, size: 16),
                    label: const Text('Copy address'),
                    onPressed: () async {
                      await Clipboard.setData(ClipboardData(text: address));
                      if (context.mounted) {
                        ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(
                            content: Text('Wallet address copied'),
                          ),
                        );
                      }
                    },
                  ),
                ),
                Expanded(
                  child: TextButton.icon(
                    icon: const Icon(Icons.open_in_new_rounded, size: 16),
                    label: const Text('Explorer'),
                    onPressed: () => openExplorer(context, address),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 22),
            const Text('Balances', style: TextStyle(fontSize: 19)),
            const SizedBox(height: 10),
            if (app.balances == null && app.loading.contains('balances'))
              const Center(child: CircularProgressIndicator(strokeWidth: 2))
            else ...[
              _balance(
                'SOL',
                'Solana',
                formatAmount(app.balances?.totalSol, 9),
              ),
              _balance('USDC', 'USD Coin', formatAmount(app.balances?.usdc, 6)),
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
            const SizedBox(height: 30),
            const Text('Reclaim account rent', style: TextStyle(fontSize: 19)),
            const SizedBox(height: 10),
            const Text(
              'Get back the SOL deposited in unused market interval accounts.',
              style: TextStyle(
                color: MatoColors.muted,
                fontSize: 13,
                height: 1.5,
              ),
            ),
            const SizedBox(height: 16),
            Text(
              '${formatAmount(returnAtoms, 9)} SOL',
              style: const TextStyle(fontSize: 28),
            ),
            Detail('Eligible accounts in this batch', '${eligible.length}'),
            Detail('Total funded accounts', '${app.intervals.length}'),
            if (app.errors['intervals'] != null)
              const Notice('Could not check account rent.', error: true),
            if (app.balances != null &&
                app.balances!.lamports < maintenanceFeeBufferAtoms)
              const Notice('Add at least 0.001 SOL for the transaction fee.'),
            const SizedBox(height: 10),
            ActionButton(
              eligible.isEmpty ? 'No rent to reclaim' : 'Reclaim rent',
              busy: app.transactionBusy,
              onPressed:
                  maintenanceAllowed &&
                      eligible.isNotEmpty &&
                      !app.errors.containsKey('intervals')
                  ? () => reclaim(eligible)
                  : null,
            ),
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
            if (app.lastSignature != null) ...[
              Notice('${app.lastAction}. Transaction confirmed.'),
              TextButton(
                onPressed: () => openExplorer(
                  context,
                  app.lastSignature!,
                  transaction: true,
                ),
                child: const Text('View transaction ↗'),
              ),
            ],
          ],
          if (_error != null) Notice(_error!, error: true),
          const SizedBox(height: 24),
          const Divider(),
          const Detail('Network', 'Solana mainnet'),
          const Detail('Market', 'SOL / USDC'),
          Detail(
            'Trading',
            app.config.transactionsEnabled ? 'Enabled on Android' : 'Read-only',
          ),
          TextButton(
            onPressed: () => openExplorer(context, AppConfig.programId),
            child: const Text('View program ↗'),
          ),
          if (address != null) ...[
            TextButton(
              onPressed: app.transactionBusy || app.wallet.isBusy
                  ? null
                  : () => run(() async {
                      await app.refresh(forceChart: true);
                    }),
              child: const Text('Refresh account'),
            ),
            TextButton(
              onPressed: app.transactionBusy || app.wallet.isBusy
                  ? null
                  : () => run(app.wallet.disconnect),
              child: const Text(
                'Disconnect',
                style: TextStyle(color: MatoColors.negative),
              ),
            ),
          ],
        ],
      );
    },
  );

  Widget _balance(String symbol, String name, String value) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 12),
    child: Row(
      children: [
        TokenBadge(symbol, size: 34),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(name),
              Text(
                symbol,
                style: const TextStyle(color: MatoColors.muted, fontSize: 12),
              ),
            ],
          ),
        ),
        Text(value, style: const TextStyle(fontSize: 23, letterSpacing: -.3)),
      ],
    ),
  );
}
