import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mato_mobile/main.dart';
import 'app_test.dart' show pumpApp;

void main() {
  setUpAll(() async {
    final font = FontLoader('IBMPlexSans')
      ..addFont(rootBundle.load('assets/fonts/IBMPlexSans-Regular.ttf'))
      ..addFont(rootBundle.load('assets/fonts/IBMPlexSans-Medium.ttf'));
    await font.load();
    final icons = FontLoader('MaterialIcons')
      ..addFont(rootBundle.load('fonts/MaterialIcons-Regular.otf'));
    await icons.load();
  });

  for (final width in [320.0, 390.0]) {
    testWidgets('Dark Forest trade at ${width.toInt()}px', (tester) async {
      await pumpApp(tester, width: width);
      // Font rasterization differs between the Linux CI and macOS Skia hosts.
      // Keep exact pixel comparisons against reviewed baselines for each host.
      final goldenDirectory = Platform.isLinux ? 'goldens/linux' : 'goldens';
      await expectLater(
        find.byType(MatoApp),
        matchesGoldenFile('$goldenDirectory/trade-${width.toInt()}.png'),
      );
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
    });
  }
}
