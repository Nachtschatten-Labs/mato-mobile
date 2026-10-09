import 'package:flutter/material.dart';

/// Canonical Dark Forest tokens from mato-design/design/tokens.css.
abstract final class MatoColors {
  static const background = Color(0xff0b1512);
  static const panel = Color(0xff111f1a);
  static const panelTranslucent = Color(0xd9111f1a);
  static const elevated = Color(0xff1a2c25);
  static const track = Color(0xff263d33);
  static const floating = track;
  static const text = Color(0xffeff4ec);
  static const secondary = Color(0xffcbd8cc);
  static const muted = Color(0xffa7b9ab);
  static const faint = Color(0xff9aac9e);
  static const border = Color(0x0fd7edc5);
  static const divider = Color(0x1fd7edc5);
  static const accent = Color(0xffd7edc5);
  static const action = Color(0xffa2bb9c);
  static const orange = action;
  static const buttonInk = Color(0xff25473e);
  static const positive = Color(0xff86d6ae);
  static const negative = Color(0xffe89a9a);
  static const caution = Color(0xffe6cf86);
  static const axis = Color(0xff758b7c);
  static const grip = Color(0xff496052);
}

ThemeData matoTheme() {
  final base = ThemeData(
    brightness: Brightness.dark,
    useMaterial3: true,
    fontFamily: 'IBMPlexSans',
    scaffoldBackgroundColor: MatoColors.background,
    colorScheme: const ColorScheme.dark(
      primary: MatoColors.accent,
      onPrimary: MatoColors.buttonInk,
      secondary: MatoColors.elevated,
      onSecondary: MatoColors.secondary,
      surface: MatoColors.panel,
      onSurface: MatoColors.text,
      error: MatoColors.negative,
    ),
  );
  return base.copyWith(
    textTheme: base.textTheme
        .apply(bodyColor: MatoColors.text, displayColor: MatoColors.text)
        .mapTabularFigures(),
    dividerColor: MatoColors.border,
    iconTheme: const IconThemeData(color: MatoColors.muted, size: 18),
    appBarTheme: const AppBarTheme(
      backgroundColor: Colors.transparent,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      scrolledUnderElevation: 0,
      titleSpacing: 16,
      centerTitle: false,
    ),
    bottomSheetTheme: const BottomSheetThemeData(
      backgroundColor: MatoColors.panel,
      surfaceTintColor: Colors.transparent,
      modalBarrierColor: Color(0x99000000),
      dragHandleColor: MatoColors.grip,
      dragHandleSize: Size(32, 4),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
        side: BorderSide(color: MatoColors.border),
      ),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        minimumSize: const Size(48, 48),
        backgroundColor: MatoColors.accent,
        foregroundColor: MatoColors.buttonInk,
        disabledBackgroundColor: MatoColors.track,
        disabledForegroundColor: MatoColors.muted,
        textStyle: const TextStyle(
          fontFamily: 'IBMPlexSans',
          fontSize: 14,
          fontWeight: FontWeight.w500,
        ),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(
        foregroundColor: MatoColors.secondary,
        textStyle: const TextStyle(
          fontFamily: 'IBMPlexSans',
          fontSize: 14,
          fontWeight: FontWeight.w400,
        ),
        minimumSize: const Size(32, 36),
        padding: const EdgeInsets.symmetric(horizontal: 12),
      ),
    ),
    inputDecorationTheme: const InputDecorationTheme(
      border: InputBorder.none,
      hintStyle: TextStyle(color: MatoColors.faint),
    ),
    sliderTheme: const SliderThemeData(
      trackHeight: 3,
      activeTrackColor: MatoColors.action,
      inactiveTrackColor: MatoColors.track,
      thumbColor: MatoColors.accent,
      thumbShape: RoundSliderThumbShape(enabledThumbRadius: 7),
      overlayShape: RoundSliderOverlayShape(overlayRadius: 16),
    ),
    progressIndicatorTheme: const ProgressIndicatorThemeData(
      color: MatoColors.action,
    ),
    snackBarTheme: const SnackBarThemeData(
      backgroundColor: MatoColors.floating,
      contentTextStyle: TextStyle(
        color: MatoColors.text,
        fontFamily: 'IBMPlexSans',
      ),
      behavior: SnackBarBehavior.floating,
    ),
  );
}

extension on TextTheme {
  TextTheme mapTabularFigures() {
    TextStyle? numbers(TextStyle? style) =>
        style?.copyWith(fontFeatures: const [FontFeature.tabularFigures()]);
    return copyWith(
      displayLarge: numbers(displayLarge),
      displayMedium: numbers(displayMedium),
      displaySmall: numbers(displaySmall),
      headlineLarge: numbers(headlineLarge),
      headlineMedium: numbers(headlineMedium),
      headlineSmall: numbers(headlineSmall),
      titleLarge: numbers(titleLarge),
      titleMedium: numbers(titleMedium),
      titleSmall: numbers(titleSmall),
      bodyLarge: numbers(bodyLarge),
      bodyMedium: numbers(bodyMedium),
      bodySmall: numbers(bodySmall),
      labelLarge: numbers(labelLarge),
      labelMedium: numbers(labelMedium),
      labelSmall: numbers(labelSmall),
    );
  }
}
