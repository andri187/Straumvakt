# Protocol landscape

Five candidates surface in every conversation about DSO→CPO dynamic
communication. They are not equivalent, and three of them are not really
competing for the same job.

---

## The candidates

| Protocol | What it is actually for | Transport / security | Live where | Verdict |
|---|---|---|---|---|
| **OpenADR 3.1.0** | Demand response and, since 3.x, dynamic operating envelopes. Program / event / report object model. | REST + JSON, OAuth 2.0 client credentials, TLS 1.2+ | New deployments; the version the Alliance is pushing | **North-side choice.** A DSO can stand it up in days — no PKI to procure or operate. |
| **OpenADR 2.0b** | Same problem, previous generation. | SOAP-like XML, XMLDSig, optional EXI, x.509 client certs from OpenADR PKI | Californian utility DR programmes; most existing CPMS integrations | Legacy. Incompatible wire format with 3.x. Avoid setting a *national* interface to it. |
| **IEEE 2030.5 (SEP 2.0) / CSIP** | Device-level DER control. `DERControl` with `opModImpLimW` / `opModExpLimW` — import/export limits. | XML/EXI, TLS with client certificates, PKI-heavy | California Rule 21; **CSIP-AUS (SA HB 218:2023)** — the most mature DOE deployment in the world | **Genuine peer standard, not an also-ran.** See below. |
| **OSCP 2.0** | DSO→CPO *capacity forecast* per group. Closest data model to what a DSO actually wants. | REST/JSON | Netherlands, some EU | Open Charge Alliance state it is **not actively managed or developed**. Data model is right; stewardship is the problem. |
| **Vendor REST APIs** | Whatever the vendor built. | Bearer tokens, per-vendor object models | Everywhere | Fine below the boundary. Fatal above it — see *the demo trap*. |

---

## IEEE 2030.5 deserves more weight than it usually gets

The primitives map almost one-to-one:

| OpenADR 3.1.0 | IEEE 2030.5 |
|---|---|
| `IMPORT_CAPACITY_LIMIT` | `DERControl.opModImpLimW` |
| `EXPORT_CAPACITY_LIMIT` | `DERControl.opModExpLimW` |

Same concept, different wire format and a very different security model.

The awkward fact: **CSIP-AUS, the reference deployment for Dynamic Operating
Envelopes, is 2030.5-based, not OpenADR.** Any argument that OpenADR is *the*
DOE interface has to survive that. It does — but on its merits, not by
omission:

- **For OpenADR 3.1.0:** REST/JSON/OAuth. No PKI. A DSO with a web team can
  operate it. Onboarding a new counterparty is issuing a clientID, not
  enrolling a certificate.
- **For 2030.5:** deeper production track record for exactly this use case,
  device-level granularity, and certification (SunSpec) that vendors already
  hold.

The honest framing in any stakeholder document is *peer standards, chosen for
operational cost of ownership* — not *OpenADR is the standard*.

---

## The demo trap

A proprietary vendor API can demonstrate closed-loop boundary control quickly
and convincingly. It will also demonstrate that you do not need a standard to
do it — from which a DSO reasonably concludes *"we'll just integrate each
CPO's API."*

That is the fragmented outcome the whole exercise exists to prevent, and it
scales terribly: N CPOs means N APIs, N credential sets, N portals, and the
DSO holding accounts on commercial platforms it does not control.

**Rule: north side principled, south side pragmatic.**

```
DSO VTN (OpenADR 3.1.0)
        │
        ▼
Straumvakt VEN  ──►  translation
        │
        ▼
whatever the CPMS speaks  ──►  OCPP  ──►  chargers
```

The DSO-facing leg is standard because that is what has to be interoperable
and long-lived. The vendor-facing leg is whatever is fastest, because it is
replaceable.

Protocol fragmentation is not an obstacle to the VEN layer. It is the reason
the VEN layer has value.
