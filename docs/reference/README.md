# Straumvakt reference docs

Start here:

- [`straumvakt-api-reference.md`](straumvakt-api-reference.md) - Straumvakt-facing API surface and vendor adapter map.
- [`integrations/README.md`](integrations/README.md) - vendor integration catalogue.
- [`integrations/shelly.md`](integrations/shelly.md) - Shelly controller API reference.
- [`integrations/unifi.md`](integrations/unifi.md) - UniFi network hardware API reference.
- [`iceland-energy-parties.md`](iceland-energy-parties.md) - Icelandic energy-market reference data.
- [`open-source-workflow-sources.md`](open-source-workflow-sources.md) - open-source CPMS workflow, functionality and testing references.
- [`revocation-and-charger-retirement-policies.md`](revocation-and-charger-retirement-policies.md) - agreed access revocation and charger retirement policies for implementation.
- [`installation-onboarding-policies.md`](installation-onboarding-policies.md) - agreed installation onboarding, knocking charger claims and add-one-charger policies.

## Next session checkpoint

Saved 2026-10-26 at the user's request before stopping for the night.

The installation onboarding and revocation/retirement policies linked above are agreed and saved. Installation onboarding includes vendor import, manual registration, knocking chargers, shared flows across authorised users, and adding one charger to an existing installation. These reference changes remain uncommitted.

Start next with a documentation-only implementation planning pass:

1. Read the agreed policies together with [the market SOW](../../SOW-market-phase.md) and [the new-build manifest](../notes/2026-08-28-the-new-build-manifest.md).
2. Map the complete installation onboarding flow first, then adding one charger, revocation and retirement into the roadmap. Identify manifest additions explicitly.
3. Produce a table of new-application components to reuse, legacy components suitable for deliberate harvest, missing connections, dependencies and acceptance scenarios. Plan web journeys alongside backend capabilities.
4. Review the resulting implementation brief before product code work. At this dated checkpoint, database work was separate and mobile UI was deferred; see the later correction below.

The next-session plan is a checkpoint, not authorisation to implement, migrate, deploy or run unattended work.

**Later scope finding, 2026-10-26:** Before turning that onboarding plan into
Sonnet's next assignment, use the [proposed market scope reconciliation](../notes/2026-10-26-market-scope-reconciliation.md). The fresh migration's missing
constraints and OCPP/access completion gates change the order of work. The
onboarding policies remain agreed; implementation sequencing is under review.

**Operator direction later on 2026-10-26:** The August SOW and old task list are
legacy. The linked reconciliation is now a working rebaseline for an OCPP 1.6J
first charger lifecycle with the web journey built alongside it. Its decisions
and older test claims need rechecking before a replacement SOW is adopted.

**Further clarification, 2026-10-26:** The first real Zaptec pilot uses OCPP
Cloud configured manually in Zaptec Portal, without a Zaptec API dependency.
A default ID tag with Zaptec authorisation disabled is a labelled test of the
session pipeline, not individual driver authentication. Mobile UI sequencing
is open, while the driver identity, grant and session backend must serve mobile
and web. See the updated [Zaptec reference](integrations/zaptec.md) and working
[scope reconciliation](../notes/2026-10-26-market-scope-reconciliation.md).
