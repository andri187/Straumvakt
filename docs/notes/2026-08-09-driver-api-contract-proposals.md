# Driver API contract proposals

**Proposals only. No route, schema, or DTO was implemented.** Source-aligned
against RC `4b69d0f` and mobile `ae5db26`.

## Cross-cutting rules

These apply to every contract below and exist because the current surface
violates each at least once.

| # | Rule | Violated today by |
|---|---|---|
| R1 | Absence is `null`. A numeric `0` means measured zero | `powerKw: 0`, `whToKwh`, `minorToIsk` |
| R2 | Money carries `amountMinor` + `currency` + `exponent`. No field name implies a unit | `costIsk` (holds aurar) |
| R3 | Every measured value carries `observedAt` and `source` | nothing carries either |
| R4 | Enumerations are lowercase stable tokens, not display strings | `status: "Charging"` |
| R5 | Cross-tenant misses return `404`, never `403` | already honoured — `driver.ts:759` |
| R6 | List endpoints are explicitly ordered and paginated | `/sessions/current` ordered, unpaginated (correct — bounded) |
| R7 | Additive first, remove after one client release | — |

### Versioning

**Recommendation: no URL version.** Add fields additively, keep the old shape
one release, remove. A `/v2` costs more than it buys while there is one
first-party client. Revisit when a third party consumes the API.

Old-client behaviour is the deciding constraint: `ae5db26` treats `0` as absent,
so `null` is **safe for it today**. That window is why additive-then-remove works
now and may not later.

---

## 3A · Active-session telemetry

`GET /api/driver/sessions/current` — replaces the shape in
`driver-sessions.ts:126-138`.

```jsonc
{
  "sessions": [
    {
      "sessionId": "8f14e45f-…",
      "connectorId": "c1a2…",           // nullable — ae5db26 already handles
      "chargerName": "Dalvegur 10 – A2",
      "state": "charging",              // R4: charging|suspended_ev|suspended_evse|finishing|unknown
      "startedAt": "2026-08-09T00:12:00Z",
      "energy": {
        "kwh": 4.219,                   // null when unknown — never 0 for unknown
        "observedAt": "2026-08-09T00:41:12Z",
        "source": "session_meter"
      },
      "power": null,                    // null today; see P0-B before populating
      "cost": {
        "amountMinor": null,            // null = no amount yet
        "currency": "ISK",
        "exponent": 2,                  // amountMinor / 10^exponent = major
        "state": "pending"              // pending|priced|free|unpriced
      }
    }
  ],
  "primarySessionId": "8f14e45f-…"      // PROPOSED-J; null when list is empty
}
```

### `cost.state` — the distinction the current API cannot express

| state | `amountMinor` | Meaning | UI |
|---|---|---|---|
| `pending` | `null` | in flight, not yet costed | "Pending" |
| `priced` | integer | final or projected cost | render |
| `free` | `0` | genuinely zero-cost | **"Free"**, not "0 kr" |
| `unpriced` | `null` | ended, and no tariff resolved | "Not priced" + support path |

`ae5db26` currently renders `free` as "Pending" because the API cannot
distinguish them. This is the fix.

### Ordering and multiplicity

`startedAt desc`, tie-broken by `sessionId` ascending — **the tie-break matters**:
without it, `primarySessionId` can flap between polls when two sessions start in
the same second.

### `power` — only if provenance exists

Populate **only** with `{ kw, observedAt, source }`. `source` ∈
`meter_value | charger_status | derived_delta`. A `derived_delta` value must be
labelled an estimate in the UI. Emitting a bare number reproduces the original
defect in a new field.

---

## 3B · Pricing preview and plug-time countdown

`GET /api/driver/chargers/:id/pricing` — exists (`driver.ts:829`), **no caller**.

