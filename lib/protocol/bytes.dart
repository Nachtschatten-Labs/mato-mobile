import 'dart:typed_data';

const _alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

String base58Encode(List<int> bytes) {
  var value = BigInt.zero;
  for (final byte in bytes) {
    value = (value << 8) | BigInt.from(byte);
  }
  var result = '';
  while (value > BigInt.zero) {
    final remainder = (value % BigInt.from(58)).toInt();
    result = _alphabet[remainder] + result;
    value ~/= BigInt.from(58);
  }
  for (final byte in bytes) {
    if (byte != 0) break;
    result = '1$result';
  }
  return result;
}

Uint8List base58Decode(String input) {
  if (input.isEmpty) throw const FormatException('Empty base58 value.');
  var value = BigInt.zero;
  for (final rune in input.runes) {
    final digit = _alphabet.indexOf(String.fromCharCode(rune));
    if (digit < 0) throw const FormatException('Invalid base58 value.');
    value = value * BigInt.from(58) + BigInt.from(digit);
  }
  final bytes = <int>[];
  while (value > BigInt.zero) {
    bytes.add((value & BigInt.from(255)).toInt());
    value >>= 8;
  }
  for (final rune in input.runes) {
    if (rune != 49) break;
    bytes.add(0);
  }
  return Uint8List.fromList(bytes.reversed.toList());
}

Uint8List addressBytes(String address) {
  final bytes = base58Decode(address);
  if (bytes.length != 32) {
    throw const FormatException('Invalid Solana address.');
  }
  return bytes;
}

BigInt asBigInt(dynamic value) =>
    value is BigInt ? value : BigInt.parse('$value');

Uint8List unsignedLittleEndian(BigInt value, int length) {
  if (value < BigInt.zero || value >= (BigInt.one << (length * 8))) {
    throw RangeError(
      'Value does not fit an unsigned ${length * 8}-bit integer.',
    );
  }
  return Uint8List.fromList(
    List.generate(
      length,
      (i) => ((value >> (8 * i)) & BigInt.from(255)).toInt(),
    ),
  );
}

List<int> compactLength(int value) {
  if (value < 0 || value > 0xffff) throw RangeError('Invalid compact length.');
  final result = <int>[];
  do {
    var byte = value & 0x7f;
    value >>= 7;
    if (value != 0) byte |= 0x80;
    result.add(byte);
  } while (value != 0);
  return result;
}
