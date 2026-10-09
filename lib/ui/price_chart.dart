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

/// A native chart with the v1 market chart's area/candle modes, crosshair,
/// price guides and touch viewport. Compact charts share the same real data but
/// show the stepped market history used inside an expanded stream.
class PriceChart extends StatefulWidget {
  const PriceChart({
    super.key,
    required this.points,
    this.candles = false,
    this.reference,
    this.height = 210,
    this.compact = false,
    this.stepped = false,
    this.paused = false,
    this.startTime,
    this.endTime,
    this.onCrosshairMove,
    this.resetSignal = 0,
  });
  final List<ChartPoint> points;
  final bool candles;
  final double? reference;
  final double height;
  final bool compact;
  final bool stepped;
  final bool paused;
  final DateTime? startTime;
  final DateTime? endTime;
  final ValueChanged<ChartPoint?>? onCrosshairMove;
  final int resetSignal;
  @override
  State<PriceChart> createState() => _PriceChartState();
}

class _PriceChartState extends State<PriceChart> {
  int? _selected;
  double _zoom = 1;
  double _offset = 0;
  double _gestureZoom = 1;
  double _gestureOffset = 0;
  Offset _gestureFocal = Offset.zero;

  @override
  void didUpdateWidget(PriceChart oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.resetSignal != widget.resetSignal ||
        (oldWidget.points.isNotEmpty && widget.points.isEmpty)) {
      _zoom = 1;
      _offset = 0;
      _selected = null;
    }
  }

  void _select(int? index, List<ChartPoint> points) {
    if (_selected == index) return;
    setState(() => _selected = index);
    widget.onCrosshairMove?.call(index == null ? null : points[index]);
  }

  @override
  Widget build(BuildContext context) {
    // The repository validates the response too. Keep painter arithmetic safe
    // when a chart is built independently or a partial data refresh arrives.
    final points = widget.points
        .where(
          (point) =>
              point.open.isFinite &&
              point.high.isFinite &&
              point.low.isFinite &&
              point.close.isFinite &&
              point.open > 0 &&
              point.high > 0 &&
              point.low > 0 &&
              point.close > 0,
        )
        .toList();
    if (points.isEmpty) {
      return SizedBox(
        height: widget.height,
        child: const Center(
          child: Text(
            'Price history will appear when market data is available.',
            textAlign: TextAlign.center,
            style: TextStyle(color: MatoColors.muted, fontSize: 12),
          ),
        ),
      );
    }
    final selected = _selected?.clamp(0, points.length - 1);
    return Semantics(
      label:
          'SOL/USDC ${widget.candles ? 'candlestick' : 'price'} chart, ${points.length} recorded prices. Latest ${number(points.last.close)} USDC.',
      child: LayoutBuilder(
        builder: (context, constraints) {
          final plot = _plotRect(
            Size(constraints.maxWidth, widget.height),
            widget.compact,
          );
          final view = _ChartViewport(points.length, _zoom, _offset);
          void select(Offset position) {
            final fraction = ((position.dx - plot.left) / plot.width).clamp(
              0.0,
              1.0,
            );
            int index;
            if (widget.compact) {
              final start = widget.startTime ?? points.first.time;
              final end = widget.endTime ?? points.last.time;
              final time =
                  start.millisecondsSinceEpoch +
                  (end.millisecondsSinceEpoch - start.millisecondsSinceEpoch) *
                      fraction;
              index = 0;
              // A stepped price remains at its previous value until the next
              // actual observation, rather than borrowing a future market price.
              for (var i = 0; i < points.length; i++) {
                if (points[i].time.millisecondsSinceEpoch <= time) index = i;
              }
            } else {
              index = (view.from + fraction * view.span).round().clamp(
                0,
                points.length - 1,
              );
            }
            _select(index, points);
          }

          return MouseRegion(
            onHover: (event) => select(event.localPosition),
            onExit: (_) => _select(null, points),
            child: GestureDetector(
              behavior: HitTestBehavior.opaque,
              onTapDown: (details) => select(details.localPosition),
              onLongPressStart: (details) => select(details.localPosition),
              onLongPressMoveUpdate: (details) => select(details.localPosition),
              onLongPressEnd: (_) => _select(null, points),
              onScaleStart: widget.compact
                  ? null
                  : (details) {
                      _gestureZoom = _zoom;
                      _gestureOffset = _offset;
                      _gestureFocal = details.localFocalPoint;
                      _select(null, points);
                    },
              onScaleUpdate: widget.compact
                  ? null
                  : (details) {
                      final zoom = (_gestureZoom * details.scale)
                          .clamp(1.0, math.max(1.0, points.length / 5))
                          .toDouble();
                      final fraction =
                          ((_gestureFocal.dx - plot.left) / plot.width).clamp(
                            0.0,
                            1.0,
                          );
                      final previous = _ChartViewport(
                        points.length,
                        _gestureZoom,
                        _gestureOffset,
                      );
                      final next = _ChartViewport(points.length, zoom, 0);
                      final anchored =
                          previous.from +
                          fraction * previous.span -
                          fraction * next.span;
                      final dragged =
                          (details.localFocalPoint.dx - _gestureFocal.dx) /
                          plot.width *
                          next.span;
                      setState(() {
                        _zoom = zoom;
                        _offset = (anchored - dragged).clamp(
                          0.0,
                          next.maxOffset,
                        );
                      });
                    },
              child: SizedBox(
                height: widget.height,
                child: ClipRect(
                  child: CustomPaint(
                    painter: _ChartPainter(
                      points: points,
                      candles: widget.candles,
                      selected: selected,
                      reference: widget.reference,
                      compact: widget.compact,
                      stepped: widget.stepped,
                      paused: widget.paused,
                      startTime: widget.startTime,
                      endTime: widget.endTime,
                      view: view,
                    ),
                  ),
                ),
              ),
            ),
          );
        },
      ),
    );
  }
}

