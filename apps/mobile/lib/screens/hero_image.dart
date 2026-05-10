// HeroImageBanner — restored from the CPMS mock's _HeroImageSlider.
// The PNG asset has a transparent background and is meant to float
// over the page's midnight scaffold directly — no extra gradient
// card around it (that's why "_HeroCard" wrapped it in the old app:
// to give the rest of the card a frame; the image itself is
// transparent on top).
//
// BoxFit.contain matches the original 218px-inside-230px sizing.

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
