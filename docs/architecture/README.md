# Architecture — Reference of Work to be Done

> **This folder is the canonical reference for all V3 work on Straumvakt.**
>
> Every sprint, every milestone, every architectural question traces back
> to the documents here. If something you are about to build is not
> described or implied by these documents, stop and update them first —
> don't silently drift.

---

## The canonical documents

| Document | What it is | When you read it |
|---|---|---|
| [`STRAUMVAKT_ARCHITECTURE_V3.md`](./STRAUMVAKT_ARCHITECTURE_V3.md) | The architecture canon. Principles, seven-layer asset hierarchy, three integration tracks, commercial model, data retention, runtime, schemas, non-goals. | Any time you're making an architectural decision or adding a new module |
| [`STRAUMVAKT_V3_DELIVERY_PLAN.md`](./STRAUMVAKT_V3_DELIVERY_PLAN.md) | The execution canon. Scope, success criteria, 10 sprints × 3–5 milestones, open questions, risks, working conventions. | Start of every sprint, end of every sprint (retrospective check-in) |
| [`CHANGE_MANAGEMENT.md`](./CHANGE_MANAGEMENT.md) | The operating model. How to propose a change, draft an ADR, amend the plan, generate a migration, verify, commit, push. Six artefact layers · three-phase change flow · cold-reader entry path · worked rev-4 example. | Before drafting any architectural change · onboarding a new advisor / agent |
| [`straumvakt_architecture_v3.svg`](./straumvakt_architecture_v3.svg) | The visual map. Six horizontal lanes (Clients → Edge → Integration → Event Bus → Domain → Data) plus business hierarchy, commercial model, and principles insets. | Any time you need the big picture in one frame |
| [`data_flow_charger_to_ui.svg`](./data_flow_charger_to_ui.svg) | End-to-end data flow — one message followed from charger hardware to storage to UI. Labels each hop with service, language, and protocol. Inbound telemetry, read flow, and outbound command flow all in one frame. | Onboarding a new engineer, explaining the system to non-technical stakeholders, debugging "where did that event go?" |
| [`entity_relationships.svg`](./entity_relationships.svg) | How CPO, Driver, Site, and Connector relate. Two columns — people side (Driver → Family Group → CustomerPlan) and hardware side (Charger Host → Property → Site → Charger → OCPP Identity → Connector) — converging on the Charge Session as the binding row. | "How does a driver end up connected to a connector?" questions; data-model onboarding; explaining the 7-layer hierarchy without writing SQL |
| [`data-model.svg`](./data-model.svg) | Full schema map — every Postgres namespace and its tables in one frame. Three lanes (people / hardware / operations) plus a cross-cutting bottom row. Live indicators (●) mark namespaces being written to today vs. schema-only. | "What tables exist and which are wired up?" — onboarding new contributors, sanity-check before adding a model, single-page reference for ADR discussions |
| [`straumvakt_sprint_timeline.svg`](./straumvakt_sprint_timeline.svg) | Gantt-style timeline of the first two sprints. Done vs. next, milestone bars, "today" marker at the Sprint 0 / Sprint 1 boundary. Updated at each sprint transition. | Sprint kickoff / stakeholder update |
| [`straumvakt_roadmap.svg`](./straumvakt_roadmap.svg) | Phase-banded delivery roadmap. Three phases — Done (Foundation), Pilot (tightened scope per ADR 0005), Post-Pilot (tags A–F mapped back to sprint rows). Companion to the delivery plan. | Pilot scope conversations, board review, what-defers-to-when |
| [`cost_center_splitting_model.svg`](./cost_center_splitting_model.svg) | Cost-center splitting model (rev 3 pilot scope). Anchor hierarchy + schema entities + three worked scenarios (Krónan workplace · N1 anonymous · Krónan-employee at N1 with REPF cap). Supporting material for **ADR 0008 (in flight)**. | Designing or reviewing the billing pipeline; understanding factor → contract → cost-center resolution; verifying scenario math |

**Reading order for a first pass:** architecture → architecture diagram → delivery plan → roadmap (for "what's in pilot, what's deferred") → data flow diagram (for "how does it actually move").

---

## What these documents supersede

These are the source of truth going forward. Older documents remain in
the repo for historical context but are **no longer authoritative**
unless explicitly referenced from V3:

- `docs/scope/CPMS_Scope_v1.2_Stage1_Beta.docx` — superseded for
  architecture and scope; retained for domain-language reference.
- `docs/scope/CPMS_Scope_v2.0_Full.docx` — superseded as future vision;
  V3 architecture replaces it.
- `docs/scope/VSCODE_BRIEF_*.md` — superseded as session plans; V3
  delivery plan replaces session sequencing.
- `docs/notes/THREAD_*.md` — conversation artefacts; useful archaeology,
  not authority.

The older scope `.docx` files still carry useful detail on Icelandic
domain concepts (DSOs, retailer rate profiles, Auðkenni specifics, VSK
breakdown) — read them for those, not for architectural direction. **For
the live, edited list of Icelandic energy-market parties (retailers,
DSOs, TSO, public CPOs, charger-rental operators) and their tariffs, use
the reference catalogue under `docs/reference/` (see below) instead of
the older `.docx` files.**

---

## Vendor APIs (in-app, live)

Vendor cloud APIs + OCPP integration notes that the vendor adapter
track (architecture canon §5) consumes. Live pages inside the app —
they pull pinned snapshots when present and fall back to curated
reference otherwise. **Always reference the in-app pages first** —
they're the ones the operator console links to and that adapters
read against.

| Page | What it covers | Status |
|---|---|---|
| [`/reference/zaptec-api`](../../src/app/(app)/reference/zaptec-api/page.tsx) — *Zaptec API & OCPP* | Cloud REST surface (auto-rendered from `public/zaptec/openapi.json`) + Zaptec constants + OCPP 1.6J integration notes (identity convention, heartbeat, MeterValues cadence, vendor `DataTransfer` extensions) + V3 integration (Hardware Catalog row, Sprint 2.7 wizard, gateway path). | Snapshot synced; live OCPP traffic visible via Technical Read. |
| [`/reference/easee-api`](../../src/app/(app)/reference/easee-api/page.tsx) — *Easee API & OCPP* | Curated cloud-API reference (Sites / Circuits / Chargers / Sessions / Equalizer endpoint groups) + OCPP 1.6J / 2.0.1 notes + V3 integration roadmap. Auto-renders OpenAPI table when `public/easee/openapi.json` is vendored. | Curated only; adapter ships post-Zaptec when an Easee-shaped pilot installation enters scope. |
| [`/technical-read`](../../src/app/(app)/technical-read/page.tsx) — *Technical Read* | Live diagnostic iframe of `zaptec-test` on `:3100`. Real Zaptec OAuth credentials in `zaptec-test/.env` (not duplicated to Straumvakt) — exercises the cloud API + OCPP gateway end-to-end against actual hardware. | Live. Easee equivalent ships when the adapter does. |

