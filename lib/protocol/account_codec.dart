import 'dart:typed_data';
import 'bytes.dart';
import 'generated_layouts.dart';

Map<String, dynamic> decodeMarket(Uint8List bytes) =>
    decodeAccount('market', bytes);
Map<String, dynamic> decodeTradePosition(Uint8List bytes) =>
    decodeAccount('tradePosition', bytes);
Map<String, dynamic> decodeMarketInterval(Uint8List bytes) =>
    decodeAccount('marketInterval', bytes);

/// Checked-in Codama layout, with exact integer arithmetic for all u64/u128 fields.
Map<String, dynamic> decodeAccount(String name, Uint8List bytes) {
  final reader = _Reader(bytes);
  final decoded = reader.structure(name);
  if (reader.offset != bytes.length) {
    throw FormatException('Unexpected $name account size: ${bytes.length}.');
  }
  final expected = accountDiscriminators[name];
  if (expected != null) {
    for (var i = 0; i < expected.length; i++) {
      if (bytes[i] != expected[i]) {
        throw FormatException('Invalid $name account discriminator.');
      }
    }
  }
  return decoded;
}

class _Reader {
  _Reader(this.bytes);
  final Uint8List bytes;
  int offset = 0;
  Uint8List take(int size) {
    if (offset + size > bytes.length) {
      throw const FormatException('Truncated account data.');
    }
    final value = Uint8List.sublistView(bytes, offset, offset + size);
    offset += size;
    return value;
  }

  dynamic integer(String kind) {
    final width = int.parse(kind.substring(1));
    final data = take(width ~/ 8);
    var value = BigInt.zero;
    for (var i = data.length - 1; i >= 0; i--) {
      value = (value << 8) | BigInt.from(data[i]);
    }
    if (kind.startsWith('i') && (data.last & 128) != 0) {
      value -= BigInt.one << width;
    }
    return width <= 32 ? value.toInt() : value;
  }

  Map<String, dynamic> structure(String name) {
    final result = <String, dynamic>{};
    for (final (field, kind, count) in accountLayouts[name]!) {
      result[field] = switch (kind) {
        'address' => base58Encode(take(32)),
        'bytes' => take(count),
        'bookkeepingState' => structure(kind),
        _ =>
          count == 1
              ? integer(kind)
              : List.generate(count, (_) => integer(kind)),
      };
    }
    return result;
  }
}
