import 'dart:convert';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:mato_mobile/protocol/generated_layouts.dart';
import 'package:mato_mobile/protocol/protocol.dart';

String _camel(String value) {
  final parts = value.split('_').where((part) => part.isNotEmpty).toList();
  final joined =
      parts.first +
      parts
          .skip(1)
          .map((part) => part[0].toUpperCase() + part.substring(1))
          .join();
  return joined[0].toLowerCase() + joined.substring(1);
}

/// This interpreter reads only Anchor IDL types. It does not use the runtime
/// codec, generated layout entries, or transaction compiler to form expectations.
class _IdlTypes {
  _IdlTypes(List<dynamic> entries)
    : types = {
        for (final entry in entries)
          entry['name'] as String: Map<String, dynamic>.from(
            entry['type'] as Map,
          ),
      };
  final Map<String, Map<String, dynamic>> types;

  int byteSize(dynamic type) {
    if (type == 'pubkey') return 32;
    if (type is String && RegExp(r'^[ui](8|16|32|64|128)$').hasMatch(type)) {
      return int.parse(type.substring(1)) ~/ 8;
    }
    if (type is Map && type['array'] != null) {
      return byteSize(type['array'][0]) * (type['array'][1] as int);
    }
    if (type is Map && type['defined'] != null) {
      final structure = types[type['defined']['name']]!;
      if (structure['kind'] == 'enum') {
        expect(
          (structure['variants'] as List).every(
            (variant) => variant['fields'] == null,
          ),
          true,
          reason:
              'The current enum representation supports fieldless variants only.',
        );
        return 1;
      }
      return (structure['fields'] as List).fold<int>(
        0,
        (size, field) => size + byteSize(field['type']),
      );
    }
    throw StateError(
      'New IDL type requires a reviewed Dart representation: $type',
    );
  }

  (String, int) representation(dynamic type) {
    if (type == 'pubkey') return ('address', 32);
    if (type is String) {
      byteSize(type);
      return (type, 1);
    }
    if (type is Map && type['array'] != null) {
      final element = type['array'][0] as String;
      return (element == 'u8' ? 'bytes' : element, type['array'][1] as int);
    }
    if (type is Map && type['defined'] != null) {
      final name = type['defined']['name'] as String;
      return types[name]!['kind'] == 'enum'
          ? ('u8', 1)
          : (_camel(name), byteSize(type));
    }
    throw StateError('Unrecognized IDL field type: $type');
  }
}

void main() {
  final idl =
      jsonDecode(File('idl/twob_anchor.json').readAsStringSync())
          as Map<String, dynamic>;
  final types = _IdlTypes(idl['types'] as List);
  final declarations = <String, Map<String, dynamic>>{
    for (final entry in [...idl['accounts'] as List, ...idl['events'] as List])
      _camel(entry['name'] as String): Map<String, dynamic>.from(entry as Map),
  };
  final idlInstructions = {
    for (final instruction in idl['instructions'] as List)
      _camel(instruction['name'] as String): instruction,
  };

  test('preserved IDL identifies the pinned deployed program', () {
    expect(idl['address'], programId);
    expect(
      (types.types['Side']!['variants'] as List)
          .map((variant) => variant['name'])
          .toList(),
      ['Sell', 'Buy'],
    );
  });

  for (final name in instructionLayouts.keys) {
    test(
      '$name argument layout, discriminator and account privileges match IDL',
      () {
        final instruction = idlInstructions[name];
        expect(
          instruction,
          isNotNull,
          reason: 'The Dart instruction must exist in the preserved IDL.',
        );
        final arguments = instruction['args'] as List;
        expect(instructionLayouts[name], [
          for (final argument in arguments)
            (
              _camel(argument['name'] as String),
              types.byteSize(argument['type']),
            ),
        ]);
        expect(instructionDiscriminators[name], instruction['discriminator']);
        final metas = instruction['accounts'] as List;
        expect(instructionAccounts[name], [
          for (final meta in metas)
            (_camel(meta['name'] as String), meta['writable'] == true),
        ]);
        final addresses = <String, String>{
          for (var i = 0; i < metas.length; i++)
            _camel(metas[i]['name'] as String): base58Encode(
              List.filled(32, i + 1),
            ),
        };
        final built = twobInstruction(name, addresses, {
          for (final argument in arguments)
            _camel(argument['name'] as String): BigInt.one,
        });
        expect(
          built.accounts
              .map((meta) => (meta.address, meta.writable, meta.signer))
              .toList(),
          [
            for (final meta in metas)
              (
                addresses[_camel(meta['name'] as String)],
                meta['writable'] == true,
                meta['signer'] == true,
              ),
          ],
        );
      },
    );
  }

  for (final name in accountLayouts.keys) {
    test(
      '$name field order, integer widths, arrays and discriminator match IDL',
      () {
        final idlName = types.types.keys.singleWhere(
          (key) => _camel(key) == name,
        );
        final structure = types.types[idlName]!;
        expect(structure['kind'], 'struct');
        final expected = <(String, String, int)>[
          if (declarations.containsKey(name)) ('discriminator', 'bytes', 8),
          for (final field in structure['fields'] as List)
            (() {
              final (kind, count) = types.representation(field['type']);
              return (_camel(field['name'] as String), kind, count);
            })(),
        ];
        expect(accountLayouts[name], expected);
        if (declarations.containsKey(name)) {
          expect(
            accountDiscriminators[name],
            declarations[name]!['discriminator'],
          );
        } else {
          expect(accountDiscriminators.containsKey(name), false);
        }
      },
    );
  }
}
