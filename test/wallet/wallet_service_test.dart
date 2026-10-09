import 'dart:async';
import 'package:bs58/bs58.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mato_mobile/wallet/wallet_service.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const channel = MethodChannel('app.mato/wallet');
  const address = '11111111111111111111111111111111';
  final signature = base58.encode(Uint8List.fromList(List.filled(64, 1)));
  late WalletService wallet;
  final calls = <MethodCall>[];

  setUp(() {
    calls.clear();
    wallet = WalletService(channel: channel, supported: true);
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, (call) async {
          calls.add(call);
          return switch (call.method) {
            'restore' || 'connect' => {'address': address},
            'signAndSend' => signature,
            _ => null,
          };
        });
  });

  tearDown(() {
    wallet.dispose();
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, null);
  });

  test(
    'unsupported platforms remain read-only without invoking native code',
    () async {
      final preview = WalletService(channel: channel, supported: false);
      await preview.restore();
      expect(preview.address, isNull);
      await expectLater(preview.connect(), throwsA(isA<WalletException>()));
      expect(calls, isEmpty);
      preview.dispose();
    },
  );

  test(
    'restores only the public address and sends reviewed wire transaction',
    () async {
      await wallet.restore();
      expect(wallet.address, address);
      final bytes = Uint8List.fromList([1, 2, 3]);
      expect(
        await wallet.signAndSend(bytes, expectedAddress: address),
        signature,
      );
      expect(calls.last.arguments['expectedAddress'], address);
      expect(calls.last.arguments['transaction'], bytes);
      expect(wallet.isBusy, isFalse);
    },
  );

  test(
    'does not launch signing for an account different from the review',
    () async {
      await wallet.connect();
      await expectLater(
        wallet.signAndSend(Uint8List(100), expectedAddress: 'changed'),
        throwsA(
          isA<WalletException>().having(
            (failure) => failure.code,
            'code',
            'account_changed',
          ),
        ),
      );
      expect(calls.map((call) => call.method), ['connect']);
      expect(wallet.address, isNull);
    },
  );

  test(
    'rejects duplicate wallet operations while approval is pending',
    () async {
      final pending = Completer<Map<String, String>>();
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, (call) => pending.future);
      final connection = wallet.connect();
      expect(wallet.isBusy, isTrue);
      await expectLater(
        wallet.connect(),
        throwsA(isA<WalletException>().having((e) => e.code, 'code', 'busy')),
      );
      pending.complete({'address': address});
      await connection;
      expect(wallet.address, address);
    },
  );

  test(
    'disconnect discards a connection that completes after local invalidation',
    () async {
      final pending = Completer<Map<String, String>>();
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, (call) async {
            if (call.method == 'connect') return pending.future;
            return null;
          });
      final connection = wallet.connect();
      await wallet.disconnect();
      pending.complete({'address': address});
      await connection;
      expect(wallet.address, isNull);
    },
  );

  test(
    'invalidates expired authorization and never exposes native secrets',
    () async {
      await wallet.connect();
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, (_) async {
            throw PlatformException(
              code: 'authorization_expired',
              message: 'auth_token=secret',
            );
          });
      await expectLater(
        wallet.signAndSend(Uint8List(100), expectedAddress: address),
        throwsA(isA<WalletException>()),
      );
      expect(wallet.address, isNull);
      expect(wallet.error, isNot(contains('secret')));
      expect(wallet.isBusy, isFalse);
    },
  );

  test('cancellation does not leave an error banner', () async {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(
          channel,
          (_) async => throw PlatformException(code: 'cancelled'),
        );
    await expectLater(
      wallet.connect(),
      throwsA(
        isA<WalletException>().having(
          (e) => e.isCancellation,
          'cancelled',
          true,
        ),
      ),
    );
    expect(wallet.error, isNull);
    expect(wallet.isBusy, isFalse);
  });

  test(
    'rejects an invalid signature instead of displaying a fake receipt',
    () async {
      await wallet.connect();
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, (_) async => 'not-a-signature');
      await expectLater(
        wallet.signAndSend(Uint8List(100), expectedAddress: address),
        throwsA(
          isA<WalletException>().having(
            (e) => e.code,
            'code',
            'invalid_signature',
          ),
        ),
      );
    },
  );
}
