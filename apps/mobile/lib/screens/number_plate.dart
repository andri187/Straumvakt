// Iceland number plate widget — copied verbatim from the CPMS mock's
// _NumberPlate / _IcelandPlateMark / _IcelandFlag / _PlateInspectionSticker.
// Underscore prefixes dropped so the type is reusable across screens.
//
// In the mock this sat as a Positioned overlay on the hero image
// stack (top: 0, left: 4) above the car. Same placement here.

import 'package:flutter/material.dart';

class NumberPlate extends StatelessWidget {
  const NumberPlate({super.key, required this.value});

  final String value;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 33,
      decoration: BoxDecoration(
        color: const Color(0xFFF8FAFC),
        borderRadius: BorderRadius.circular(4),
        border: Border.all(color: const Color(0xFF111827), width: 2),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.28),
            blurRadius: 9,
            offset: const Offset(0, 5),
          ),
        ],
      ),
      clipBehavior: Clip.antiAlias,
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          const _IcelandPlateMark(),
          Padding(
            padding: const EdgeInsets.fromLTRB(9, 0, 6, 2),
            child: Text(
              value.length >= 2 ? value.substring(0, 2) : value,
              style: const TextStyle(
                color: Color(0xFF1565C0),
                fontSize: 25,
                fontWeight: FontWeight.w900,
                height: 1,
                letterSpacing: 0,
              ),
            ),
          ),
          const _PlateInspectionSticker(),
          Padding(
            padding: const EdgeInsets.fromLTRB(6, 0, 9, 2),
            child: Text(
              value.length > 3 ? value.substring(3) : '',
              style: const TextStyle(
                color: Color(0xFF1565C0),
                fontSize: 25,
                fontWeight: FontWeight.w900,
                height: 1,
                letterSpacing: 0,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _IcelandPlateMark extends StatelessWidget {
  const _IcelandPlateMark();

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 26,
      height: double.infinity,
      color: const Color(0xFFF8FAFC),
      alignment: Alignment.center,
      child: const Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          _IcelandFlag(),
          SizedBox(height: 2),
          Text(
            'IS',
            style: TextStyle(
              color: Color(0xFF111827),
              fontSize: 12,
              fontWeight: FontWeight.w900,
              height: 1,
              letterSpacing: 0,
            ),
          ),
        ],
      ),
    );
  }
}

class _IcelandFlag extends StatelessWidget {
  const _IcelandFlag();

  @override
  Widget build(BuildContext context) {
    return CustomPaint(
      size: const Size(17, 11),
      painter: _IcelandFlagPainter(),
    );
  }
}

class _IcelandFlagPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final blue = Paint()..color = const Color(0xFF02529C);
    final white = Paint()..color = Colors.white;
    final red = Paint()..color = const Color(0xFFDC1E35);
    canvas.drawRect(Offset.zero & size, blue);
    canvas.drawRect(
      Rect.fromLTWH(size.width * 0.34, 0, size.width * 0.23, size.height),
      white,
    );
    canvas.drawRect(
      Rect.fromLTWH(0, size.height * 0.34, size.width, size.height * 0.28),
      white,
    );
    canvas.drawRect(
      Rect.fromLTWH(size.width * 0.4, 0, size.width * 0.11, size.height),
      red,
    );
    canvas.drawRect(
      Rect.fromLTWH(0, size.height * 0.42, size.width, size.height * 0.13),
      red,
    );
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}

class _PlateInspectionSticker extends StatelessWidget {
  const _PlateInspectionSticker();

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 14,
      height: 25,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: const Color(0xFFE77DB4),
        borderRadius: BorderRadius.circular(2),
        border: Border.all(color: const Color(0xFFC85B98), width: 0.8),
      ),
      child: const FittedBox(
        fit: BoxFit.scaleDown,
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Text(
              '27',
              style: TextStyle(
                color: Color(0xFF111827),
                fontSize: 11,
                fontWeight: FontWeight.w900,
                height: 1,
                letterSpacing: 0,
              ),
            ),
            SizedBox(height: 1),
            Text(
              '2027',
              style: TextStyle(
                color: Color(0xFF111827),
                fontSize: 5.5,
                fontWeight: FontWeight.w900,
                height: 1,
                letterSpacing: 0,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
