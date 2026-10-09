import 'dart:async';
import 'dart:convert';
import 'dart:math' as math;
import 'dart:typed_data';
import 'package:http/http.dart' as http;
import '../domain/models.dart';
import '../domain/settlement.dart';
import '../protocol/account_codec.dart';
import '../protocol/protocol.dart' as protocol;
import 'config.dart';
import 'rpc_client.dart';

class DataServiceException implements Exception {
  const DataServiceException(this.message);
  final String message;
  @override
  String toString() => message;
}

class MarketRepository {
  MarketRepository({RpcClient? rpc, http.Client? client, AppConfig? config})
    : config = config ?? AppConfig.fromEnvironment(),
      _http = client ?? http.Client(),
      _ownsHttp = client == null,
      _ownsRpc = rpc == null,
      rpc =
          rpc ?? RpcClient(url: (config ?? AppConfig.fromEnvironment()).rpcUrl);
  final AppConfig config;
  final RpcClient rpc;
  final http.Client _http;
  final bool _ownsHttp, _ownsRpc;
  static const market = MarketDefinition.sol;
  String get _marketPath => '/v1/markets/${market.address}';

  Future<Map<String, dynamic>?> _get(
    String path, {
    Map<String, String>? query,
    bool allow404 = false,
  }) async {
    final uri = Uri.parse(
      '${normalizeReadApiBaseUrl(config.readApiUrl)}$path',
    ).replace(queryParameters: query);
    final response = await _http
        .get(uri, headers: {'Accept': 'application/json'})
        .timeout(
          const Duration(seconds: 15),
          onTimeout: () => throw const DataServiceException(
            'Market data request timed out. Pull to refresh to try again.',
          ),
        );
    if (allow404 && response.statusCode == 404) return null;
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw DataServiceException(
        'Market data request failed (${response.statusCode}). Pull to refresh to try again.',
      );
    }
    final data = jsonDecode(response.body);
    if (data is! Map<String, dynamic>) {
      throw const DataServiceException('Invalid market data response');
    }
    return data;
  }

  void _assertMarket(Map<String, dynamic> data) {
    if (data['market_address'] != market.address) {
      throw const DataServiceException(
        'Market data returned a different market address',
      );
    }
  }

  List<Map<String, dynamic>> _items(Map<String, dynamic> data) {
    if (data['items'] is! List) {
      throw const DataServiceException('Market data response is missing items');
    }
    return (data['items'] as List)
        .map((item) => Map<String, dynamic>.from(item as Map))
        .toList();
  }

  Future<Map<String, dynamic>> fetchConfig() async {
    final data = (await _get('$_marketPath/config'))!;
    _assertMarket(data);
    if (data['base_mint'] != market.baseMint ||
        data['quote_mint'] != market.quoteMint ||
        data['base_decimals'] != market.baseDecimals ||
        data['quote_decimals'] != market.quoteDecimals) {
      throw const DataServiceException(
        'Market data configuration does not match the deployed market',
      );
    }
    return data;
  }

  Future<MarketPriceSnapshot> fetchPrice() async {
    final data = await _get('$_marketPath/price', allow404: true);
    if (data == null) return const MarketPriceSnapshot();
    _assertMarket(data);
    final price = data['price'];
    return MarketPriceSnapshot(
      price: price is num && price.isFinite && price > 0
          ? price.toDouble()
          : null,
      slot: data['slot'] is int ? data['slot'] as int : null,
      eventTime: DateTime.tryParse(data['event_time']?.toString() ?? ''),
    );
  }

  Future<List<MarketCandle>> fetchCandles({
    required DateTime from,
    required DateTime to,
    required String interval,
    int maxPoints = 1500,
  }) async {
    if (!['1m', '5m', '1h'].contains(interval)) {
      throw ArgumentError.value(interval, 'interval');
    }
    final data = (await _get(
      '$_marketPath/candles',
      query: {
        'from': from.toUtc().toIso8601String(),
        'to': to.toUtc().toIso8601String(),
        'interval': interval,
        'max_points': '$maxPoints',
      },
    ))!;
    _assertMarket(data);
    return parseCandles(_items(data));
  }

  Future<PageResult<MarketUpdate>> fetchUpdates({
    int? beforeSlot,
    int limit = 200,
  }) async {
    final data = (await _get(
      '$_marketPath/updates',
      query: {
        'limit': '$limit',
        if (beforeSlot != null) 'before_slot': '$beforeSlot',
      },
    ))!;
    _assertMarket(data);
    final items = _items(data);
    for (final item in items) {
      _assertMarket(item);
    }
    final updates = items.map(MarketUpdate.fromJson).toList()
      ..sort((a, b) => b.slot.compareTo(a.slot));
    final ids = <String>{};
    final deduped = updates.where((item) => ids.add(item.id)).toList();
    return PageResult(
      items: deduped,
      hasMore: data['has_more'] == true,
      beforeSlot: deduped.isEmpty ? null : deduped.last.slot,
    );
  }

  Future<List<MarketUpdate>> fetchHistory({
    required int startSlot,
    required int endSlot,
  }) async {
    if (startSlot > endSlot) return [];
    final data = (await _get(
      '$_marketPath/history',
      query: {
        'start_slot': '$startSlot',
        'end_slot': '$endSlot',
        'max_rows': '100000',
      },
    ))!;
    _assertMarket(data);
    final items = _items(data);
    for (final item in items) {
      _assertMarket(item);
    }
    return items.map(MarketUpdate.fromJson).toList();
  }

  Future<PageResult<ClosedPosition>> fetchClosedPositions(
    String authority, {
    int? beforeSlot,
    int limit = 50,
  }) async {
    final data = (await _get(
      '/v1/authorities/${Uri.encodeComponent(authority)}/closed-positions',
      query: {
        'market_address': market.address,
        'limit': '$limit',
        if (beforeSlot != null) 'before_slot': '$beforeSlot',
      },
    ))!;
    if (data['authority'] != authority) {
      throw const DataServiceException(
        'Market data returned a different authority',
      );
    }
    _assertMarket(data);
    final items = _items(data);
    for (final item in items) {
      _assertMarket(item);
    }
    final positions =
        items.map((json) => ClosedPosition.fromJson(json, authority)).toList()
          ..sort((a, b) => b.slot.compareTo(a.slot));
    return PageResult(
      items: positions,
      hasMore: data['has_more'] == true,
      beforeSlot: positions.isEmpty ? null : positions.last.slot,
    );
  }

  Future<WalletBalances> fetchBalances(String authority) async {
    // Instructions debit the canonical associated accounts, so other wallet
    // token accounts must not inflate the amount shown as available to spend.
    final addresses = await Future.wait([
      protocol.deriveAssociatedTokenAddress(
        mint: market.baseMint,
        owner: authority,
      ),
      protocol.deriveAssociatedTokenAddress(
        mint: market.quoteMint,
        owner: authority,
      ),
    ]);
    final responses = await Future.wait([
      rpc.call('getBalance', [
        authority,
        {'commitment': 'confirmed'},
      ]),
      rpc.call('getMultipleAccounts', [
        addresses,
        {'encoding': 'jsonParsed', 'commitment': 'confirmed'},
      ]),
    ]);
    BigInt tokenBalance(dynamic account, String mint) {
      if (account == null) return BigInt.zero;
      if (account['owner'] != protocol.tokenProgram) {
        throw const DataServiceException(
          'Token account belongs to an unexpected program',
        );
      }
      final info = account['data']['parsed']['info'];
      if (info['owner'] != authority || info['mint'] != mint) {
        throw const DataServiceException(
          'Token account does not match the connected wallet',
        );
      }
      if (info['state'] != 'initialized') return BigInt.zero;
      return bigIntValue(info['tokenAmount']['amount']);
    }

    final accounts = responses[1]['value'] as List;
    return WalletBalances(
      lamports: bigIntValue(responses[0]['value']),
      wrappedSol: tokenBalance(accounts[0], market.baseMint),
      usdc: tokenBalance(accounts[1], market.quoteMint),
    );
  }

  Uint8List _accountBytes(dynamic account) {
    if (account == null) {
      throw const DataServiceException(
        'Required on-chain account does not exist',
      );
    }
    if (account['owner'] != AppConfig.programId) {
      throw const DataServiceException(
        'On-chain account belongs to an unexpected program',
      );
    }
    final data = account['data'];
    if (data is! List || data.length < 2 || data[1] != 'base64') {
      throw const DataServiceException('Unsupported on-chain account encoding');
    }
    return base64Decode(data[0] as String);
  }

  void _validateMarket(Map<String, dynamic> data) {
    if (data['baseMint'] != market.baseMint ||
        data['quoteMint'] != market.quoteMint ||
        intValue(data['id']) != market.id) {
      throw const DataServiceException(
        'On-chain market does not match the supported deployment',
      );
    }
  }

  Future<StreamingMarketState> fetchMarketState() async {
    final responses = await Future.wait([
      rpc.call('getSlot', [
        {'commitment': 'confirmed'},
      ]),
      rpc.call('getAccountInfo', [
        market.address,
        {'encoding': 'base64', 'commitment': 'confirmed'},
      ]),
    ]);
    final data = decodeMarket(_accountBytes(responses[1]['value']));
    _validateMarket(data);
    return StreamingMarketState(
      currentSlot: math.max(
        intValue(responses[0]),
        intValue(responses[1]['context']['slot']),
      ),
      market: data,
    );
  }

  Future<List<PositionRecord>> fetchPositions(String authority) =>
      _fetchPositions(authority);
  Future<List<PositionRecord>> fetchMarketPositions() => _fetchPositions(null);
  Future<List<PositionRecord>> _fetchPositions(String? authority) async {
    final dynamic response = await rpc.call('getProgramAccounts', [
      AppConfig.programId,
      {
        'encoding': 'base64',
        'commitment': 'confirmed',
        'filters': [
          {'dataSize': 312},
          {
            'memcmp': {
              'offset': 0,
              'bytes': base64Encode([37, 143, 119, 76, 200, 164, 122, 202]),
              'encoding': 'base64',
            },
          },
          {
            'memcmp': {
              'offset': 40,
              'bytes': market.address,
              'encoding': 'base58',
            },
          },
          if (authority != null)
            {
              'memcmp': {'offset': 8, 'bytes': authority, 'encoding': 'base58'},
            },
        ],
      },
    ]);
    final rows = response is List ? response : response['value'] as List;
    final positions =
        rows
            .map(
              (row) => PositionRecord(
                address: row['pubkey'] as String,
                data: decodeTradePosition(_accountBytes(row['account'])),
              ),
            )
            .where(
              (position) =>
                  position.data['market'] == market.address &&
                  (authority == null ||
                      position.data['authority'] == authority),
            )
            .toList()
          ..sort((a, b) => b.id.compareTo(a.id));
    return positions;
  }

  Future<List<IntervalAccount>> fetchOwnedIntervals(String authority) async {
    final dynamic response = await rpc.call('getProgramAccounts', [
      AppConfig.programId,
      {
        'encoding': 'base64',
        'commitment': 'confirmed',
        'filters': [
          {'dataSize': 1176},
          {
            'memcmp': {'offset': 48, 'bytes': authority, 'encoding': 'base58'},
          },
        ],
      },
    ]);
    final rows = response is List ? response : response['value'] as List;
    return rows
        .map(
          (row) => IntervalAccount(
            address: row['pubkey'] as String,
            data: decodeMarketInterval(_accountBytes(row['account'])),
            lamports: bigIntValue(row['account']['lamports']),
          ),
        )
        .where(
          (item) =>
              item.data['payer'] == authority &&
              item.data['market'] == market.address,
        )
        .toList()
      ..sort((a, b) => a.index.compareTo(b.index));
  }

  /// Read the market and interval snapshots from the same confirmed bank.
  Future<TradeSettlementSnapshot?> fetchSettlement(
    PositionRecord position, {
    int? bookkeepingLastUpdateSlot,
  }) async {
    final end = position.endSlot;
    final index = end ~/ endSlotInterval ~/ intervalArrayLength;
    final firstIndex = math.max(0, index - 1);
    final indexes = [for (var i = firstIndex; i <= index; i++) i];
    final addresses = await Future.wait(
      indexes.map(
        (i) => protocol.deriveMarketIntervalAddress(
          market.address,
          BigInt.from(i),
        ),
      ),
    );
    final dynamic response = await rpc.call('getMultipleAccounts', [
      [market.address, ...addresses],
      {'encoding': 'base64', 'commitment': 'confirmed', 'minContextSlot': end},
    ]);
    final values = response['value'] as List;
    final state = decodeMarket(_accountBytes(values.first));
    _validateMarket(state);
    final intervals = <int, Map<String, dynamic>?>{};
    for (var offset = 0; offset < indexes.length; offset++) {
      final value = values[offset + 1];
      if (value == null) {
        intervals[indexes[offset]] = null;
        continue;
      }
      final interval = decodeMarketInterval(_accountBytes(value));
      if (interval['market'] != market.address ||
          intValue(interval['index']) != indexes[offset]) {
        throw const DataServiceException(
          'The settlement snapshot does not match its market interval.',
        );
      }
      intervals[indexes[offset]] = interval;
    }
    return resolveEndSlotSettlement(
      endSlot: end,
      interval: endSlotInterval,
      intervals: intervals,
      isBuy: position.isBuy,
      market: state,
    );
  }

  void close() {
    if (_ownsHttp) _http.close();
    if (_ownsRpc) rpc.close();
  }
}

List<MarketCandle> parseCandles(List<Map<String, dynamic>> items) {
  final byTime = <int, MarketCandle>{};
  for (final item in items) {
    final rawTime = item['time'];
    if (rawTime is! num || !rawTime.isFinite) continue;
    int? time;
    for (final divisor in [1, 1000, 1000000, 1000000000]) {
      final candidate = (rawTime / divisor).floor();
      if (candidate >= 946684800 && candidate <= 4102444800) {
        time = candidate;
        break;
      }
    }
    if (time == null) continue;
    final values = [item['open'], item['high'], item['low'], item['close']];
    if (values.any(
      (v) => v is! num || !v.isFinite || v <= 0 || v.abs() > 90071992547409.91,
    )) {
      continue;
    }
    final prices = values.cast<num>().map((v) => v.toDouble()).toList();
    byTime[time] = MarketCandle(
      time: time,
      open: prices[0],
      high: prices.reduce(math.max),
      low: prices.reduce(math.min),
      close: prices[3],
    );
  }
  return byTime.values.toList()..sort((a, b) => a.time.compareTo(b.time));
}
