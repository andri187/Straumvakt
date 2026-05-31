// HeroImageBanner — restored from the CPMS mock's _HeroImageSlider.
// PNG asset has its own transparent background; floats over the
// midnight scaffold directly. NumberPlate sits on top-left like the
// original, presenting the driver's vehicle plate.

import 'package:flutter/material.dart';
import '../theme/palette.dart';
import 'number_plate.dart';

class HeroImageBanner extends StatelessWidget {
  const HeroImageBanner({super.key, this.plate = 'N1 742'});

  final String plate;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 230,
      child: Stack(
        children: [
          Positioned.fill(
            top: 12,
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
          ),
          Positioned(
            top: 0,
            left: 4,
            child: NumberPlate(value: plate),
          ),
        ],
      ),
    );
  }
}
