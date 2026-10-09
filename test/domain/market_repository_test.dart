import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mato_mobile/data/config.dart';
import 'package:mato_mobile/data/market_repository.dart';
import 'package:mato_mobile/data/rpc_client.dart';
import 'package:mato_mobile/domain/models.dart';

void main() {
  test('API normalization drops duplicate v1 and rejects credential URLs', () {
    expect(
      normalizeReadApiBaseUrl(' api.example.com/v1/ '),
      'https://api.example.com',
    );
    expect(
      () => normalizeReadApiBaseUrl('https://user:secret@example.com'),
      throwsFormatException,
    );
    expect(
      () => AppConfig.validateEndpoint('http://example.com', 'RPC'),
      throwsFormatException,
    );
  });
  test(
    'candles normalize timestamp precision, malformed OHLC and duplicates',
    () {
      final candles = parseCandles([
        {
          'time': 1700000000000,
          'open': 100,
          'high': 99,
          'low': 102,
          'close': 101,
        },
        {
          'time': 1700000060000000,
          'open': 102,
          'high': 104,
          'low': 101,
          'close': 103,
        },
        {
          'time': 1700000060,
          'open': 103,
          'high': 105,
          'low': 102,
          'close': 104,
        },
        {'time': 1700000100, 'open': 0, 'high': 100, 'low': 90, 'close': 95},
      ]);
      expect(candles.length, 2);
      expect(candles.first.time, 1700000000);
      expect(candles.first.high, 102);
      expect(candles.first.low, 99);
      expect(candles.last.close, 104);
    },
  );
  test('closed positions retain exact atoms and pagination cursor', () async {
    final repo = MarketRepository(
      client: MockClient((request) async {
        expect(request.url.queryParameters['before_slot'], '300');
        return http.Response(
          jsonEncode({
            'authority': 'owner',
            'market_address': MarketDefinition.sol.address,
            'has_more': true,
            'items': [
              {
                'signature': 'signature',
                'event_index': 2,
                'slot': 200,
                'market_address': MarketDefinition.sol.address,
                'deposit_amount': '18446744073709551615',
                'swapped_amount': '9007199254740993',
                'remaining_amount': '1',
                'fee_amount': '2',
                'is_buy': true,
                'event_time': '2026-10-01T12:00:00Z',
                'start_slot': 100,
                'end_slot': 199,
              },
            ],
          }),
          200,
        );
      }),
    );
    addTearDown(repo.close);
    final page = await repo.fetchClosedPositions('owner', beforeSlot: 300);
    expect(page.hasMore, isTrue);
    expect(page.beforeSlot, 200);
    expect(
      page.items.single.depositAmount,
      BigInt.parse('18446744073709551615'),
    );
    expect(page.items.single.receivedAmount, BigInt.parse('9007199254740991'));
  });
  test('read API rejects a different market or wallet authority', () async {
    final repo = MarketRepository(
      client: MockClient(
        (_) async => http.Response(
          jsonEncode({
            'market_address': 'wrong',
            'authority': 'wrong',
            'items': [],
          }),
          200,
        ),
      ),
    );
    addTearDown(repo.close);
    await expectLater(repo.fetchPrice(), throwsA(isA<DataServiceException>()));
    await expectLater(
      repo.fetchClosedPositions('owner'),
      throwsA(isA<DataServiceException>()),
    );
  });
  test(
    'spendable balances read canonical ATAs and exclude frozen tokens',
    () async {
      const owner = '11111111111111111111111111111111';
      final rpc = RpcClient(
        client: MockClient((request) async {
          final body = jsonDecode(request.body);
          dynamic result;
          if (body['method'] == 'getBalance') {
            result = {'value': 25000000};
          } else {
            expect(body['method'], 'getMultipleAccounts');
            expect(body['params'][0], hasLength(2));
            Map<String, dynamic> account(
              String mint,
              String amount,
              String state,
            ) => {
              'owner': 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
              'data': {
                'parsed': {
                  'info': {
                    'mint': mint,
                    'owner': owner,
                    'state': state,
                    'tokenAmount': {'amount': amount},
                  },
                },
              },
            };
            result = {
              'value': [
                account(MarketDefinition.sol.baseMint, '3', 'initialized'),
                account(
                  MarketDefinition.sol.quoteMint,
                  '9007199254740993',
                  'frozen',
                ),
              ],
            };
          }
          return http.Response(
            jsonEncode({'jsonrpc': '2.0', 'id': body['id'], 'result': result}),
            200,
          );
        }),
      );
      final repo = MarketRepository(rpc: rpc);
      addTearDown(repo.close);
      final balances = await repo.fetchBalances(owner);
      expect(balances.spendableSol, BigInt.from(5000003));
      expect(balances.wrappedSol, BigInt.from(3));
      expect(balances.usdc, BigInt.zero);
    },
  );
  test(
    'JSON RPC surfaces server errors and preserves request identity',
    () async {
      final rpc = RpcClient(
        client: MockClient((request) async {
          final requestData = jsonDecode(request.body);
          expect(requestData['method'], 'getSlot');
          return http.Response(
            jsonEncode({
              'jsonrpc': '2.0',
              'id': requestData['id'],
              'error': {'code': -32005, 'message': 'Node is behind'},
            }),
            200,
          );
        }),
      );
      await expectLater(
        rpc.call('getSlot'),
        throwsA(isA<RpcException>().having((e) => e.code, 'code', -32005)),
      );
    },
  );
}
