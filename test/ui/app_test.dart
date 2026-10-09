import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mato_mobile/data/config.dart';
import 'package:mato_mobile/data/market_repository.dart';
import 'package:mato_mobile/domain/models.dart';
import 'package:mato_mobile/main.dart';
import 'package:mato_mobile/protocol/account_codec.dart';
import 'package:mato_mobile/state/app_controller.dart';
import 'package:mato_mobile/wallet/wallet_service.dart';

class PreviewRepository extends MarketRepository {
  PreviewRepository({this.fail = false});
  final bool fail;
  @override
  Future<StreamingMarketState> fetchMarketState() async {
    if (fail) throw Exception('Offline');
    final json = jsonDecode(
      File('test/protocol/fixtures/mainnet-market.json').readAsStringSync(),
    );
    return StreamingMarketState(
      currentSlot: json['slot'] as int,
      market: decodeMarket(base64Decode(json['account']['data'][0] as String)),
    );
  }

  @override
  Future<MarketPriceSnapshot> fetchPrice() async {
    if (fail) throw Exception('Offline');
    return const MarketPriceSnapshot(price: 150, slot: 453870292);
  }

  @override
  Future<List<MarketCandle>> fetchCandles({
    required DateTime from,
    required DateTime to,
    required String interval,
    int maxPoints = 1500,
  }) async => fail
      ? throw Exception('Offline')
      : List.generate(
          5,
          (i) => MarketCandle(
            time: 1700000000 + i * 60,
            open: 148 + i * .5,
            high: 150 + i * .5,
            low: 147 + i * .5,
            close: 148 + i * .5,
          ),
        );
}

Future<AppController> pumpApp(
  WidgetTester tester, {
  bool fail = false,
  WalletService? wallet,
  double width = 390,
}) async {
  tester.view.physicalSize = Size(width, 844);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  final controller = AppController(
    config: const AppConfig(),
    repository: PreviewRepository(fail: fail),
    wallet: wallet ?? WalletService(supported: false),
  );
  await tester.pumpWidget(
    MatoApp(controller: controller, showOnboarding: false),
  );
  await tester.pumpAndSettle();
  return controller;
}

void main() {
  testWidgets(
    'phone trade form preserves exact input and resets on side change',
    (tester) async {
      await pumpApp(tester);
      expect(find.bySemanticsLabel('mato'), findsOneWidget);
      expect(find.text('Open on Android to connect'), findsOneWidget);
      await tester.enterText(find.byType(TextField), '123.456789');
      await tester.pump();
      expect(find.text('123.456789'), findsOneWidget);
      await tester.tap(find.text('Sell').first);
      await tester.pump();
      expect(
        tester.widget<TextField>(find.byType(TextField)).controller!.text,
        '',
      );
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );

  testWidgets('small phone can customize duration without overflow', (
    tester,
  ) async {
    await pumpApp(tester, width: 320);
    await tester.enterText(find.byType(TextField), '100');
    await tester.pump();
    final customize = find.bySemanticsLabel(RegExp(r'^Customize duration:'));
    await tester.ensureVisible(customize);
    await tester.tap(customize);
    await tester.pumpAndSettle();
    expect(find.text('Customize duration'), findsOneWidget);
    final use = find.ancestor(
      of: find.textContaining(RegExp(r'^Use ')),
      matching: find.byType(FilledButton),
    );
    await tester.ensureVisible(use);
    await tester.tap(use);
    await tester.pumpAndSettle();
    expect(find.text('Customize duration'), findsNothing);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox.shrink());
  });

  testWidgets('service outage stays explicit and never fabricates a price', (
    tester,
  ) async {
    await pumpApp(tester, fail: true);
    expect(
      find.textContaining('On-chain market data is unavailable'),
      findsOneWidget,
    );
    expect(find.text('1 SOL ≈ — USDC'), findsOneWidget);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox.shrink());
  });

  testWidgets('wallet restore failure still loads public market data', (
    tester,
  ) async {
    const channel = MethodChannel('test/mato-restore');
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(
          channel,
          (_) async => throw PlatformException(code: 'storage_error'),
        );
    final app = await pumpApp(
      tester,
      wallet: WalletService(channel: channel, supported: true),
    );
    expect(app.currentPrice, 150);
    expect(app.errors['wallet'], isNotNull);
    await tester.pumpWidget(const SizedBox.shrink());
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, null);
  });
}
