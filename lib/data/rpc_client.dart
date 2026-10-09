import 'dart:convert';
import 'package:http/http.dart' as http;
import 'config.dart';

class RpcException implements Exception {
  const RpcException(this.message, {this.code, this.data});
  final String message;
  final int? code;
  final dynamic data;
  @override
  String toString() => message;
}

class RpcClient {
  RpcClient({String? url, http.Client? client})
    : url = url ?? AppConfig.defaultRpcUrl,
      _client = client ?? http.Client(),
      _ownsClient = client == null;
  final String url;
  final http.Client _client;
  final bool _ownsClient;
  int _id = 0;

  Future<dynamic> call(String method, [List<dynamic> params = const []]) async {
    final id = ++_id;
    final response = await _client
        .post(
          Uri.parse(url),
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          body: jsonEncode({
            'jsonrpc': '2.0',
            'id': id,
            'method': method,
            'params': params,
          }),
        )
        .timeout(const Duration(seconds: 25));
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw RpcException('Solana RPC request failed (${response.statusCode})');
    }
    final dynamic payload = jsonDecode(response.body);
    if (payload is! Map || payload['id'] != id) {
      throw const RpcException('Invalid Solana RPC response');
    }
    final error = payload['error'];
    if (error is Map) {
      throw RpcException(
        error['message']?.toString() ?? 'Solana RPC error',
        code: error['code'] as int?,
        data: error['data'],
      );
    }
    if (!payload.containsKey('result')) {
      throw const RpcException('Solana RPC response has no result');
    }
    return payload['result'];
  }

  Future<dynamic> request(String method, [List<dynamic> params = const []]) =>
      call(method, params);
  void close() {
    if (_ownsClient) _client.close();
  }
}
