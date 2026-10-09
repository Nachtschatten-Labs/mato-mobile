import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mato_mobile/data/config.dart';
import 'package:mato_mobile/main.dart';
import 'package:mato_mobile/state/app_controller.dart';
import 'package:mato_mobile/wallet/wallet_service.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'app_test.dart' show PreviewRepository;

const _riskKey = 'mato-risk-disclaimer-accepted';
String _today() => DateTime.now().toUtc().toIso8601String().substring(0, 10);

Future<void> _openApp(WidgetTester tester) async {
  await tester.pumpWidget(
    MatoApp(
      key: UniqueKey(),
      controller: AppController(
        config: const AppConfig(),
        repository: PreviewRepository(),
        wallet: WalletService(supported: false),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  testWidgets(
    'risk acknowledgement requires explicit acceptance and persists for today',
    (tester) async {
      SharedPreferences.setMockInitialValues({});
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      await _openApp(tester);
      expect(find.text('Experimental Protocol'), findsOneWidget);
      expect(find.byTooltip('Close'), findsNothing);
      expect(
        (await SharedPreferences.getInstance()).getString(_riskKey),
        isNull,
      );

      await tester.tapAt(const Offset(10, 80));
      await tester.pumpAndSettle();
      expect(find.text('Experimental Protocol'), findsOneWidget);
      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();
      expect(find.text('Experimental Protocol'), findsOneWidget);
      expect(
        (await SharedPreferences.getInstance()).getString(_riskKey),
        isNull,
      );

      await tester.tap(find.text('I understand the risks'));
      await tester.pumpAndSettle();
      expect(find.text('Experimental Protocol'), findsNothing);
      expect(
        (await SharedPreferences.getInstance()).getString(_riskKey),
        _today(),
      );
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());

      await _openApp(tester);
      expect(find.text('Experimental Protocol'), findsNothing);
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );

  testWidgets('a prior day acknowledgement is renewed before trading', (
    tester,
  ) async {
    SharedPreferences.setMockInitialValues({_riskKey: '2000-01-01'});
    await _openApp(tester);
    expect(find.text('Experimental Protocol'), findsOneWidget);
    await tester.tap(find.text('I understand the risks'));
    await tester.pumpAndSettle();
    expect(
      (await SharedPreferences.getInstance()).getString(_riskKey),
      _today(),
    );
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox.shrink());
  });
}
