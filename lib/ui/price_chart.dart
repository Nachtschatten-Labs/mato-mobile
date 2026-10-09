import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'theme.dart';
import 'widgets.dart';

class ChartPoint {
  const ChartPoint({
    required this.time,
    required this.open,
    required this.high,
    required this.low,
    required this.close,
  });
  final DateTime time;
  final double open, high, low, close;
}

class PriceChart extends StatefulWidget {
  const PriceChart({
    super.key,
    required this.points,
    this.candles = false,
    this.reference,
    this.height = 210,
  });
  final List<ChartPoint> points;
  final bool candles;
  final double? reference;
  final double height;
  @override
  State<PriceChart> createState() => _PriceChartState();
}

class _PriceChartState extends State<PriceChart> {
  int? selected;
  @override
  Widget build(BuildContext context) {
    if (widget.points.isEmpty) {
      return SizedBox(
        height: widget.height,
        child: const Center(
          child: Text(
            'No recorded prices in this range.',
            style: TextStyle(color: MatoColors.muted),
          ),
        ),
      );
    }
    final point = selected == null
        ? null
        : widget.points[selected!.clamp(0, widget.points.length - 1)];
    return Semantics(
      label:
          'SOL price chart, ${widget.points.length} recorded prices. Latest ${number(widget.points.last.close)} USDC.',
      child: LayoutBuilder(
        builder: (context, constraints) {
          void select(Offset position) => setState(
            () => selected =
                ((position.dx / math.max(1, constraints.maxWidth - 48)) *
                        (widget.points.length - 1))
                    .round()
                    .clamp(0, widget.points.length - 1),
          );
          return GestureDetector(
            onTapDown: (details) => select(details.localPosition),
            onLongPressMoveUpdate: (details) => select(details.localPosition),
            onLongPressStart: (details) => select(details.localPosition),
            onLongPressEnd: (_) => setState(() => selected = null),
            child: SizedBox(
              height: widget.height,
              child: Stack(
                children: [
                  Positioned.fill(
                    child: CustomPaint(
                      painter: _ChartPainter(
                        widget.points,
                        widget.candles,
                        selected,
                        widget.reference,
                      ),
                    ),
                  ),
                  if (point != null)
                    Positioned(
                      top: 2,
                      left: 4,
                      child: Container(
                        color: MatoColors.panel,
                        padding: const EdgeInsets.all(6),
                        child: Text(
                          '${number(point.close)} USDC  ·  ${point.time.toLocal().toString().substring(5, 16)}',
                          style: const TextStyle(
                            color: MatoColors.secondary,
                            fontSize: 11,
                          ),
                        ),
                      ),
                    ),
                ],
              ),
            ),
          );
        },
      ),
    );
  }
}

class _ChartPainter extends CustomPainter {
  _ChartPainter(this.points, this.candles, this.selected, this.reference);
  final List<ChartPoint> points;
  final bool candles;
  final int? selected;
  final double? reference;
  @override
  void paint(Canvas canvas, Size size) {
    if (points.isEmpty) return;
    var low = points.map((p) => candles ? p.low : p.close).reduce(math.min);
    var high = points.map((p) => candles ? p.high : p.close).reduce(math.max);
    if (reference != null && reference!.isFinite) {
      low = math.min(low, reference!);
      high = math.max(high, reference!);
    }
    final padding = math.max((high - low) * .14, high.abs() * .0001);
    low -= padding;
    high += padding;
    final plot = Rect.fromLTWH(
      0,
      24,
      math.max(1, size.width - 47),
      size.height - 48,
    );
    double x(int i) =>
        plot.left +
        (points.length == 1
            ? plot.width / 2
            : i * plot.width / (points.length - 1));
    double y(double value) =>
        plot.bottom - (value - low) / (high - low) * plot.height;
    void label(String text, Offset at) {
      final tp = TextPainter(
        text: TextSpan(
          text: text,
          style: const TextStyle(
            fontFamily: 'IBMPlexSans',
            fontSize: 10,
            color: MatoColors.faint,
          ),
        ),
        textDirection: TextDirection.ltr,
      )..layout();
      tp.paint(canvas, at);
    }

    final grid = Paint()
      ..color = const Color(0x0dffffff)
      ..strokeWidth = 1;
    for (var i = 0; i <= 3; i++) {
      final yy = plot.top + plot.height * i / 3;
      canvas.drawLine(Offset(0, yy), Offset(plot.right, yy), grid);
      label(
        number(high - (high - low) * i / 3),
        Offset(plot.right + 6, yy - 6),
      );
    }
    for (var i = 0; i <= 4; i++) {
      final xx = plot.width * i / 4;
      canvas.drawLine(Offset(xx, plot.top), Offset(xx, plot.bottom), grid);
    }
    if (reference != null && reference!.isFinite) {
      final yy = y(reference!);
      for (double xx = 0; xx < plot.width; xx += 8) {
        canvas.drawLine(
          Offset(xx, yy),
          Offset(math.min(xx + 4, plot.width), yy),
          Paint()..color = MatoColors.secondary.withValues(alpha: .5),
        );
      }
    }
    if (candles) {
      final width = (plot.width / points.length * .65).clamp(1.0, 9.0);
      for (var i = 0; i < points.length; i++) {
        final p = points[i];
        final paint = Paint()
          ..color = p.close >= p.open ? MatoColors.positive : MatoColors.orange
          ..strokeWidth = 1;
        canvas.drawLine(Offset(x(i), y(p.high)), Offset(x(i), y(p.low)), paint);
        canvas.drawRect(
          Rect.fromLTRB(
            x(i) - width / 2,
            math.min(y(p.open), y(p.close)),
            x(i) + width / 2,
            math.max(y(p.open), y(p.close)) + 1,
          ),
          paint,
        );
      }
    } else {
      final path = Path()..moveTo(x(0), y(points.first.close));
      for (var i = 1; i < points.length; i++) {
        path.lineTo(x(i), y(points[i].close));
      }
      final fill = Path.from(path)
        ..lineTo(x(points.length - 1), plot.bottom)
        ..lineTo(x(0), plot.bottom)
        ..close();
      canvas.drawPath(
        fill,
        Paint()
          ..shader = LinearGradient(
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
            colors: [
              MatoColors.orange.withValues(alpha: .16),
              MatoColors.orange.withValues(alpha: 0),
            ],
          ).createShader(plot),
      );
      canvas.drawPath(
        path,
        Paint()
          ..color = MatoColors.orange
          ..strokeWidth = 1.7
          ..style = PaintingStyle.stroke,
      );
      canvas.drawCircle(
        Offset(x(points.length - 1), y(points.last.close)),
        3,
        Paint()..color = MatoColors.orange,
      );
    }
    if (selected != null) {
      final i = selected!.clamp(0, points.length - 1);
      canvas.drawLine(
        Offset(x(i), plot.top),
        Offset(x(i), plot.bottom),
        Paint()..color = MatoColors.secondary.withValues(alpha: .4),
      );
      canvas.drawCircle(
        Offset(x(i), y(points[i].close)),
        4,
        Paint()..color = MatoColors.text,
      );
    }
    String time(DateTime t) =>
        '${t.toLocal().hour.toString().padLeft(2, '0')}:${t.toLocal().minute.toString().padLeft(2, '0')}';
    label(time(points.first.time), Offset(0, plot.bottom + 8));
    label(
      time(points.last.time),
      Offset(math.max(0, plot.width - 30), plot.bottom + 8),
    );
  }

  @override
  bool shouldRepaint(_ChartPainter old) =>
      old.points != points ||
      old.candles != candles ||
      old.selected != selected ||
      old.reference != reference;
}
