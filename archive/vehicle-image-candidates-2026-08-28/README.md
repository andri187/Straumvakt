# Vehicle image candidate batch

Recovered from the dirty `E:\Claude\Straumvakt-relops-b` checkout during the
single-workspace consolidation on 2026-10-21.

This batch contains neutral-light candidate renders for the existing vehicle
catalogue plus four additional models recorded in `vehicle_hero_manifest.csv`:

- Jaguar I-Pace
- Mercedes-Benz EQC
- Mercedes-Benz EQB 300 4MATIC
- MG Marvel R Electric

Do not copy these files directly over the active Flutter assets. Inspection of
representative files found 24-bit RGB PNGs without an alpha channel. The active
canonical images are 32-bit ARGB and preserve the transparent background the
vehicle UI requires. Treat this directory as source material for a future
transparent-background pass.

The `_rejected_neutral_attempt_20260828-181548` directory from the source
checkout was explicitly labelled rejected and is not preserved here. The
tracked `vehicle_hero_status.csv` remains active and was not deleted.
