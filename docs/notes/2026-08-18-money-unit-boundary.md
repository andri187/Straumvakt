# The money-unit boundary — one converting layer, named

**2026-08-18 · Claude A · branch `dev/core-billing-integration`**

Phase 2 of the 2026-08-18 Claude A prompt. **Contains a patch the mobile lane
must apply — see §5. The API change in this branch is not safe to deploy until
it does.**

---

## 1. The rule, in one sentence

> **Money leaves the API in aurar (1/100 króna) as a whole-number JSON integer,
> in a field whose name ends in `Aurar`; the client converts for display using
> half-up-away-from-zero rounding.**

It is stated in source exactly once, at the top of
[apps/api/src/lib/billing/money-wire.ts](../../apps/api/src/lib/billing/money-wire.ts),
and every driver-facing money field now passes through that module's single
exported function.

Operator-facing surfaces already obeyed a compatible rule under a different
spelling — `…IskMinor` plus a pre-formatted `costFormatted` string — and are
left alone. §3 says why that is not a second rule.

---

## 2. What was actually wrong

The engine has computed in aurar since `compute-session-cost.ts`: per-kWh rates
carry two decimals, so the arithmetic needs the precision, and `projections.ts`
persists the aurar figure. **A 649.88 kr session is stored as `64988`.**

Three separate readers then each guessed the unit differently, and the guesses
did not agree:

| reader | what it did | result |
|---|---|---|
| `driver-sessions.ts` `minorToIsk` | `Number(minor)` under the comment *"ISK has no minor unit, so minor === major"* | **100× too large** |
| `driver-invoices.ts` | `Number(lc)`, but documented as *"VAT-inclusive amount in aurar"* | value right, **name wrong** |
| Flutter `DriverHistorySession.costLabel` | `(c / 100).round()` | **correct — but only because the server was wrong in the compensating direction** |
| Flutter `ActiveSession` (`active_session.dart:208,290`) | `costIsk!.toStringAsFixed(0)` | **100× too large** |

The premise in the first row is simply false: ISK has a formally defined
subunit, this codebase uses it, and `formatIskMinor()` divides by 100 eleven
lines from the same value in a file the same author had open.

### Correction to the prompt's framing

The 2026-08-18 prompt states that the client divides `costIsk` by 100. That is
true of `DriverHistorySession` and **false of `ActiveSession`**, which renders
the identical server field with `toStringAsFixed(0)` and no division. So the
client was not uniformly compensating — it was inconsistent with *itself*, and
the live driver app shows the in-flight cost 100× too large on the active
session screen today even with the new history screens applied.

That matters for the deploy sequencing in §5: the active-session screen is
*already wrong*, so the rename makes it show nothing rather than something
false — a strict improvement even before the patch lands.

---

## 3. Every site where money crosses a boundary

`unit in` is what the code receives; `unit out` is what leaves the process.

### 3a. Driver-facing — the surface this change fixes

| file | symbol | unit in | unit out | who converts |
|---|---|---|---|---|
| `apps/api/src/repositories/driver-sessions.ts` | `getDriverActiveSessions` → `DriverActiveSession.costAurar` | aurar (`sessions.cost_inc_vat_minor`, BigInt) | **aurar** (int) | nobody — client |
| `apps/api/src/repositories/driver-sessions.ts` | `listDriverSessionHistory` → `DriverHistorySession.costAurar` | aurar (`session_ledger.cost_isk_minor`, BigInt) | **aurar** (int, nullable) | nobody — client |
| `apps/api/src/repositories/driver-invoices.ts` | `listDriverActualSessions` → `DriverInvoiceSession.costAurar` | aurar (ledger, else session), BigInt | **aurar** (int, nullable) | nobody — client |
| `apps/api/src/routes/public/driver.ts` | `POST /start-session` 202 body `session.costAurar` | literal `0` | **aurar** (int) | n/a |
| `apps/api/src/routes/public/driver.ts` | `POST /stop-session` 202 body `session.costAurar` | literal `0` | **aurar** (int) | n/a |
| `apps/api/src/lib/billing/money-wire.ts` | `toWireAurar` | aurar (BigInt or number) | **aurar** (int) | **nobody — this is the named boundary** |
| `apps/mobile/lib/api/types.dart` | `DriverHistorySession.costLabel` | aurar (int) | krónur (string) | **the client** ← after §5 |
| `apps/mobile/lib/api/types.dart` | `ActiveSession.costAurar` | aurar (num) | krónur (string) | **the client** ← after §5 |

