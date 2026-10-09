import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import 'theme.dart';
export 'mato_toast.dart';

class Panel extends StatelessWidget {
  const Panel({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(20),
  });
  final Widget child;
  final EdgeInsetsGeometry padding;
  @override
  Widget build(BuildContext context) => Container(
    padding: padding,
    decoration: BoxDecoration(
      color: MatoColors.panelTranslucent,
      border: Border.all(color: MatoColors.border),
      borderRadius: BorderRadius.circular(20),
    ),
    child: child,
  );
}

class Detail extends StatelessWidget {
  const Detail(this.label, this.value, {super.key, this.color});
  final String label;
  final String value;
  final Color? color;
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 7),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(
          child: Text(
            label,
            style: const TextStyle(color: MatoColors.muted, fontSize: 13),
          ),
        ),
        const SizedBox(width: 12),
        Flexible(
          child: Text(
            value,
            textAlign: TextAlign.right,
            style: TextStyle(color: color ?? MatoColors.text, fontSize: 13),
          ),
        ),
      ],
    ),
  );
}

class Notice extends StatelessWidget {
  const Notice(this.message, {super.key, this.error = false, this.onRetry});
  final String message;
  final bool error;
  final VoidCallback? onRetry;
  @override
  Widget build(BuildContext context) => Container(
    width: double.infinity,
    margin: const EdgeInsets.symmetric(vertical: 8),
    padding: const EdgeInsets.all(14),
    decoration: BoxDecoration(
      color: (error ? MatoColors.negative : MatoColors.secondary).withValues(
        alpha: .055,
      ),
      borderRadius: BorderRadius.circular(12),
      border: Border.all(
        color: (error ? MatoColors.negative : MatoColors.secondary).withValues(
          alpha: .12,
        ),
      ),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          message,
          style: TextStyle(
            fontSize: 13,
            height: 1.5,
            color: error ? MatoColors.negative : MatoColors.secondary,
          ),
        ),
        if (onRetry != null)
          TextButton(onPressed: onRetry, child: const Text('Retry')),
      ],
    ),
  );
}

class ActionButton extends StatelessWidget {
  const ActionButton(
    this.label, {
    super.key,
    this.onPressed,
    this.busy = false,
    this.secondary = false,
  });
  final String label;
  final VoidCallback? onPressed;
  final bool busy;
  final bool secondary;
  @override
  Widget build(BuildContext context) {
    final content = Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        if (busy) ...[
          const SizedBox(
            width: 16,
            height: 16,
            child: CircularProgressIndicator(strokeWidth: 2),
          ),
          const SizedBox(width: 10),
        ],
        Flexible(child: Text(label, textAlign: TextAlign.center)),
      ],
    );
    return SizedBox(
      width: double.infinity,
      child: secondary
          ? FilledButton.tonal(
              onPressed: busy ? null : onPressed,
              style: FilledButton.styleFrom(
                backgroundColor: MatoColors.elevated,
                foregroundColor: MatoColors.secondary,
              ),
              child: content,
            )
          : FilledButton(onPressed: busy ? null : onPressed, child: content),
    );
  }
}

class TokenBadge extends StatelessWidget {
  const TokenBadge(this.symbol, {super.key, this.size = 24});
  final String symbol;
  final double size;
  @override
  Widget build(BuildContext context) => Semantics(
    label: symbol,
    child: Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: symbol == 'SOL'
            ? const Color(0xff282331)
            : symbol == 'USDC'
            ? const Color(0xff2775ca)
            : MatoColors.track,
      ),
      alignment: Alignment.center,
      child: symbol == 'SOL'
          ? CustomPaint(size: Size.square(size * .68), painter: _SolMark())
          : symbol == 'USDC'
          ? CustomPaint(
              painter: _UsdcRing(),
              child: SizedBox.square(
                dimension: size * .72,
                child: Center(
                  child: Text(
                    r'$',
                    style: TextStyle(
                      fontSize: size * 14 / 24,
                      height: 1,
                      color: Colors.white,
                    ),
                  ),
                ),
              ),
            )
          : Text(
              symbol.substring(0, 1),
              style: TextStyle(
                fontSize: size * .42,
                fontWeight: FontWeight.w500,
              ),
            ),
    ),
  );
}

class _SolMark extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    canvas.scale(size.width / 24, size.height / 24);
    const colors = [Color(0xff9ce0c4), Color(0xffb3accf), Color(0xffbd9ce8)];
    for (var i = 0; i < 3; i++) {
      final y = 5 + i * 5.5;
      final path = Path()
        ..moveTo(i == 1 ? 3 : 6, y)
        ..lineTo(i == 1 ? 17 : 20, y)
        ..lineTo(i == 1 ? 20 : 17, y + 3)
        ..lineTo(i == 1 ? 6 : 3, y + 3)
        ..close();
      canvas.drawPath(path, Paint()..color = colors[i]);
    }
  }

  @override
  bool shouldRepaint(_SolMark oldDelegate) => false;
}

