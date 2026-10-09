import 'dart:convert';
import 'dart:io';
import 'package:mato_mobile/data/config.dart';
import 'package:mato_mobile/data/market_repository.dart';
import 'package:mato_mobile/protocol/protocol.dart';

Future<void> main() async {
  final config = AppConfig.fromEnvironment();
  final repository = MarketRepository(config: config);
  try {
    final client = TradingClient(
      rpc: (method, params) => repository.rpc.call(method, params),
      walletAddress: () => '',
      signAndSend: (_, _) =>
          throw StateError('Read-only verification never signs.'),
      transactionsEnabled: true,
    );
    await client.verifyEnvironment();
    await repository.fetchConfig();
    final market = await repository.fetchMarketState();
    final price = await repository.fetchPrice();
    stdout.writeln(
      jsonEncode({
        'verified': true,
        'program': AppConfig.programId,
        'market': marketAddress,
        'slot': market.currentSlot,
        'paused': market.isPaused,
        'price': price.price,
      }),
    );
  } finally {
    repository.close();
  }
}
