import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mato_mobile/ui/theme.dart';
import 'package:mato_mobile/ui/widgets.dart';

void main() {
  test('presentation numbers group thousands and use a typographic minus', () {
    expect(number(1234567.89), '1,234,567.89');
    expect(number(-12.345, 3), '−12.345');
    expect(number(null), '—');
    expect(number(double.infinity), '—');
  });

  testWidgets('toast shows two lines, expires at eight seconds and dismisses', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: matoTheme(),
        home: Scaffold(
          body: Builder(
            builder: (context) => TextButton(
              onPressed: () => showMatoToast(
                context,
                title: 'Stream paused',
                description: 'Nothing buys until you resume.',
              ),
              child: const Text('Pause'),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.text('Pause'));
    await tester.pump();
    await tester.pump();
    expect(find.text('Stream paused'), findsOneWidget);
    expect(find.text('Nothing buys until you resume.'), findsOneWidget);
    await tester.pump(const Duration(seconds: 7));
    expect(find.text('Stream paused'), findsOneWidget);
    await tester.pump(const Duration(seconds: 1));
    await tester.pump();
    expect(find.text('Stream paused'), findsNothing);
    await tester.tap(find.text('Pause'));
    await tester.pump();
    await tester.tap(find.byTooltip('Dismiss notification'));
    await tester.pump();
    expect(find.text('Stream paused'), findsNothing);
  });

  testWidgets('bottom sheets remain scrollable above an open keyboard', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(320, 640);
    tester.view.devicePixelRatio = 1;
    tester.view.viewInsets = const FakeViewPadding(bottom: 280);
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      MaterialApp(
        theme: matoTheme(),
        home: Scaffold(
          body: Builder(
            builder: (context) => TextButton(
              onPressed: () => showMatoSheet(
                context,
                title: 'Customize',
                child: Column(
                  children: [
                    const TextField(),
                    const SizedBox(height: 320),
                    ActionButton('Use this duration', onPressed: () {}),
                  ],
                ),
              ),
              child: const Text('Open'),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.text('Open'));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Use this duration'));
    await tester.pumpAndSettle();
    expect(
      tester.getBottomRight(find.text('Use this duration')).dy,
      lessThan(360),
    );
    expect(tester.takeException(), isNull);
  });
}
