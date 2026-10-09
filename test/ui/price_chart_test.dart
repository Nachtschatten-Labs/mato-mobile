import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mato_mobile/ui/price_chart.dart';
import 'package:mato_mobile/ui/theme.dart';

List<ChartPoint> _points() => List.generate(
  30,
  (index) => ChartPoint(
    time: DateTime.utc(2026, 10, 9, 12, index),
    open: 100 + index.toDouble(),
    high: 101 + index.toDouble(),
    low: 99 + index.toDouble(),
    close: 100 + index.toDouble(),
  ),
);

Future<void> _render(WidgetTester tester, Widget chart) async {
  await tester.pumpWidget(
    MaterialApp(
      theme: matoTheme(),
      home: Scaffold(
        body: Align(
          alignment: Alignment.topLeft,
          child: SizedBox(width: 300, child: chart),
        ),
      ),
    ),
  );
  await tester.pump();
}

void main() {
  testWidgets(
    'chart exposes real OHLC on selection and clears after inspection',
    (tester) async {
      ChartPoint? selected;
      await _render(
        tester,
        PriceChart(
          points: _points(),
          onCrosshairMove: (point) => selected = point,
        ),
      );
      final chart = find.byType(PriceChart);
      await tester.tapAt(tester.getTopLeft(chart) + const Offset(120, 80));
      await tester.pump();
      expect(selected, isNotNull);
      expect(selected!.high, selected!.close + 1);
      final gesture = await tester.startGesture(
        tester.getTopLeft(chart) + const Offset(160, 70),
      );
      await tester.pump(const Duration(milliseconds: 700));
      await gesture.up();
      await tester.pump();
      expect(selected, isNull);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'compact stepped history uses stream time, not evenly spaced points',
    (tester) async {
      ChartPoint? selected;
      final start = DateTime.utc(2026, 10, 9, 12);
      final points = [_points()[0], _points()[10], _points()[20]];
      await _render(
        tester,
        PriceChart(
          points: points,
          compact: true,
          stepped: true,
          startTime: start,
          endTime: start.add(const Duration(hours: 1)),
          onCrosshairMove: (point) => selected = point,
        ),
      );
      // A quarter of the full hour is minute 15, before the next update at 20.
      await tester.tapAt(
        tester.getTopLeft(find.byType(PriceChart)) + const Offset(79, 70),
      );
      await tester.pump();
      expect(selected!.time, start.add(const Duration(minutes: 10)));
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'invalid and constant prices paint safely at small phone widths',
    (tester) async {
      final time = DateTime.utc(2026);
      await _render(
        tester,
        PriceChart(
          points: [
            ChartPoint(time: time, open: double.nan, high: 1, low: 1, close: 1),
            ChartPoint(time: time, open: 100, high: 100, low: 100, close: 100),
          ],
          candles: true,
        ),
      );
      expect(
        find.bySemanticsLabel(RegExp('1 recorded prices')),
        findsOneWidget,
      );
      expect(tester.takeException(), isNull);
      await _render(tester, const PriceChart(points: []));
      expect(
        find.text('Price history will appear when market data is available.'),
        findsOneWidget,
      );
    },
  );
}
