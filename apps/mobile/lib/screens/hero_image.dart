// Branded home artwork. It deliberately carries no user-specific vehicle
// identity; plate data is not available from the current driver contract.

import 'package:flutter/material.dart';
import '../theme/palette.dart';

class HeroImageBanner extends StatelessWidget {
  const HeroImageBanner({super.key});

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 230,
      child: Center(
        child: Image.asset(
          'assets/images/straumvakt_hero_image.png',
          height: 218,
          fit: BoxFit.contain,
          filterQuality: FilterQuality.high,
          errorBuilder: (context, error, stackTrace) {
            return const Icon(
              Icons.electric_bolt_rounded,
              color: BrandPalette.mint,
              size: 56,
            );
          },
        ),
      ),
    );
  }
}
