import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'theme.dart';

class MatoLogo extends StatelessWidget {
  const MatoLogo({super.key, this.width = 88});
  final double width;
  @override
  Widget build(BuildContext context) => SvgPicture.asset(
    'assets/brand/mato-logo-mint-ui.svg',
    width: width,
    height: width * 59 / 174,
    semanticsLabel: 'mato',
  );
}

/// Ambient forest light and a deterministic, subtle grain behind native widgets.
class ForestBackdrop extends StatelessWidget {
  const ForestBackdrop({super.key, required this.child});
  final Widget child;
  @override
  Widget build(BuildContext context) => DecoratedBox(
    decoration: const BoxDecoration(
      color: MatoColors.background,
      gradient: RadialGradient(
        center: Alignment(0, -.35),
        radius: 1.0,
        colors: [Color(0xff182e26), MatoColors.background],
      ),
    ),
    child: CustomPaint(painter: _GrainPainter(), child: child),
  );
}

class _GrainPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final random = math.Random(42);
    final paint = Paint()..color = const Color(0x06ffffff);
    for (var i = 0; i < size.width * size.height / 28; i++) {
      canvas.drawRect(
        Rect.fromLTWH(
          random.nextDouble() * size.width,
          random.nextDouble() * size.height,
          1,
          1,
        ),
        paint,
      );
    }
  }

  @override
  bool shouldRepaint(_GrainPainter oldDelegate) => false;
}