Rect _plotRect(Size size, bool compact) => Rect.fromLTWH(
  compact ? 8 : 0,
  12,
  math.max(1, size.width - (compact ? 16 : 54)),
  math.max(1, size.height - (compact ? 24 : 40)),
);

class _ChartViewport {
  _ChartViewport(int length, double zoom, double offset) {
    final total = math.max(1.0, length - 1 + math.min(8, length * .08));
    span = total / zoom;
    maxOffset = math.max(0, total - span);
    from = offset.clamp(0.0, maxOffset);
  }
  late final double from, span, maxOffset;
}

class _ChartPainter extends CustomPainter {
  _ChartPainter({
    required this.points,
    required this.candles,
    required this.selected,
    required this.reference,
    required this.compact,
    required this.stepped,
    required this.paused,
    required this.startTime,
    required this.endTime,
    required this.view,
  });
  final List<ChartPoint> points;
  final bool candles, compact, stepped, paused;
  final int? selected;
  final double? reference;
  final DateTime? startTime, endTime;
  final _ChartViewport view;

  @override
  void paint(Canvas canvas, Size size) {
    if (points.isEmpty) return;
    final plot = _plotRect(size, compact);
    final visible = compact
        ? points
        : points.sublist(
            view.from.floor().clamp(0, points.length - 1),
            (view.from + view.span + 2).ceil().clamp(1, points.length),
          );
    var low = visible
        .map(
          (p) => candles ? math.min(p.low, math.min(p.open, p.close)) : p.close,
        )
        .reduce(math.min);
    var high = visible
        .map(
          (p) =>
              candles ? math.max(p.high, math.max(p.open, p.close)) : p.close,
        )
        .reduce(math.max);
    if (reference != null && reference!.isFinite) {
      low = math.min(low, reference!);
      high = math.max(high, reference!);
    }
    final padding = math.max(
      (high - low) * .16,
      math.max(high.abs() * .0001, .00001),
    );
    low -= padding;
    high += padding;
    double x(int index) {
      if (!compact) {
        return plot.left + (index - view.from) / view.span * plot.width;
      }
      final start = (startTime ?? points.first.time).millisecondsSinceEpoch;
      final end = (endTime ?? points.last.time).millisecondsSinceEpoch;
      if (end <= start) return plot.left + plot.width / 2;
      return plot.left +
          (points[index].time.millisecondsSinceEpoch - start) /
              (end - start) *
              plot.width;
    }

    double y(double value) =>
        plot.bottom - (value - low) / (high - low) * plot.height;

    TextPainter text(
      String value, {
      Color color = MatoColors.faint,
      double fontSize = 10,
    }) => TextPainter(
      text: TextSpan(
        text: value,
        style: TextStyle(
          fontFamily: 'IBMPlexSans',
          fontSize: fontSize,
          color: color,
        ),
      ),
      textDirection: TextDirection.ltr,
    )..layout();
    void label(
      String value,
      Offset position, {
      Color color = MatoColors.faint,
    }) {
      text(value, color: color).paint(canvas, position);
    }

    void dashes(
      Offset from,
      Offset to,
      Color color, {
      double dash = 3,
      double gap = 4,
    }) {
      final delta = to - from;
      final length = delta.distance;
      if (length == 0) return;
      final unit = delta / length;
      final paint = Paint()
        ..color = color
        ..strokeWidth = 1;
      for (double distance = 0; distance < length; distance += dash + gap) {
        canvas.drawLine(
          from + unit * distance,
          from + unit * math.min(distance + dash, length),
          paint,
        );
      }
    }

    void priceLabel(double value, Color background, Color foreground) {
      final yy = y(value).clamp(plot.top + 8, plot.bottom - 8);
      final tp = text(number(value), color: foreground);
      final rect = Rect.fromLTWH(
        plot.right + 1,
        yy - 10,
        size.width - plot.right - 1,
        20,
      );
      canvas.drawRRect(
        RRect.fromRectAndRadius(rect, const Radius.circular(2)),
        Paint()..color = background,
      );
      tp.paint(canvas, Offset(rect.left + 4, yy - tp.height / 2));
    }

    if (!compact) {
      for (var i = 0; i <= 3; i++) {
        final yy = plot.top + plot.height * i / 3;
        canvas.drawLine(
          Offset(plot.left, yy),
          Offset(plot.right, yy),
          Paint()..color = MatoColors.accent.withValues(alpha: .04),
        );
        label(
          number(high - (high - low) * i / 3),
          Offset(plot.right + 6, yy - 6),
        );
      }
      for (var i = 0; i <= 4; i++) {
        final xx = plot.left + plot.width * i / 4;
        canvas.drawLine(
          Offset(xx, plot.top),
          Offset(xx, plot.bottom),
          Paint()..color = MatoColors.accent.withValues(alpha: .03),
        );
      }
      final axisPaint = Paint()..color = MatoColors.border;
      canvas.drawLine(
        Offset(plot.right, 0),
        Offset(plot.right, size.height),
        axisPaint,
      );
      canvas.drawLine(
        Offset(plot.left, plot.bottom),
        Offset(plot.right, plot.bottom),
        axisPaint,
      );
    }

    canvas.save();
    canvas.clipRect(plot.inflate(.5));
    if (reference != null && reference!.isFinite) {
      dashes(
        Offset(plot.left, y(reference!)),
        Offset(plot.right, y(reference!)),
        MatoColors.axis,
        dash: 4,
        gap: 5,
      );
    }
    if (candles) {
      final width = (plot.width / view.span * .65).clamp(1.0, 12.0);
      for (var i = 0; i < points.length; i++) {
        if (x(i) < plot.left - width || x(i) > plot.right + width) continue;
        final point = points[i];
        final paint = Paint()
          ..color = point.close >= point.open
              ? MatoColors.positive
              : MatoColors.negative
          ..strokeWidth = 1;
        canvas.drawLine(
          Offset(
            x(i),
            y(math.max(point.high, math.max(point.open, point.close))),
          ),
          Offset(
            x(i),
            y(math.min(point.low, math.min(point.open, point.close))),
          ),
          paint,
        );
        canvas.drawRect(
          Rect.fromLTRB(
            x(i) - width / 2,
            math.min(y(point.open), y(point.close)),
            x(i) + width / 2,
            math.max(y(point.open), y(point.close)) + 1,
          ),
          paint,
        );
      }
    } else {
      final path = Path()..moveTo(x(0), y(points.first.close));
      for (var i = 1; i < points.length; i++) {
        if (stepped) path.lineTo(x(i), y(points[i - 1].close));
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
              MatoColors.action.withValues(alpha: .22),
              MatoColors.action.withValues(alpha: 0),
            ],
          ).createShader(plot),
      );
      canvas.drawPath(
        path,
        Paint()
          ..color = MatoColors.action
          ..strokeWidth = 2
          ..strokeJoin = StrokeJoin.round
          ..strokeCap = StrokeCap.round
          ..style = PaintingStyle.stroke,
      );
      if (compact || points.length == 1) {
        final head = Offset(x(points.length - 1), y(points.last.close));
        canvas.drawCircle(
          head,
          4,
          Paint()..color = paused ? MatoColors.background : MatoColors.action,
        );
        if (paused) {
          canvas.drawCircle(
            head,
            4,
            Paint()
              ..color = MatoColors.action
              ..style = PaintingStyle.stroke
              ..strokeWidth = 1.5,
          );
        }
      }
    }
    final last = points.last;
    final lastColor = candles
        ? (last.close >= last.open ? MatoColors.positive : MatoColors.negative)
        : MatoColors.action;
    if (!compact && y(last.close) >= plot.top && y(last.close) <= plot.bottom) {
      dashes(
        Offset(plot.left, y(last.close)),
        Offset(plot.right, y(last.close)),
        lastColor,
        dash: 2,
        gap: 3,
      );
    }
    if (selected != null) {
      final index = selected!.clamp(0, points.length - 1);
      final xx = x(index), yy = y(points[index].close);
      dashes(Offset(xx, plot.top), Offset(xx, plot.bottom), MatoColors.faint);
      if (!compact) {
        dashes(Offset(plot.left, yy), Offset(plot.right, yy), MatoColors.faint);
      }
      canvas.drawCircle(Offset(xx, yy), 4, Paint()..color = MatoColors.action);
      canvas.drawCircle(
        Offset(xx, yy),
        4,
        Paint()
          ..color = MatoColors.background
          ..style = PaintingStyle.stroke
          ..strokeWidth = 1.5,
      );
    }
    canvas.restore();

    if (!compact) {
      if (y(last.close) >= plot.top && y(last.close) <= plot.bottom) {
        priceLabel(last.close, lastColor, MatoColors.buttonInk);
      }
      final firstIndex = view.from.ceil().clamp(0, points.length - 1);
      final lastIndex = (view.from + view.span).floor().clamp(
        0,
        points.length - 1,
      );
      final range = points[lastIndex].time.difference(points[firstIndex].time);
      String tick(DateTime date) {
        final local = date.toLocal();
        return range.inHours >= 48
            ? '${local.month}/${local.day}'
            : '${local.hour.toString().padLeft(2, '0')}:${local.minute.toString().padLeft(2, '0')}';
      }

      for (var tickIndex = 0; tickIndex < 3; tickIndex++) {
        final index = (firstIndex + (lastIndex - firstIndex) * tickIndex / 2)
            .round();
        final tp = text(tick(points[index].time));
        tp.paint(
          canvas,
          Offset(
            (x(index) - tp.width / 2).clamp(
              plot.left,
              math.max(plot.left, plot.right - tp.width),
            ),
            plot.bottom + 8,
          ),
        );
      }
      if (selected != null) {
        final index = selected!.clamp(0, points.length - 1);
        priceLabel(points[index].close, MatoColors.track, MatoColors.text);
        final local = points[index].time.toLocal();
        const months = [
          'Jan',
          'Feb',
          'Mar',
          'Apr',
          'May',
          'Jun',
          'Jul',
          'Aug',
          'Sep',
          'Oct',
          'Nov',
          'Dec',
        ];
        final tp = text(
          '${months[local.month - 1]} ${local.day}, ${local.hour.toString().padLeft(2, '0')}:${local.minute.toString().padLeft(2, '0')}',
          color: MatoColors.text,
        );
        final left = (x(index) - (tp.width + 12) / 2)
            .clamp(0.0, math.max(0.0, plot.right - tp.width - 12))
            .toDouble();
        final rect = Rect.fromLTWH(left, plot.bottom + 3, tp.width + 12, 23);
        canvas.drawRRect(
          RRect.fromRectAndRadius(rect, const Radius.circular(3)),
          Paint()..color = MatoColors.track,
        );
        tp.paint(
          canvas,
          Offset(left + 6, rect.top + (rect.height - tp.height) / 2),
        );
      }
    }
  }

  @override
  bool shouldRepaint(_ChartPainter old) =>
      old.points != points ||
      old.candles != candles ||
      old.selected != selected ||
      old.reference != reference ||
      old.compact != compact ||
      old.stepped != stepped ||
      old.paused != paused ||
      old.startTime != startTime ||
      old.endTime != endTime ||
      old.view.from != view.from ||
      old.view.span != view.span;
}
