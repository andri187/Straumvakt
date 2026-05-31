// Brand colors — copied verbatim from the CPMS mock app's _BrandPalette
// so the new app stays visually consistent with the staging showcase
// shots the operator already approved.

import 'package:flutter/material.dart';

class BrandPalette {
  static const midnight = Color(0xFF010B13);
  static const deepNavy = Color(0xFF061522);
  static const surface = Color(0xFF0A2130);
  static const border = Color(0xFF1E5B70);
  static const mint = Color(0xFF69F2A6);
  static const cyan = Color(0xFF25C9C9);
  static const blue = Color(0xFF2098E4);
  static const muted = Color(0xFFA7BBC8);

  static const danger = Color(0xFFFF6B6B);
  static const amber = Color(0xFFF5B752);
}

class AppTheme {
  static ThemeData dark() {
    return ThemeData(
      useMaterial3: true,
      brightness: Brightness.dark,
      scaffoldBackgroundColor: BrandPalette.midnight,
      colorScheme: const ColorScheme.dark(
        surface: BrandPalette.surface,
        primary: BrandPalette.mint,
        secondary: BrandPalette.cyan,
        error: BrandPalette.danger,
      ),
      textTheme: const TextTheme(
        displayLarge: TextStyle(
          color: Colors.white,
          fontWeight: FontWeight.w900,
        ),
        bodyMedium: TextStyle(color: Colors.white),
      ),
      inputDecorationTheme: const InputDecorationTheme(
        filled: true,
        fillColor: BrandPalette.surface,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.all(Radius.circular(12)),
          borderSide: BorderSide(color: BrandPalette.border),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.all(Radius.circular(12)),
          borderSide: BorderSide(color: BrandPalette.border),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.all(Radius.circular(12)),
          borderSide: BorderSide(color: BrandPalette.cyan, width: 2),
        ),
        labelStyle: TextStyle(color: BrandPalette.muted),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          backgroundColor: BrandPalette.mint,
          foregroundColor: BrandPalette.midnight,
          padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 18),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(14),
          ),
          textStyle: const TextStyle(fontWeight: FontWeight.w800),
        ),
      ),
      cardTheme: CardThemeData(
        color: BrandPalette.surface,
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(18),
          side: const BorderSide(color: BrandPalette.border),
        ),
      ),
    );
  }
}