```jsonc
{
  "chargerId": "…",
  "tariff": {
    "tariffId": "…", "version": 7,
    "validFrom": "2026-08-01T00:00:00Z",
    "owner": { "kind": "operator", "orgId": "…", "displayName": "N1 ehf" },
    "components": [
      { "kind": "energy",     "payee": "retailer", "unit": "kWh", "unitPriceMinor": 1890, "vatRate": 0.24 },
      { "kind": "grid",       "payee": "dso",      "unit": "kWh", "unitPriceMinor": 780,  "vatRate": 0.24 },
      { "kind": "service",    "payee": "operator", "unit": "kWh", "unitPriceMinor": 400,  "vatRate": 0.24 },
      { "kind": "plug_time",  "payee": "operator", "unit": "minute", "unitPriceMinor": 1500, "vatRate": 0.24,
        "freeAfterSessionStart": null, "freeUntilChargeComplete": true, "graceMinutes": 15 }
    ],
    "currency": "ISK", "exponent": 2
  },
  "plugTime": {
    "basis": "charge_complete",        // charge_complete | session_start | clock_time
    "graceMinutes": 15,
    "startsAt": null,                  // null until the basis event occurs
    "serverNow": "2026-08-09T00:41:12Z"
  },
  "estimate": { "isBinding": false, "note": "indicative_only" }
}
```

### Time-zone and DST

`plugTime.startsAt` and `serverNow` are **instants (UTC)**, never local wall
time. The client counts down from `startsAt - serverNow`, not from device time —
device clocks are wrong often enough to matter, and Iceland does not observe DST,
which makes this easy to get wrong for the first non-Icelandic market rather than
for this one.

`basis: "clock_time"` (e.g. free before 07:00) is the only case needing a
timezone; it must then carry an IANA zone, not an offset.

### Estimate vs binding

`isBinding: false` always, for a preview. The binding value is 3C. Never render a
preview total as though it were the charge.

---

## 3C · Final settlement breakdown

`GET /api/driver/sessions/:id` — exists (`driver.ts:759`); `ae5db26` consumes it
and correctly uses server-rendered `costFormatted`
(`session_detail.dart:111`).

```jsonc
{
  "session": {
    "sessionId": "…", "startedAt": "…", "endedAt": "…", "stopReason": "remote_stop",
    "energyKwh": 12.084,
    "durations": { "pluggedInSec": 9120, "chargingSec": 7380, "idleSec": 1740 },
    "settlement": {
      "status": "projected",           // pending|projected|final|corrected|disputed
      "projectionVersion": 3,
      "currency": "ISK", "exponent": 2,
      "totalExVatMinor": 1846200, "vatMinor": 443088, "totalIncVatMinor": 2289288,
      "lines": [
        { "kind": "energy",    "payee": { "kind": "retailer", "displayName": "…" },
          "quantity": 12.084, "unit": "kWh", "unitPriceMinor": 1890,
          "amountExVatMinor": 228388, "vatMinor": 54813 },
        { "kind": "plug_time", "payee": { "kind": "operator", "displayName": "…" },
          "quantity": 14, "unit": "minute", "unitPriceMinor": 1500,
          "amountExVatMinor": 21000, "vatMinor": 5040 }
      ],
      "adjustments": []
    },
    "meterEvidence": { "hasSignedData": true, "format": "OCMF", "reference": "ocmf:…:sha256" }
  }
}
```

### Invariants worth testing

- `Σ lines.amountExVatMinor + Σ adjustments == totalExVatMinor`
- `totalExVatMinor + vatMinor == totalIncVatMinor` — already asserted server-side
  in `compute-session-cost.ts:109`
- every line has a `payee`; "who is charging me for this" is answerable per line

### Signed meter data

`meterEvidence` carries a **reference and a hash, never the blob**.
`getSessionFullDetail` already omits `includeRaw` for drivers (`driver.ts:759`
comment) — this preserves that boundary explicitly rather than by omission.

### Late corrections

`status: "corrected"` with an incremented `projectionVersion` and a
`supersedes` pointer. A client must be able to detect that a figure it displayed
has changed, which today it cannot.

---

## 3D · Invoice documents and payment state

**No invoice document exists in the system.** This contract is what would be
needed, not what to rename.

| Concept | Definition | Exists today |
|---|---|---|
| billing record | a chargeable session with a computed cost | ✅ `/invoices` (misnamed) |
| invoice | issued document: number, period, payable total, due date | ❌ |
| receipt | evidence of payment | ❌ |
| credit note | correction to an issued invoice | ❌ |