**OCPP 1.6J spec** — external reference: the
[Open Charge Alliance](https://www.openchargealliance.org/) publishes the spec.
V3's translator boundary lives in
[`gateway/src/ocpp-frame.ts`](../../gateway/src/ocpp-frame.ts) and is
the only place 1.6J vocabulary touches Straumvakt code; everything
downstream consumes the canonical event vocabulary instead.

---

## Reference data (live, edited)

Tier-2 docs — not architectural canon, but kept up to date and consumed
by future migrations / seeds. Edit the markdown source first, then
regenerate the JSON.

| Document | What it is | When you read it |
|---|---|---|
| [`../reference/iceland-energy-parties.md`](../reference/iceland-energy-parties.md) | Human-edited catalogue of every Icelandic energy-market party Straumvakt cares about: retailers, DSOs, TSO, public CPOs, charger-rental operators. 21 parties, 168 tariff items, identity + contacts + tariff source URLs + per-line `ev_category`. | Tariff resolution design, billing-side cost calculation, driver-facing tariff comparison views, onboarding the energy domain. |
| [`../reference/iceland-energy-parties.json`](../reference/iceland-energy-parties.json) | Machine-readable seed payload (snake_case throughout). Becomes the seed for `energy.parties` + `energy.tariff_catalogue` when those models land. Includes `meta.role_legend`, `meta.ev_category_legend`, and `meta.maintenance_policy`. | Migration scripts, automated checks, "is the OV kennitala still 660877-0299?" sanity tests. |
| [`../reference/iceland-energy-parties.html`](../reference/iceland-energy-parties.html) | Self-contained themed mockup (Straumvakt brand tokens). Filter by role chip, toggle EV-only, search by kennitala / region. Useful for stakeholder demos before the real `/energy/parties` page is built. | Stakeholder show-and-tell, design alignment for the future page, sanity-checking the data visually. |
| [`../reference/logos/`](../reference/logos/) | Local PNG logos for ON, Orkusalan, HS Orka, Straumlind, N1, OV, Orka heimilanna. Stored locally to avoid third-party CDN dependence at render time. | Future asset migration to R2 / similar — these PNGs become the seed. |

---

## Working rules for anyone (including future-you) touching V3

1. **Architecture changes require an ADR** — even for yourself. Write
   a short entry under `docs/adr/NNNN-title.md`. The V3 architecture doc
   will point at ADRs for every load-bearing decision.

2. **Scope changes require an edit to the delivery plan** — if a sprint
   needs to change, change the plan first, then work. If you find
   yourself skipping a milestone, that's an amendment, not a quiet pass.

3. **The diagram stays in sync.** When the asset model, integration
   tracks, or commercial model change, update
   `straumvakt_architecture_v3.svg`. A stale diagram misleads more than
   it helps.

4. **"Foundations before floors" applies at every level.** Sprint N+1
   does not start until Sprint N's exit criterion has been met. The
   plan is a commitment to *order*, not dates.

5. **The 10 principles in the architecture doc are firm.** Violating
   one requires an ADR and explicit sign-off in the delivery plan's
   next retrospective.

---

## Reading-time estimates

- Architecture canon: ~20 minutes (first pass), 5 minutes (reference)
- Delivery plan: ~30 minutes (first pass), 10 minutes per sprint kickoff
- Diagram: 5 minutes

Budget an hour for the first complete read-through. Re-read the relevant
sprint at every sprint kickoff.

---

## Change log

Latest architectural change: **2026-04-26 — Control-plane optionality
accepted**. [ADR 0011](../adr/0011-control-plane-optionality.md)
reframes Straumvakt as the protocol-neutral operating/commercial layer
above native OCPP, OEM API control, hybrid control, external CPMS
overlay, and read-only intelligence. `OCPPIdentity` is now explicitly
a control endpoint, not the physical charger. Rollback anchor reserved:
`pre-control-plane-optionality-2026-04-26`.

| Date | Change | By |
|---|---|---|
| 2026-04-26 | **Change-management operating model documented** — [`CHANGE_MANAGEMENT.md`](./CHANGE_MANAGEMENT.md) added as a third governance doc alongside the architecture canon and delivery plan. Codifies the six-layer artefact stack (Rules · Decisions · Plans · Canon · State · History), the three-phase change flow (Propose → Commit-to-design → Land), the 11-step cold-reader entry path, and a worked rev-4 example showing the trail every architectural change should leave. Writeable by anyone proposing a change; constrains what an advisor can edit freely vs what needs explicit operator instruction. | Thor (with Claude) |
| 2026-04-26 | **Rev 4 checkpoint note** — [`docs/notes/2026-04-26-rev4-checkpoint.md`](../notes/2026-04-26-rev4-checkpoint.md). End-to-end review of rev-4 state: 4 accepted ADRs (0007/0008/0009/0010), 1826-line `schema.prisma` (validate ✅), 483-line consolidated migration generated and **not applied**, Prisma Client regenerated, tsc + npm run build both green, all routes smoke-200, Charger Hosts cleanly removed from UI/API/repo. File map + verification suite + pending operator decisions + suggested next sprint moves all captured. | Thor (with Claude) |
| 2026-04-26 | **Foundation rev 4 — drop ChargerHost + enrich Org/User profiles + OCPP configuration keys** ([ADR 0009](../adr/0009-drop-charger-host-tier.md) + [ADR 0010](../adr/0010-organization-profile-enrichment.md) accepted). ChargerHost tier dropped — Property attaches directly to Org; HostType classifier moves to `Site.site_type`; `hosts.charger_service_plans` removed (already obsolete since ADR 0008). Org gains `kennitala` + `vsk_nr` + `legal_name` + `legal_form` + `lei_code` + `default_currency` + `addresses` + `contacts` + `branding` + `regulator_licence_no` + `roles[]` (21-value `OrganizationRole` enum: csms_provider / operator / asset_owner / payer / beneficiary / customer / service_contractor / installer / vendor / retailer / dso / tso / producer / aggregator / public_charging / home_charging / emsp / roaming_hub / payment_processor / insurance_provider / regulator) + `notes`. User gains `kennitala` + `phone` + `locale` + `notes`. New `ocpp.configuration_keys` table populated by GetConfiguration / ChangeConfiguration round-trips — closes OCPP 1.6 spec gap. iceland-energy-parties.json (21 rows) seeded into `tenancy.organizations` with role mapping; Krónan / N1 NOT seeded (admin-creates at runtime). Schema lands in **one consolidated migration** in Sprint 2.6 covering ADRs 0007 + 0008 + 0009 + 0010 (`<ts>_rev3_foundation_consolidated`). Sprint 2.1 task list amended: `/tenants/hosts` UI removed; Org admin pages enriched with new profile fields; new milestone 2.14 wires the configuration_keys registry. Architecture canon §4 + §10 updated. Rollback anchors: `pre-host-drop-2026-04-26`, `pre-org-enrichment-2026-04-26`. | Thor (with Claude) |
| 2026-04-25 | **Iceland energy-market reference catalogue** added under [`docs/reference/`](../reference/). Three companion artifacts: edited markdown source of truth ([`iceland-energy-parties.md`](../reference/iceland-energy-parties.md)), machine-readable seed ([`iceland-energy-parties.json`](../reference/iceland-energy-parties.json), 21 parties / 168 tariff items / 8 active CPOs / 5 charger-rental operators), and themed mockup ([`iceland-energy-parties.html`](../reference/iceland-energy-parties.html)) served from the dev http-server. Covers retailers (ON, Orkusalan, HS Orka, Straumlind, N1 Rafmagn, OV, Orka heimilanna, Fallorka), DSOs (Veitur, RARIK, HS Veitur, OV, Norðurorka, Rafveita Reyðarfjarðar), TSO (Landsnet), public CPOs (Ísorka, Bílorka, Olís, N1 charging, Tesla), and charger-rental (Amper). New role `home_charging` introduced alongside `public_charging`. Brand PNGs stored locally under [`docs/reference/logos/`](../reference/logos/) (no third-party CDN dependency at render time). Designed as the seed payload for a future `energy.parties` + `energy.tariff_catalogue` model — column set spec lives in §2.4 / §3 of the markdown. Index entry added to "Reference data" section above. | Thor (with Claude) |
| 2026-04-26 | **Pilot scope rev 3 — cost-center splitting** ([ADR 0008](../adr/0008-cost-center-splitting.md) accepted). Adds milestones 2.10–2.13 to Sprint 2: runtime cost-factor catalog (8 factors seeded), per-tier inherited contracts via `parent_contract_id`, driver contracts with factor-level overrides, calendar-month period accumulators for kWh-cap rules. Schema lands in 2.6 alongside Circuit (consolidated migration `<ts>_add_circuit_and_billing_contracts`). `assets.chargers.owner_org_id` distinguishes hardware owner from operator org_id (Issue Engine routing post-pilot reads this). `identity.platform_admins` separate from tenant memberships for Straumvakt staff. Architecture canon §6 amended with the rev-3 operational layer; legacy CustomerPlan/ChargerServicePlan tables retained but unused during pilot. §10 schema list extended. Delivery plan §1, §2, §5 (Sprint 5 tariff engine becomes resolver), §9 (Sprint 6 dashboard splits by cost center) updated. SVG [`cost_center_splitting_model.svg`](./cost_center_splitting_model.svg) is canonical supporting material with 4 worked scenarios. Rollback anchor: git tag `pilot-rescope-rev2-2026-04-25`. | Thor (with Claude) |
| 2026-04-26 | **Cost-center splitting model SVG added** ([`cost_center_splitting_model.svg`](./cost_center_splitting_model.svg)) — initial draft preceding ADR 0008. Theme aligned with `entity_relationships.svg`. Four worked scenarios with full ex-VAT/inc-VAT breakdowns. Owner-vs-operator-vs-payer distinction surfaced. | Thor (with Claude) |
| 2026-04-25 | **Pilot scope rev 2 — admin-only platform** ([ADR 0006](../adr/0006-pilot-scope-rev2-2026-04-25.md) + [ADR 0007](../adr/0007-circuit-asset-tier-back.md)). Pilot reframed as *admin-functionality only*. **New Sprint 2** (Admin Onboarding + Zaptec API enrichment) and **new Sprint 4** (Data Storage Lifecycle) inserted. **Driver Experience** (old Sprint 3) and **Issue Engine** (old Sprint 5) entire sprints moved to post-pilot — tags B and D expanded. Sprint sequence renumbered (OCPI → Sprint 3, Commercial → Sprint 5, Billing → Sprint 6 unchanged, Push/Hardening/Multi-Tenant/Pilot Go-Live unchanged). **ADR 0007** re-adds the Circuit asset tier between Installation and SiteAsset (additive migration in milestone 2.6); architecture §4 hierarchy + §10 schema list updated. Delivery plan §1, §2, §5–§13, §14, §15 rewritten to match. Roadmap SVG replaced with rev 2 layout. Rollback anchor: git tag `pilot-rescope-rev1-2026-04-25`. | Thor (with Claude) |
| 2026-04-25 | **Pilot scope tightened** ([ADR 0005](../adr/0005-pilot-scope-tightening-2026-04-25.md)). Pilot reframed as *demonstrable platform*, not commercial release. Six topical groups (A–F) deferred to post-pilot: roaming/eMSP/OCPP 2.0.1, Auðkenni/QR start, multi-currency, advanced issue engine, real billing, payments + dunning + EU residency ceremony. Delivery plan §1.1/§1.2/§1.3/§2 + per-sprint sections §5/§6/§7/§8/§9/§11/§12/§13 updated. Architecture §11 non-goals split into "deferred from V3" vs "deferred from pilot". New roadmap SVG (`straumvakt_roadmap.svg`) added as canonical. Rollback anchor: git tag `pre-pilot-rescope-2026-04-25`. | Thor (with Claude) |
| 2026-04-25 | Data model schema map added (`data-model.svg`) — 18 Postgres namespaces, ~50 tables in one frame. Live indicators show which tables are being written to today (tenancy, identity, hardware, ocpp, events) vs. schema-only. Mirror copy lives at `public/data-model.svg` for serving via the dev server at `/data-model.svg`. | Thor (with Claude) |
| 2026-04-24 | Sprint 1 milestones 1.1–1.4 landed. `gateway/` Worker live: per-OCPPIdentity Durable Objects, Basic-Auth per identity, OCPP 1.6J envelope parser, signed ingest client via Cloudflare Service Binding. Delivery plan §4 and sprint timeline updated. 1.5 (E2E simulator test) is the remaining Sprint 1 milestone. | Thor (with Claude + VSCode Claude) |
| 2026-04-24 | Entity relationships diagram added (`entity_relationships.svg`) — CPO / Driver / Site / Connector and how the Charge Session binds them. People side and hardware side converging on one row. | Thor (with Claude) |
| 2026-04-24 | Data flow diagram added (`data_flow_charger_to_ui.svg`) — inbound telemetry, read, and outbound command flows in one frame, each hop labelled with service, language, and protocol. | Thor (with Claude) |
| 2026-04-24 | Sprint timeline diagram added (`straumvakt_sprint_timeline.svg`) — Gantt of Sprints 0–1 with "today" marker at the boundary. | Thor (with Claude) |
| 2026-04-24 | Sprint 0 closed. ADR 0003 supersedes milestone 0.3 (no CPMS backfill — clean rebuild). Catalog seed (Zaptec + Zaptec Pro, empty profile) landed. tsc / build / vitest green. Retro in `docs/retros/sprint-00.md`. | Thor (with Claude) |
| 2026-04-24 | Hardware catalog + Installations added (ADR 0002). Architecture §3/§4/§5/§10 updated; delivery-plan Sprint 0 gains milestone 0.6 (catalog seed) and `hardware` schema; Sprint 5 gains Hardware nav group. SVG diagram update pending. | Thor (with Claude) |
| 2026-04-24 | Initial V3 drop — architecture, delivery plan, diagram | Thor (with Claude) |

Append entries above this line as the documents evolve.