### 3b. Operator-facing — already correct, deliberately untouched

These emit the raw amount under a name containing `Minor` **and** a
pre-rendered display string beside it. That is the same rule with an older
spelling: the unit is in the name, and exactly one layer converts.

| file | symbol | unit in | unit out | who converts |
|---|---|---|---|---|
| `apps/api/src/routes/admin/billing.ts` | ledger list → `costIskMinor` + `costFormatted` | aurar | aurar + krónur string | `formatIskMinor` (`compute-session-cost.ts:211`) |
| `apps/api/src/repositories/session-detail.ts` | `costIskMinor` + `costFormatted` | aurar | aurar + krónur string | local `formatIsk` (`:504`, divides by 100) |
| `apps/api/src/repositories/session-full-detail.ts` | `costIskMinor` + `costFormatted` | aurar | aurar + krónur string | local `formatIsk` (`:504`, divides by 100) |
| `apps/api/src/repositories/billing-summary.ts` | `costIskMinor`, `totalCostIskMinor` | aurar | aurar (string) | nobody — console |
| `apps/api/src/repositories/billing-tariff-detail.ts` | `costIskMinor` | aurar | aurar (string) | nobody — console |
| `apps/api/src/repositories/billing-enrichment.ts` | `costIskMinor` | aurar | aurar (BigInt) | nobody — internal |
| `apps/api/src/routes/admin/billing-enrichment.ts` | `costIskMinor` | aurar | aurar (string) | nobody — console |
| `apps/api/src/repositories/session-ledger.ts` | `costIskMinor`, `totalCostIskMinor` | aurar | aurar (BigInt) | nobody — internal |
| `apps/api/src/routes/webhooks/zaptec.ts` | `costIskMinor` (3 sites) | aurar | aurar | nobody — write path |
| `apps/api/src/repositories/zaptec-session-sync.ts` | `costIskMinor` (3 sites) | aurar | aurar | nobody — write path |
| `apps/api/src/routes/admin/vendor-credentials.ts` | `costIskMinor` | aurar | aurar (string) | nobody — console |
| `src/components/session-detail-view.tsx` | `kr(minor)` `:76` | aurar (string) | krónur (is-IS string) | **the web console** |

### 3c. The engine — no boundary, stated for completeness

| file | symbol | note |
|---|---|---|
| `packages/commercial/src/core-billing/money.ts` | `roundAurarToIsk`, `sumRoundedLinesIsk`, `formatAurar`, `formatIsk`, `apportionAurar`, `vatOnAurar` | the arithmetic contract; aurar in, ISK out, always explicit in the name |
| `apps/api/src/lib/tariff/compute-session-cost.ts` | `formatIskMinor` `:211` | operator display formatter; divides by 100 |

**Three formatters divide by 100 in three files** (`compute-session-cost.ts`,
`session-detail.ts`/`session-full-detail.ts`, `session-detail-view.tsx`), all
correct, none shared. That is duplication, not a defect, and consolidating them
is a separate change — noted here so the next reader does not have to rediscover
it.

---

## 4. Why a rename, and not "just divide by 100 on the server"

This is the load-bearing decision of the phase.

Dividing on the server keeps `costIsk` and changes its value. The Flutter
history screen, which already divides, would then show every amount **100× too
small** — 6 kr instead of 650 kr — and nothing anywhere would raise an error.
Wrong money that looks like money is the failure mode that produced this defect
in the first place.

Renaming cannot fail that way. A client still reading `costIsk` finds the key
absent, gets `null`, and renders the null state every driver surface already
implements ("Not priced"). **A missing field is visible on the first screen; a
wrong number is visible on the first dispute.**

The prompt recommended exactly this and the recommendation is adopted
unchanged. The second reason to prefer it: aurar on the wire is lossless, so
the API never has to decide *when* a line gets rounded — the rounding rule for a
billed line lives in `money.ts` where the invoice is built, not in a read
endpoint that happens to display one.

---

## 5. The mobile patch — hand-off to whoever owns `apps/mobile`

The mobile tree lives in the canonical checkout `E:\Claude\Straumvakt`, which
carries ~2,857 lines of another lane's uncommitted work. **I did not edit it.**
The exact patch is below.

