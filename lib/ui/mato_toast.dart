import 'dart:async';
import 'package:flutter/material.dart';
import 'theme.dart';
import 'widgets.dart' show openExplorer;

final _activeToasts = Expando<VoidCallback>();

/// Native equivalent of the v1 Sonner toast: eight seconds, status ring,
/// title/description and a transaction link. Hover and touch hold the timer.
void showMatoToast(
  BuildContext context, {
  required String title,
  required String description,
  String? signature,
  bool error = false,
  IconData? icon,
}) {
  final overlay = Overlay.of(context, rootOverlay: true);
  _activeToasts[overlay]?.call();
  late OverlayEntry entry;
  var removed = false;
  void close() {
    if (removed) return;
    removed = true;
    entry.remove();
    entry.dispose();
    _activeToasts[overlay] = null;
  }

  entry = OverlayEntry(
    builder: (_) => _MatoToast(
      title: title,
      description: description,
      signature: signature,
      error: error,
      icon: icon,
      onClose: close,
    ),
  );
  overlay.insert(entry);
  _activeToasts[overlay] = close;
}

class _MatoToast extends StatefulWidget {
  const _MatoToast({
    required this.title,
    required this.description,
    this.signature,
    required this.error,
    this.icon,
    required this.onClose,
  });
  final String title;
  final String description;
  final String? signature;
  final bool error;
  final IconData? icon;
  final VoidCallback onClose;
  @override
  State<_MatoToast> createState() => _MatoToastState();
}

class _MatoToastState extends State<_MatoToast>
    with SingleTickerProviderStateMixin {
  bool _hovered = false;
  final Set<int> _pointers = {};

  void _updateHold() {
    if (_hovered || _pointers.isNotEmpty) {
      _timer.stop();
    } else {
      _timer.forward();
    }
  }

  late final AnimationController _timer;

  @override
  void initState() {
    super.initState();
    _timer = AnimationController(
      vsync: this,
      duration: const Duration(seconds: 8),
    );
    _timer.addListener(() {
      // The controller's simulation reaches 1 at the deadline, but reports
      // completed only on a later frame. Dismiss as soon as the ring is empty.
      if (_timer.value >= 1) widget.onClose();
    });
    _timer.forward();
  }

  @override
  void dispose() {
    _timer.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final color = widget.error ? MatoColors.negative : MatoColors.positive;
    return Positioned(
      left: MediaQuery.sizeOf(context).width <= 600 ? 12 : null,
      right: 12,
      bottom: 12,
      child: SafeArea(
        top: false,
        child: SizedBox(
          width: MediaQuery.sizeOf(context).width <= 600 ? null : 380,
          child: MouseRegion(
            onEnter: (_) {
              _hovered = true;
              _updateHold();
            },
            onExit: (_) {
              _hovered = false;
              _updateHold();
            },
            child: Listener(
              onPointerDown: (event) {
                _pointers.add(event.pointer);
                _updateHold();
              },
              onPointerUp: (event) {
                _pointers.remove(event.pointer);
                _updateHold();
              },
              onPointerCancel: (event) {
                _pointers.remove(event.pointer);
                _updateHold();
              },
              child: Semantics(
                container: true,
                liveRegion: true,
                child: Material(
                  color: MatoColors.floating,
                  elevation: 12,
                  shadowColor: const Color(0xcc000000),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(8),
                    side: const BorderSide(color: MatoColors.border),
                  ),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 16,
                      vertical: 12,
                    ),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        SizedBox(
                          width: 24,
                          height: 24,
                          child: Stack(
                            alignment: Alignment.center,
                            children: [
                              AnimatedBuilder(
                                animation: _timer,
                                builder: (_, _) => CircularProgressIndicator(
                                  value: 1 - _timer.value,
                                  color: color.withValues(alpha: .45),
                                  strokeWidth: 1.5,
                                ),
                              ),
                              Icon(
                                widget.icon ??
                                    (widget.error ? Icons.close : Icons.check),
                                size: 15,
                                color: color,
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                widget.title,
                                style: const TextStyle(
                                  fontSize: 14,
                                  height: 1.4,
                                  fontWeight: FontWeight.w500,
                                  color: MatoColors.text,
                                ),
                              ),
                              const SizedBox(height: 2),
                              Text(
                                widget.description,
                                style: const TextStyle(
                                  fontSize: 14,
                                  height: 1.4,
                                  color: MatoColors.secondary,
                                ),
                              ),
                              if (widget.signature != null)
                                TextButton(
                                  onPressed: () => unawaited(
                                    openExplorer(
                                      context,
                                      widget.signature!,
                                      transaction: true,
                                    ),
                                  ),
                                  style: TextButton.styleFrom(
                                    padding: EdgeInsets.zero,
                                    alignment: Alignment.centerLeft,
                                  ),
                                  child: const Text(
                                    'View tx',
                                    style: TextStyle(
                                      decoration: TextDecoration.underline,
                                    ),
                                  ),
                                ),
                            ],
                          ),
                        ),
                        SizedBox(
                          width: 28,
                          height: 28,
                          child: IconButton(
                            padding: EdgeInsets.zero,
                            tooltip: 'Dismiss notification',
                            onPressed: widget.onClose,
                            icon: const Icon(Icons.close, size: 14),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