```jsonc
// GET /api/driver/billing/records?from=&to=&cursor=   ← rename of /invoices
{ "records": [ { "sessionId": "…", "endedAt": "…", "cost": { … } } ],
  "nextCursor": "…" }

// GET /api/driver/billing/documents                    ← new, when invoicing exists
{ "documents": [ { "documentId": "…", "kind": "invoice", "number": "2026-000123",
                   "periodStart": "…", "periodEnd": "…",
                   "total": { "amountMinor": …, "currency": "ISK", "exponent": 2 },
                   "status": "issued", "downloadUrl": "…", "expiresAt": "…" } ] }
```

Download authorization: short-lived signed URL scoped to the requesting driver;
never a guessable id. Retention and the legal minimum for issued documents are
an **open question for finance**, not an engineering default.

---

## 3E · Vehicle profile and Autocharge

Carries PROPOSED-H's invariant into the wire format.

```jsonc
{
  "vehicles": [{
    "vehicleId": "…",
    "nickname": { "value": "Bíllinn", "provenance": "asserted" },
    "registration": { "value": "AB123", "provenance": "asserted", "verifiedAt": null },
    "catalogRef": { "modelId": "tesla-model-y-lr-2023", "renderId": "tesla_model_y" },
    "displayColor": { "hex": "#1B2A3A", "finish": "metallic" },
    "identities": [
      { "kind": "evccid", "valueMasked": "…3F2A", "provenance": "observed",
        "confidence": "medium", "firstSeenAt": "…", "lastSeenAt": "…" }
    ],
    "autocharge": { "state": "not_enrolled", "consentAt": null, "revocableAt": null }
  }]
}
```

- **`catalogRef.renderId` references a bundled asset**; the API never serves OEM
  imagery. The 24 shipped renders stay client-side assets.
- **`displayColor` is stored separately from the model** — it is a user
  preference, not a vehicle fact.
- **`provenance` is mandatory on every attribute.** A user-entered plate is never
  promoted to `observed`.
- Autocharge state machine:
  `not_enrolled → pending_observation → enrolled → revoked`, with
  `replaced` for a new vehicle. Consent is captured at `enrolled`, revocation is
  always available, and revocation must not delete billing history.
- **EVCCID is masked** in driver-facing responses. It is a stable cross-site
  identifier, and full exposure gives a client something it has no use for.

---

## 3F · Access, credentials, contractor surfaces

```jsonc
// GET /api/driver/access
{ "organizations": [ { "orgId": "…", "displayName": "N1 ehf", "role": "driver",
                       "installations": [ { "installationId": "…", "displayName": "…",
                                            "chargerCount": 12 } ] } ],
  "pendingRequests": [ { "requestId": "…", "state": "pending", "requestedAt": "…" } ] }

// GET /api/driver/tokens
{ "tokens": [ { "tokenId": "…", "kind": "rfid", "labelMasked": "•••• 4821",
                "status": "active", "addedAt": "…" } ] }
```

- Token values are **never** returned; `labelMasked` only.
- `/installations` (`driver.ts:816`) and `/access-requests` (`driver.ts:867`)
  exist with no caller — this consolidates them into one access surface.
- Contractor surfaces are **deliberately excluded** until PROPOSED-K settles
  whether contractor access is a cross-tenant assignment. Designing the wire
  format first would bake in the wrong tenancy assumption.

---

## Consumer migration

| Client | Work | Risk |
|---|---|---|
| Flutter (`ae5db26`) | consume `cost` object; **remove the `0`-means-absent workaround** and the `/100` divide | **The divide must be removed in the same release the API stops sending aurar**, or 100× error |
| Web driver portal | archived; if restored, it reads `costIsk` and divides (`history/page.tsx:23`) — same coupling |
| Operator console | reads operator endpoints, unaffected by 3A–3F |
| Reporting | reads the ledger directly; unaffected until 3C changes projection fields |

**The migration order is not free.** Backend additive → mobile consumes new
fields → backend removes old. Any other order breaks money display.
