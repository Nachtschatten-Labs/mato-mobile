import 'package:flutter/material.dart';

abstract final class MatoColors {
  static const background = Color(0xff0f0f0f);
  static const panel = Color(0xff141414);
  static const elevated = Color(0xff1c1c1c);
  static const track = Color(0xff262626);
  static const text = Color(0xfffaf8f5);
  static const secondary = Color(0xffcfcdca);
  static const muted = Color(0xff969896);
  static const faint = Color(0xff6f6e6c);
  static const border = Color(0x12ffffff);
  static const accent = Color(0xffe8e6e2);
  static const orange = Color(0xffe67635);
  static const positive = Color(0xffbfe08e);
  static const negative = Color(0xffe89a9a);
  static const caution = Color(0xffe6cf86);
}

ThemeData matoTheme() => ThemeData(
  brightness: Brightness.dark,
  useMaterial3: true,
  fontFamily: 'IBMPlexSans',
  scaffoldBackgroundColor: MatoColors.background,
  colorScheme: const ColorScheme.dark(
    primary: MatoColors.accent,
    onPrimary: MatoColors.background,
    surface: MatoColors.panel,
    onSurface: MatoColors.text,
    error: MatoColors.negative,
  ),
  dividerColor: MatoColors.border,
  appBarTheme: const AppBarTheme(
    backgroundColor: MatoColors.background,
    surfaceTintColor: Colors.transparent,
    elevation: 0,
  ),
  bottomSheetTheme: const BottomSheetThemeData(
    backgroundColor: MatoColors.panel,
    surfaceTintColor: Colors.transparent,
    dragHandleColor: Color(0xff3a3a3a),
    shape: RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
    ),
  ),
  filledButtonTheme: FilledButtonThemeData(
    style: FilledButton.styleFrom(
      minimumSize: const Size(48, 50),
      textStyle: const TextStyle(
        fontFamily: 'IBMPlexSans',
        fontSize: 15,
        fontWeight: FontWeight.w500,
      ),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
    ),
  ),
  textButtonTheme: TextButtonThemeData(
    style: TextButton.styleFrom(
      foregroundColor: MatoColors.secondary,
      minimumSize: const Size(44, 44),
    ),
  ),
  inputDecorationTheme: const InputDecorationTheme(
    border: InputBorder.none,
    hintStyle: TextStyle(color: MatoColors.faint),
  ),
  sliderTheme: const SliderThemeData(
    trackHeight: 3,
    activeTrackColor: MatoColors.accent,
    inactiveTrackColor: MatoColors.track,
    thumbColor: MatoColors.accent,
    thumbShape: RoundSliderThumbShape(enabledThumbRadius: 7),
  ),
  snackBarTheme: const SnackBarThemeData(
    backgroundColor: MatoColors.elevated,
    contentTextStyle: TextStyle(
      color: MatoColors.text,
      fontFamily: 'IBMPlexSans',
    ),
    behavior: SnackBarBehavior.floating,
  ),
);
