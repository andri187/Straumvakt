# OpenADR — DSO capacity envelopes, VTN and VEN

> **Status: research and vendor assessment. No code, no ADR, not yet in any sprint.**
>
> This folder holds the technical groundwork for Straumvakt acting as a
> **VEN** (Virtual End Node) between a DSO capacity server and the charging
> estate. It is not currently Straumvakt scope — see *Before any code* below.

The thesis is not "adopt OpenADR." It is the replacement of static, predefined
grid variables (contracted power, nameplate rating, annual peak) with
continuously measured, requested, allocated and verified operating variables.
OpenADR 3.1.0 is one implementable interface for that, and currently the most
likely north-side choice. It is not the only one.

---

## The documents

| Document | What it is | When you read it |
|---|---|---|
| [`research-eu-nordic-dynamic-grid-2026-08-05.md`](./research-eu-nordic-dynamic-grid-2026-08-05.md) | **EU and Nordic state of play.** Directive (EU) 2024/1711 Article 6a — flexible connection agreements are now a legal framework obligation, EEA-relevant. Country-by-country Nordic position, Dutch product design, protocol reality. Sourced. | Before the next RARIK or Landsnet conversation; before revising the technical report |
| [`protocol-landscape.md`](./protocol-landscape.md) | The five candidate protocols, what each is actually for, and which are live in the market. OpenADR 2.0b / 3.1.0, IEEE 2030.5 (CSIP), OSCP, vendor REST. | Before any conversation about "which standard" |
| [`openadr-3.1.0-findings.md`](./openadr-3.1.0-findings.md) | Working notes on the 3.1.0 spec — the enumerations that matter, and six defects/ambiguities found in the published documents. | Before implementing anything against the 3.1.0 YAML |
| [`proof-of-interface.md`](./proof-of-interface.md) | Target architecture, the boundary split, and what a first closed-loop proof must and must not demonstrate. | Planning the pilot; scoping the VEN |
| [`poc-scope-of-work.md`](./poc-scope-of-work.md) | **Draft SOW** — PoC VTN with RARIK as Business Logic client and Driivz as VEN. Deliverables, interface spec, acceptance criteria, schedule to 1 Sept 2026, risks, commercial terms. | Before issuing anything to RARIK or Driivz |
| [`build-scope-dual-stack.md`](./build-scope-dual-stack.md) | **Internal engineering scope.** One envelope service, two protocol adapters (3.1.0 + 2.0b). Component breakdown, estimates, sequencing. Not client-facing. | Planning the build |
| [`vendors/`](./vendors/) | Per-CPMS protocol capability assessment. One file per vendor, evidence-classed. | Evaluating a CPMS; deciding where the translator terminates |

**Reading order:** protocol-landscape → proof-of-interface → vendors → 3.1.0 findings (only when building).

---

## Evidence classes

Mirrors the convention used in the external report, so material can move
between the two without reclassification.

| Class | Meaning |
|---|---|
| **Documented** | Stated in a vendor's or standards body's own published material, quoted or cited. |
| **Derived** | Direct logical/arithmetic consequence of documented material. |
| **Inferred** | Reasoned from multiple sources; explicitly not a disclosed fact. |
| **Pending** | Question asked, answer not yet received. Dated. |

---

## What deliberately does **not** live here

- **The external technical report** (*From static tariff variables to
  dynamically controlled grid capacity*). It draws on N1 operational
  knowledge and is prepared for N1 stakeholder engagement — it is N1 work
  product and belongs in N1's own store, not in this repository's history.
- **Correspondence with RARIK, Landsnet or any vendor.** Same reason, plus it
  keeps regulated-counterparty material out of a commercial platform repo.

Reference them here by title and date; don't copy them in.

---

## Before any code

Per `CLAUDE.md` Rule 11, this is a scope change. It needs:

1. An ADR in `docs/adr/` (next free number — 0046 is taken) covering the
   north-side protocol choice, the boundary split, and the VEN's position.
2. An edit to `STRAUMVAKT_V3_DELIVERY_PLAN.md` placing it in a sprint.

Neither exists yet. Research only until they do.
