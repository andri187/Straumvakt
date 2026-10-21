import 'package:flutter/material.dart';

import 'screens/my_vehicle.dart';
import 'theme/palette.dart';

void main() {
  runApp(const MyVehiclePreviewApp());
}

class MyVehiclePreviewApp extends StatelessWidget {
  const MyVehiclePreviewApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Straumvakt | My vehicle',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.dark(),
      home: const MyVehicleScreen(),
    );
  }
}
