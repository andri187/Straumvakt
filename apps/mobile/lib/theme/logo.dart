// Logo widgets — copied from the existing CPMS mock app's _LogoMark and
// _LogoWordmark so brand identity is consistent. Asset paths point at
// the local apps/mobile/assets/images copies.

import 'package:flutter/material.dart';
import 'palette.dart';

class LogoMark extends StatelessWidget {
  const LogoMark({super.key, this.size = 46, this.borderRadius = 16});

  final double size;
  final double borderRadius;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: size,
      height: size,
      child: ClipRRect(
        borderRadius: BorderRadius.circular(borderRadius),
        child: Image.asset(
          'assets/images/straumvakt_logo_mark.png',
          fit: BoxFit.cover,
          filterQuality: FilterQuality.high,
          errorBuilder: (context, error, stackTrace) {
            return DecoratedBox(
              decoration: const BoxDecoration(
                gradient: LinearGradient(
                  colors: [BrandPalette.mint, BrandPalette.blue],
                ),
              ),
              child: Icon(
                Icons.bolt_rounded,
                color: BrandPalette.midnight,
                size: size * 0.55,
              ),
            );
          },
        ),
      ),
    );
  }
}

class LogoWordmark extends StatelessWidget {
  const LogoWordmark({super.key, this.height = 40});

  final double height;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: height,
      child: Image.asset(
        'assets/images/straumvakt_logo_full.png',
        fit: BoxFit.contain,
        filterQuality: FilterQuality.high,
        errorBuilder: (context, error, stackTrace) {
          return Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              LogoMark(size: height, borderRadius: height / 4),
              const SizedBox(width: 12),
              Text(
                'Straumvakt',
                style: TextStyle(
                  color: Colors.white,
                  fontSize: height * 0.6,
                  fontWeight: FontWeight.w900,
                  letterSpacing: -0.5,
                ),
              ),
            ],
          );
        },
      ),
    );
  }
}