**Deploy hazard, stated plainly: the API change on
`dev/core-billing-integration` must not reach an environment the Flutter app
talks to until this patch is applied and shipped.** If it does, both driver
money screens fall back to their null state and drivers see no amounts at all.
That is a visible, reversible, non-financial failure — chosen over the silent
one — but it is still a regression, and the two halves should land together.

### 5.1 The contract both sides must satisfy

| JSON field | type | meaning |
|---|---|---|
| `costAurar` | integer, nullable | VAT-inclusive amount in aurar (1/100 króna). `null` means never costed — **not** zero. |

Display conversion, and the only one permitted:

```
krónur = round(aurar / 100)      // half-up, away from zero
```

Dart's `num.round()` rounds half away from zero, which matches
`roundAurarToIsk()` in `@straumvakt/commercial` on negatives as well as
positives. `money-wire.test.ts` asserts that equivalence explicitly, so the day
either side changes its rounding rule, the API test suite says so.

### 5.2 `apps/mobile/lib/api/types.dart`

```diff
@@ class ActiveSession
     this.powerKw,
     this.energyKwh,
-    this.costIsk,
+    this.costAurar,
   });

   final String sessionId;
   final String connectorId;
   final String chargerName;
   // Raw OCPP-ish session status string, e.g. 'Charging', 'Preparing'.
   final String status;
   final DateTime? startedAt;
   final double? powerKw;
   final double? energyKwh;
-  final double? costIsk;
+  /// VAT-inclusive **aurar** (1/100 króna) — see the API's
+  /// lib/billing/money-wire.ts. Never render this without dividing.
+  final int? costAurar;

   factory ActiveSession.fromJson(Map<String, dynamic> json) {
     return ActiveSession(
       sessionId: json['sessionId'] as String,
       connectorId: json['connectorId'] as String,
       chargerName: json['chargerName'] as String? ?? 'Charger',
       status: json['status'] as String? ?? 'Unknown',
       startedAt: json['startedAt'] != null
           ? DateTime.tryParse(json['startedAt'] as String)
           : null,
       powerKw: (json['powerKw'] as num?)?.toDouble(),
       energyKwh: (json['energyKwh'] as num?)?.toDouble(),
-      costIsk: (json['costIsk'] as num?)?.toDouble(),
+      costAurar: (json['costAurar'] as num?)?.toInt(),
     );
   }

+  /// Króna, formatted. Null cost stays null — an uncosted session is a real
+  /// state and rendering it as "0 kr" would be a lie about money.
+  String? get costLabel {
+    final c = costAurar;
+    if (c == null) return null;
+    return '${(c / 100).round()} kr';
+  }
+
   ConnectorStatus get connectorStatus => ConnectorStatus.fromString(status);
 }
```

```diff
@@ class DriverHistorySession
 /// One completed charge, as the driver sees it.
 ///
-/// Mirrors the API's `DriverHistorySession`. `costIsk` is VAT-inclusive
+/// Mirrors the API's `DriverHistorySession`. `costAurar` is VAT-inclusive
 /// **aurar** (1/100 króna) and is NULL when the session was never costed
 /// — a real state, not a zero. Rendering an uncosted session as "0 kr"
 /// would be a lie about money, so callers must handle null explicitly.
 class DriverHistorySession {
   const DriverHistorySession({
     required this.sessionId,
     required this.startedAt,
     required this.energyKwh,
     this.stoppedAt,
     this.durationSec,
-    this.costIsk,
+    this.costAurar,
     this.chargerName,
     this.siteName,
     this.billingHomeName,
   });
@@
   final double energyKwh;
-  final int? costIsk;
+  final int? costAurar;
   final String? chargerName;
   final String? siteName;
@@ factory DriverHistorySession.fromJson
       durationSec: (j['durationSec'] as num?)?.toInt(),
       energyKwh: (j['energyKwh'] as num?)?.toDouble() ?? 0,
-      costIsk: (j['costIsk'] as num?)?.toInt(),
+      costAurar: (j['costAurar'] as num?)?.toInt(),
       chargerName: j['chargerName'] as String?,
@@ String? get costLabel
   String? get costLabel {
-    final c = costIsk;
+    final c = costAurar;
     if (c == null) return null;
     final kr = (c / 100).round();
     return '$kr kr';
   }
```

### 5.3 `apps/mobile/lib/screens/active_session.dart`

