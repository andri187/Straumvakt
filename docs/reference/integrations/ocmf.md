# OCMF — Open Charge Metering Format reference

**Status:** reference data, not schema. Distilled from Bauer-Elektronik's *OCMF Open Charge Metering Format* specification (v1.0, the version Zaptec implements).
**Last verified:** 2026-04-26 against Zaptec Pro live data (`SignedMeterValue` StateId 554 and `chargehistory.SignedSession`).
**Primary use:** how to **parse** and **verify** the signed-meter envelopes that travel through the Zaptec REST API and inside OCPP `StopTransaction.transactionData`. Both surfaces emit the same byte-for-byte object — this file is the canonical reference for both.

---

## 1. What OCMF is

OCMF is a vendor-agnostic format for cryptographically-signed energy meter readings used in Eichrecht (German calibration law) and equivalent EU billing-grade contexts. The format is:

- **Self-contained:** every reading carries enough metadata (device, time, measurand, signature) to verify offline.
- **Signed by the meter:** signature is generated inside the MID (Measurement Instrument Directive) module of the charger, before any cloud round-trip.
- **Verifiable independently:** with the meter's public key, anyone can confirm a kWh value was produced by a specific certified meter at a specific time.

This makes OCMF the **legal billing receipt** for charging sessions in Iceland, Germany, Norway, and other EU markets. Zaptec emits it natively. Easee does not (it's an add-on).

---

## 2. Wire format

Three pipe-delimited segments:

```
OCMF|<json-payload>|<signature>
```

| Segment | Content |
|---|---|
| `OCMF` | Magic literal — every payload starts here |
| `<json-payload>` | UTF-8 JSON with the readings + metadata (see §3) |
| `<signature>` | Hex-encoded signature over the JSON segment (see §6) |

When OCMF appears inside OCPP MeterValues with `format: "SignedData"`, the entire string above is what's sent. Inside Zaptec's `SignedMeterValue` (StateId 554) and `chargehistory.SignedSession`, the same triple-pipe form is what you read.

> [!IMPORTANT]
> The signature is a binary verification artifact. **Do not modify or reformat the JSON segment** before verification — even adding whitespace will invalidate the signature. Pass the raw byte sequence between the pipes verbatim into the verifier.

---

## 3. JSON payload — field reference

Top-level keys. All are short — OCMF uses two-letter abbreviations to keep the payload small.

| Key | Type | Meaning |
|---|---|---|
| `FV` | string | Format Version (e.g. `"1.0"`) |
| `GI` | string | Gateway Identification (vendor + model — `"ZAPTEC PRO"`) |
| `GS` | string | Gateway Serial — the device serial (`"ZCS032822"` for Festi 5) |
| `GV` | string | Gateway Version — firmware version (`"3.2.2.0"`) |
| `PG` | string | **Pagination Tag** — `"T<n>"` for transaction with sequence n, `"F<n>"` for full register, `"O<n>"` for outside-of-transaction reading (see §4) |
| `MV` | string? | Meter Vendor (optional; absent on Zaptec) |
| `MM` | string? | Meter Model (optional) |
| `MS` | string? | Meter Serial (optional; same as `GS` on Zaptec Pro) |
| `MF` | string? | Meter Firmware version |
| `IS` | boolean? | Identification Status (true = identified user) |
| `IL` | string? | Identification Level (`"NONE"`/`"HEARSAY"`/`"TRUSTED"`/`"VERIFIED"`/`"CERTIFIED"`/`"SECURE"`/`"MISMATCH"`/`"INVALID"`/`"OUTDATED"`) |
| `IF` | array<string>? | Identification Flags — controls how `IT` and `ID` are interpreted |
| `IT` | string? | Identification Type (`"NONE"`/`"DENIED"`/`"UNDEFINED"`/`"ISO14443"`/`"ISO15693"`/`"EMAID"`/`"EVCCID"`/`"EVCOID"`/`"ISO7812"`/`"CARD_TXN_NR"`/`"CENTRAL"`/`"CENTRAL_1"`/`"CENTRAL_2"`/`"LOCAL"`/`"LOCAL_1"`/`"LOCAL_2"`/`"PHONE_NUMBER"`/`"KEY_CODE"`) |
| `ID` | string? | Identification Data — RFID hex, EMAID, etc. |
| `CT` | string? | Charging Tariff |
| `CI` | string? | Contract ID |
| `RD` | array | **Reading Data** — the actual meter samples (see §3.1) |

### 3.1 `RD` — readings array

Each entry is a sample tuple:

| Key | Type | Meaning |
|---|---|---|
| `TM` | string | **Time stamp** with sync flag suffix (`" R"` realtime / `" S"` synchronised / `" U"` unsynchronised / `" I"` informative) |
| `TX` | string? | **Transaction Boundary**: `"B"` = Begin, `"C"` = Charging, `"X"` = Exception, `"E"` = End, `"L"` = Login, `"P"` = Power loss, `"R"` = Reset, `"A"` = Alignment, `"T"` = periodic Tick |
| `RV` | string | **Reading Value** — cumulative meter register value (string-encoded number) |
| `RI` | string | **Reading Identification** — OBIS code, e.g. `"1-0:1.8.0"` for cumulative active import |
| `RU` | string | **Reading Unit** — `"kWh"` / `"Wh"` / `"varh"` / etc. |
| `RT` | string? | Reading Type — e.g. `"AC"` / `"DC"` |
| `EF` | string? | Error Flags |
| `ST` | string | **Status** — `"N"` (normal), `"T"` (transient error), `"P"` (permanent error), `"G"` (grace period) |

### 3.2 Live example — Festi 5 completed session (verbatim)

This is the actual `RD` array from Festi 5's `CompletedSession` blob on 2026-04-24, abbreviated to the first three readings + last three:

```json
{
  "FV": "1.0",
  "GI": "ZAPTEC PRO",
  "GS": "ZCS032822",
  "GV": "3.2.2.0",
  "PG": "T1",
  "RD": [
    { "TM": "2026-04-24T12:35:49,183+00:00 R", "TX": "B", "RV": "15865.573", "RI": "1-0:1.8.0", "RU": "kWh", "RT": "AC", "ST": "G" },
    { "TM": "2026-04-24T12:45:01,304+00:00 R", "TX": "T", "RV": "15865.951", "RI": "1-0:1.8.0", "RU": "kWh", "RT": "AC", "ST": "G" },
    { "TM": "2026-04-24T13:00:00,670+00:00 R", "TX": "T", "RV": "15866.709", "RI": "1-0:1.8.0", "RU": "kWh", "RT": "AC", "ST": "G" },
    "...",
    { "TM": "2026-04-24T16:00:00,437+00:00 R", "TX": "T", "RV": "15876.048", "RI": "1-0:1.8.0", "RU": "kWh", "RT": "AC", "ST": "G" },
    { "TM": "2026-04-24T16:15:00,244+00:00 R", "TX": "T", "RV": "15877.05",  "RI": "1-0:1.8.0", "RU": "kWh", "RT": "AC", "ST": "G" },
    { "TM": "2026-04-24T16:21:06,933+00:00 R", "TX": "E", "RV": "15877.476", "RI": "1-0:1.8.0", "RU": "kWh", "RT": "AC", "ST": "G" }
  ]
}
```

Session energy = `15877.476 - 15865.573 = 11.903 kWh`. That's the same number that appears in `CompletedSession.Energy` and as the row in `chargehistory.Energy`.

---

## 4. Pagination tag (`PG`)

The `PG` field tells the verifier what kind of envelope this is and how it relates to others:

| Pattern | Meaning |
|---|---|
| `T<n>` | Transaction n (one envelope per session) |
| `F<n>` | Fiscal / register reading n (continuous lifetime register snapshot, not tied to a transaction) |
| `O<n>` | Outside-of-transaction reading n |

Zaptec uses `"T<n>"` for completed-session envelopes (`StateId 723.SignedSession`, `chargehistory.SignedSession`) and `"F<n>"` for the live lifetime register (`StateId 554 SignedMeterValue`).

---

## 5. Time stamp format

The `TM` field uses ISO 8601 with one extension:

```
YYYY-MM-DDTHH:MM:SS,ffffff+HH:MM <flag>
```

- **Comma decimal separator** for fractional seconds (per ISO 8601 strict, not RFC 3339 dot). Parsers must accept the comma.
- **Trailing space + flag letter:**
  - `R` — realtime, clock has been validated (e.g. against NTP)
  - `S` — synchronised once but not currently
  - `U` — unsynchronised, free-running
  - `I` — informative, not authoritative

Live-data observation: Zaptec Pro on Festi 5 emits all timestamps with the `R` (realtime) flag.

### 5.1 Parser pseudocode

```ts
function parseOcmfTimestamp(tm: string): Date {
  const m = tm.match(/^(.+?)\s([RSUI])$/);
  if (!m) throw new Error("Bad TM");
  const [, raw] = m;
  // Flip comma → dot for fractional seconds; Date.parse needs dot
  return new Date(raw.replace(",", "."));
}
```

---

## 6. Signature

Format depends on the meter's certificate. Zaptec Pro uses **secp256r1 ECDSA** (NIST P-256) with the public key exposed via `MIDPublicKey` (StateId 981).

### 6.1 Signature segment grammar

```
<signature> = <SA><SE><SD>
```

Three sub-fields concatenated, each with a fixed format. In practice for Zaptec, the signature segment is hex-encoded and ~144 characters.

| Sub-field | Meaning |
|---|---|
| `SA` | Signature Algorithm — e.g. `"ECDSA-secp256r1-SHA256"` |
| `SE` | Signature Encoding — e.g. `"hex"` / `"base64"` |
| `SD` | Signature Data — the actual signature bytes |

**To verify**:

1. Take the raw bytes between the **first** `|` and the **last** `|` (the JSON segment, without trimming whitespace).
2. SHA-256 hash those bytes.
3. ECDSA-verify the signature in `SD` against the hash, using the public key from StateId 981.

### 6.2 Verification pseudocode

```ts
import { createHash, createVerify, KeyObject } from "node:crypto";

function verifyOcmf(envelope: string, publicKey: KeyObject): boolean {
  const firstPipe = envelope.indexOf("|");
  const lastPipe = envelope.lastIndexOf("|");
  if (firstPipe < 0 || lastPipe <= firstPipe) return false;

  const json = envelope.slice(firstPipe + 1, lastPipe);
  const sig = envelope.slice(lastPipe + 1);

  // Zaptec Pro: hex-encoded ECDSA(SHA-256, secp256r1)
  const sigBytes = Buffer.from(sig, "hex");

  const v = createVerify("SHA256");
  v.update(json, "utf8");
  return v.verify(publicKey, sigBytes);
}
```

If the verifier returns `false`, **do not bill against the reading** — escalate to operator review.

---

## 7. Cumulative-vs-delta — the most-common mistake

`RV` is **always cumulative** — the meter's lifetime register at the moment `TM` was sampled. To compute session energy you subtract:

```ts
const sessionKwh = Number(rd.at(-1).RV) - Number(rd[0].RV);
```

In the Festi 5 example: `15877.476 − 15865.573 = 11.903`. **Never sum `RV` values across an array** — that gives you a meaningless cumulative-of-cumulative number.

For interval breakdowns:

```ts
const intervals = rd.map((r, i) => ({
  startedAt: parseOcmfTimestamp(r.TM),
  cumulative: Number(r.RV),
  delta: i === 0 ? 0 : Number(r.RV) - Number(rd[i - 1].RV),
  context: r.TX,  // B / T / E
}));
```

---

## 8. Status flags (`ST`)

| Flag | Trust |
|---|---|
| `N` | Normal — clean reading |
| `T` | Transient error — meter recovered; reading usable but flagged |
| `P` | Permanent error — meter calibration suspect; reading unsafe to bill |
| `G` | Grace period — meter currently in calibration window or just powered up |

Live observation: Festi 5 emits `"G"` consistently — the meter is in grace because its MID calibration date is older than the period the firmware tracks. This is **not** a fault — it just means the legal weight of the reading is reduced. The OCMF envelope is still cryptographically valid; whether you accept it for billing is a policy decision.

---

## 9. Where Zaptec puts OCMF

| Surface | Field | Pagination prefix |
|---|---|---|
| Zaptec REST: `GET /api/chargers/{id}/state` | StateId 554 `SignedMeterValue` | `F<n>` (full register) |
| Zaptec REST: `GET /api/chargers/{id}/state` | StateId 555 `SignedMeterValueInterval` | `F<n>` interval slice |
| Zaptec REST: `GET /api/chargers/{id}` | `SignedMeterValue` field | mirror of StateId 554 |
| Zaptec REST: `GET /api/chargehistory` | `Data[].SignedSession` | `T<n>` |
| Zaptec REST: `GET /api/chargers/{id}/state` | StateId 723 `CompletedSession.SignedSession` | `T<n>` |
| OCPP 1.6J: `MeterValues` | `meterValue[].sampledValue[].value` with `format = "SignedData"` | depends on context |
| OCPP 1.6J: `StopTransaction` | `transactionData[].sampledValue[].value` with `format = "SignedData"` | `T<n>` |

Easee does **not** emit OCMF natively as of 2026-04. Their lifetime register (StateId 124) is a plain double.

---

## 10. Verification flow for Straumvakt billing pipeline

When an OCMF envelope lands in `MeterValue.SignedData` (V3 schema):

1. **Look up the public key** from `assets.charger.metadata.MIDPublicKey` (cached from StateId 981 during onboarding).
2. **Verify the signature** (§6).
3. If valid, parse the JSON (§3) and extract the relevant `RD[]`.
4. Compute deltas (§7) and persist as `MeterValue` rows tagged with the source envelope's hash.
5. If invalid, **never silently drop** — write to `events.event_log` with `eventType = "ocmf.signature_failed"` and surface to the Issue Engine.

---

## 11. References

- [OCMF Specification (Bauer-Elektronik)](https://github.com/SAFE-eV/OCMF-Open-Charge-Metering-Format) — canonical document.
- [Eichrecht Konformitäts-Bewertung](https://www.physikalisch-technische-bundesanstalt.de/) — German calibration-law context.
- [OCPP 1.6 Edition 2 — § 5.1.5 SampledValue.format](https://www.openchargealliance.org/protocols/ocpp-16/) — embedding rule.
- Live observations: Festi 5 (`ZCS032822`) — Dalvegur 10–14, 2026-04-22 to 2026-04-26.
