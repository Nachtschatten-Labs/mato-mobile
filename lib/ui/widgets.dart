import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import 'theme.dart';

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
      color: MatoColors.panel,
      border: Border.all(color: MatoColors.border),
      borderRadius: BorderRadius.circular(22),
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
            ? const Color(0xff202326)
            : const Color(0xff2775ca),
      ),
      alignment: Alignment.center,
      child: symbol == 'SOL'
          ? CustomPaint(size: Size(size * .57, size * .48), painter: _SolMark())
          : Text(
              '\$',
              style: TextStyle(fontSize: size * .7, color: Colors.white),
            ),
    ),
  );
}

class _SolMark extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..shader = const LinearGradient(
        begin: Alignment.topRight,
        end: Alignment.bottomLeft,
        colors: [Color(0xff80ecb3), Color(0xffa986e8)],
      ).createShader(Offset.zero & size);
    for (var i = 0; i < 3; i++) {
      final y = i * size.height / 3;
      final inset = size.width * .15;
      final path = Path()
        ..moveTo(i == 1 ? 0 : inset, y)
        ..lineTo(i == 1 ? size.width - inset : size.width, y)
        ..lineTo(i == 1 ? size.width : size.width - inset, y + size.height * .2)
        ..lineTo(i == 1 ? inset : 0, y + size.height * .2)
        ..close();
      canvas.drawPath(path, paint);
    }
  }

  @override
  bool shouldRepaint(_SolMark oldDelegate) => false;
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
                  borderRadius: BorderRadius.circular(12),
                  child: InkWell(
                    borderRadius: BorderRadius.circular(12),
                    onTap: () => onChanged(entry.key),
                    child: Padding(
                      padding: const EdgeInsets.symmetric(vertical: 12),
                      child: Text(
                        entry.value,
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          fontSize: 15,
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
}) => showModalBottomSheet<T>(
  context: context,
  isScrollControlled: true,
  useSafeArea: true,
  showDragHandle: true,
  constraints: const BoxConstraints(maxWidth: 640),
  builder: (context) => Padding(
    padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
    child: ConstrainedBox(
      constraints: BoxConstraints(
        maxHeight: MediaQuery.sizeOf(context).height * .86,
      ),
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(24, 0, 24, 28),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              title,
              style: const TextStyle(fontSize: 23, letterSpacing: -.5),
            ),
            const SizedBox(height: 22),
            child,
          ],
        ),
      ),
    ),
  ),
);

String shortAddress(String address) => address.length < 14
    ? address
    : '${address.substring(0, 5)}…${address.substring(address.length - 5)}';
String errorText(Object error) => error.toString().replaceFirst(
  RegExp(r'^(Exception|StateError|Bad state): '),
  '',
);
String number(double? value, [int decimals = 2]) =>
    value == null || !value.isFinite ? '—' : value.toStringAsFixed(decimals);
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