class _UsdcRing extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = const Color(0xbfffffff)
      ..strokeWidth = 1
      ..style = PaintingStyle.stroke;
    final rect = (Offset.zero & size).deflate(.5);
    canvas.drawArc(rect, -math.pi / 3, 2 * math.pi / 3, false, paint);
    canvas.drawArc(rect, 2 * math.pi / 3, 2 * math.pi / 3, false, paint);
  }

  @override
  bool shouldRepaint(_UsdcRing oldDelegate) => false;
}

class PillTabs<T> extends StatelessWidget {
  const PillTabs({
    super.key,
    required this.values,
    required this.selected,
    required this.onChanged,
  });
  final Map<T, String> values;
  final T selected;
  final ValueChanged<T> onChanged;
  @override
  Widget build(BuildContext context) => Row(
    children: values.entries
        .map(
          (entry) => Expanded(
            child: Padding(
              padding: const EdgeInsets.all(3),
              child: Semantics(
                selected: selected == entry.key,
                child: Material(
                  color: selected == entry.key
                      ? MatoColors.elevated
                      : Colors.transparent,
                  borderRadius: BorderRadius.circular(40),
                  child: InkWell(
                    borderRadius: BorderRadius.circular(40),
                    onTap: () => onChanged(entry.key),
                    child: Padding(
                      padding: const EdgeInsets.symmetric(vertical: 8),
                      child: Text(
                        entry.value,
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          fontSize: 14,
                          color: selected == entry.key
                              ? MatoColors.text
                              : MatoColors.muted,
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        )
        .toList(),
  );
}

Future<T?> showMatoSheet<T>(
  BuildContext context, {
  required String title,
  required Widget child,
  bool dismissible = true,
  bool showClose = true,
}) => showModalBottomSheet<T>(
  context: context,
  isScrollControlled: true,
  isDismissible: dismissible,
  enableDrag: dismissible,
  useSafeArea: true,
  showDragHandle: dismissible,
  constraints: const BoxConstraints(maxWidth: 640),
  builder: (context) => PopScope(
    canPop: dismissible,
    child: Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: ConstrainedBox(
        constraints: BoxConstraints(
          maxHeight:
              (MediaQuery.sizeOf(context).height -
                  MediaQuery.viewInsetsOf(context).bottom) *
              .92,
        ),
        child: SingleChildScrollView(
          padding: EdgeInsets.fromLTRB(
            20,
            dismissible ? 0 : 24,
            20,
            20 + MediaQuery.paddingOf(context).bottom,
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            mainAxisSize: MainAxisSize.min,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(
                      title,
                      style: const TextStyle(fontSize: 16, letterSpacing: -.2),
                    ),
                  ),
                  if (showClose && dismissible)
                    IconButton(
                      tooltip: 'Close',
                      onPressed: () => Navigator.pop(context),
                      icon: const Icon(Icons.close, size: 18),
                    ),
                ],
              ),
              const SizedBox(height: 16),
              child,
            ],
          ),
        ),
      ),
    ),
  ),
);

String shortAddress(String address) => address.length < 14
    ? address
    : '${address.substring(0, 4)}…${address.substring(address.length - 4)}';
String errorText(Object error) => error.toString().replaceFirst(
  RegExp(r'^(Exception|StateError|Bad state): '),
  '',
);
String number(double? value, [int decimals = 2]) {
  if (value == null || !value.isFinite) return '—';
  final parts = value.abs().toStringAsFixed(decimals).split('.');
  final whole = parts.first.replaceAllMapped(
    RegExp(r'\B(?=(\d{3})+(?!\d))'),
    (_) => ',',
  );
  return '${value < 0 ? '−' : ''}$whole${parts.length == 2 ? '.${parts.last}' : ''}';
}

String durationText(num seconds) {
  if (seconds < 60) return '${seconds.ceil()} sec';
  if (seconds < 3600) return '${(seconds / 60).ceil()} min';
  if (seconds < 86400) {
    return '${(seconds / 3600).floor()} h${seconds % 3600 >= 60 ? ' ${((seconds % 3600) / 60).floor()} min' : ''}';
  }
  if (seconds >= 31536000) return '1 year';
  return '${(seconds / 86400).ceil()} days';
}

Future<void> openExplorer(
  BuildContext context,
  String id, {
  bool transaction = false,
}) async {
  final uri = Uri.https(
    'explorer.solana.com',
    '/${transaction ? 'tx' : 'address'}/$id',
  );
  try {
    if (!await launchUrl(uri, mode: LaunchMode.externalApplication)) {
      throw Exception('Could not open Explorer.');
    }
  } catch (error) {
    if (context.mounted) {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(errorText(error))));
    }
  }
}