This is the screen that is **wrong today** — it prints the aurar figure
unchanged. Both call sites must go through `costLabel`, which the patch in §5.2
adds to `ActiveSession`:

```diff
@@ around :208
-                value: s?.costIsk != null
-                    ? '${s!.costIsk!.toStringAsFixed(0)} kr'
+                value: s?.costLabel != null
+                    ? s!.costLabel!
                     : '—',
@@ around :290
-              '${_session!.costIsk != null ? ' · ${_session!.costIsk!.toStringAsFixed(0)} kr' : ''}',
+              '${_session!.costLabel != null ? ' · ${_session!.costLabel!}' : ''}',
```

### 5.4 `apps/mobile/lib/screens/charge_history.dart`

Two references, both mechanical renames — the arithmetic is already right:

```diff
@@ :9 (header comment)
-// `costIsk == null`, and that renders as "Not priced" — never as 0 kr.
+// `costAurar == null`, and that renders as "Not priced" — never as 0 kr.
@@ :119
-    final priced = rows.where((s) => s.costIsk != null);
-    final aurar = priced.fold<int>(0, (a, s) => a + s.costIsk!);
+    final priced = rows.where((s) => s.costAurar != null);
+    final aurar = priced.fold<int>(0, (a, s) => a + s.costAurar!);
```

`apps/mobile/lib/api/client.dart` needs **no change**: it decodes into these
model classes and never touches the field by name.

### 5.5 Hand-over paragraph, for the mobile lane

> The API now emits driver money as `costAurar` — an integer number of aurar
> (1/100 króna) — instead of `costIsk`, which carried aurar under a name that
> claimed krónur. Your history screen was already dividing by 100 and was
> therefore correct; your active-session screen was not, and has been showing
> in-flight cost 100× too large in production. Apply §5.2–§5.4 and both screens
> read the same field through the same `costLabel` getter. The rename is
> deliberate: it makes a version mismatch show up as a missing amount rather
> than as a wrong one. Until this lands, do not point a build at an environment
> running `dev/core-billing-integration`, and do not deploy that branch's API to
> an environment your builds talk to.

---

## 6. Zero is not unknown

Two places conflate them, and they are recorded here rather than silently
changed, because each is a wire-contract change of its own:

1. **`getDriverActiveSessions` emits `costAurar: 0` for an in-flight session
   that has not been costed** (`?? 0`). The pre-existing behaviour is preserved
   deliberately — flipping it to `null` is a second breaking change and belongs
   with a patch that updates every driver surface at once, not smuggled into
   the unit fix. `docs/notes/2026-08-09-p0-remediation-specifications.md:116`
   already specifies `null` here; this note is the second request.
2. **`routes/admin/billing.ts` rendered a genuinely free session as "—".**
   `r.costIskMinor ? formatIskMinor(…) : null` is falsy for `0n`, so 0.00 kr
   displayed identically to never-costed. **Fixed in this branch** — the guard
   is now `!= null`. It is operator-facing, so no client contract moves.

---

## 7. Tests

`apps/api/src/lib/billing/money-wire.test.ts` — 17 assertions over the wire
helper, covering `0`, `1`, `50`, `99`, `100`, `64988`, `45000` (the cap
boundary), `45001`, `45050`, `123456789`, and negatives `−250` / `−64988`;
plus null-vs-zero, BigInt-vs-number, non-integer refusal, beyond-2^53 refusal,
and the Dart-equivalence proof.

`apps/api/src/repositories/driver-sessions.test.ts` — the same value table
asserted through `listDriverSessionHistory` itself, so the contract is pinned on
the surface that serves it and not only on the helper, plus a negative
adjustment.

**The test that pinned the defect:**
`apps/api/src/repositories/driver-sessions.test.ts:246`, formerly asserting
`costIsk: 64988` inside the `"enriches charger/site/billing-home names + maps
cost"` case. It passed. The number was right; the field name asserted that a
649.88 kr session costs sixty-five thousand krónur. It is corrected in place —
renamed field, same value, plus an explicit
`roundAurarToIsk(64988n) === 650n` assertion so the magnitude is stated in the
test rather than implied.

**Fool test:** `toWireAurar` was changed to `Math.round(n / 100)` — the "fix the
value, keep the name" mistake this design rejects. **23 tests across 2 files
failed.** Reverted.
