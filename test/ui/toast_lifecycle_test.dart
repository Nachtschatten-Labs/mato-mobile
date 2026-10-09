import 'dart:ui';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mato_mobile/ui/theme.dart';
import 'package:mato_mobile/ui/widgets.dart';

void main() {
  testWidgets(
    'replacing a toast cancels its timer and overlay teardown is safe',
    (tester) async {
      var count = 0;
      await tester.pumpWidget(
        MaterialApp(
          theme: matoTheme(),
          home: Scaffold(
            body: Builder(
              builder: (context) => TextButton(
                onPressed: () => showMatoToast(
                  context,
                  title: 'Notification ${++count}',
                  description: 'Transaction confirmed.',
                ),
                child: const Text('Notify'),
              ),
            ),
          ),
        ),
      );
      await tester.tap(find.text('Notify'));
      await tester.pump();
      await tester.pump();
      await tester.pump(const Duration(seconds: 4));
      await tester.tap(find.text('Notify'));
      await tester.pump();
      await tester.pump();
      expect(find.text('Notification 1'), findsNothing);
      expect(find.text('Notification 2'), findsOneWidget);
      await tester.pump(const Duration(seconds: 4));
      expect(find.text('Notification 2'), findsOneWidget);
      await tester.pump(const Duration(seconds: 4));
      await tester.pump();
      expect(find.text('Notification 2'), findsNothing);
      await tester.tap(find.text('Notify'));
      await tester.pump();
      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pump(const Duration(seconds: 9));
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('phone toast clears the navigation inset exactly once', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    tester.view.padding = const FakeViewPadding(bottom: 24);
    addTearDown(tester.view.reset);
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
    final surface = find.byWidgetPredicate(
      (widget) => widget is Material && widget.color == MatoColors.floating,
    );
    expect(tester.getBottomRight(surface).dy, 844 - 24 - 12);
    await tester.pumpWidget(const SizedBox.shrink());
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'toast remains held after a click while the pointer is still hovering',
    (tester) async {
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
      final mouse = await tester.createGesture(kind: PointerDeviceKind.mouse);
      await mouse.addPointer(location: const Offset(0, 0));
      await mouse.moveTo(tester.getCenter(find.text('Stream paused')));
      await tester.pump();
      await mouse.down(tester.getCenter(find.text('Stream paused')));
      await tester.pump();
      await mouse.up();
      await tester.pump(const Duration(seconds: 9));
      expect(find.text('Stream paused'), findsOneWidget);

      await mouse.moveTo(const Offset(0, 0));
      await tester.pump();
      await tester.pump(const Duration(seconds: 9));
      await tester.pump();
      expect(find.text('Stream paused'), findsNothing);
      await mouse.removePointer();
      expect(tester.takeException(), isNull);
    },
  );
}
