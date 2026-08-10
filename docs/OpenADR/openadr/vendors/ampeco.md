# AMPECO — protocol capability assessment

**Assessed:** 2026-08-05
**Status:** Enquiry sent, no answer yet.

Under evaluation as a candidate to replace Driivz — for reasons broader than
protocol support. OpenADR capability is a legitimate tiebreaker, **not** a
reason to migrate a CPMS on its own. A platform change means chargers, driver
accounts, RFID tokens, billing history, OCPI roaming, tariffs and every
existing integration.

---

## Question asked

Whether AMPECO is OpenADR **2.0b or 3.x**, and whether **certified or merely
supported**. That is the correct framing — certification is per product, per
role, per version, per profile, and "supports OpenADR" is a much weaker claim
than a certificate number.

## Reading the answer when it comes

| Answer | Meaning |
|---|---|
| "2.0b" | Same position as Driivz. No gain on this axis. |
| "3.0" / "3.x" | Demand a sample payload before believing it. Check for `signalName` — its presence means 2.0b semantics whatever the transport. Check for `payloadType`, `intervals[]`, `valuesMap`. |
| "On our roadmap" | Means no. CPMS roadmap dates are soft. |
| "No, but we have an open API for site limits" | Honest, and entirely sufficient under the translator architecture. |
| "Certified" | Ask for the certificate number and check the Alliance's certified product listing. |

---

## The questions that actually decide it

Protocol version matters far less than these four, which apply to every CPMS
and are the real evaluation criteria:

1. **Is a site-level import power limit settable via API** — not only via the
   operator portal?
2. **What is the enforcement latency** from API call to measured site power?
3. **What happens on loss of contact** — hold, revert to a configured default,
   or drop the limit?
4. **Does the limit persist across restarts?**

Ask #4 first. Driivz fails it outright — events held in memory, lost on crash
or topology refresh, requiring the VTN to re-send. A grid limit that
evaporates rather than failing safe is a better reason to look elsewhere than
any protocol version, and it sets the bar AMPECO has to clear.

---

## Timing constraint

A CPMS migration cannot complete before the first proof. Whatever is decided
about AMPECO, the proof runs on what exists now — or on our own VEN driving a
site whose chargers we control. The migration option does not solve the
near-term vendor question.

## Pending

| Question | Status |
|---|---|
| OpenADR: version, role, certified vs supported | Asked, awaiting reply |
| Site-limit API, enforcement latency, comms-loss behaviour, restart persistence | Not yet asked — ask alongside |
