# Homepage concept - human-readable Straumvakt explanation

**Status:** concept only. Not implemented in the app.
**Saved:** 2026-05-02
**Prototype:** [`homepage-concept.html`](homepage-concept.html)

This concept is a simplified homepage for explaining Straumvakt to non-technical operators, technicians, site owners, and finance users.

## Goal

Explain Straumvakt in one sentence:

> One place to run chargers, people, power, and billing.

The page should make Straumvakt feel like an operating layer for real charging sites, not just an OCPP dashboard.

## Source basis

The copy and visual model are based on:

- `README.md` - "A charging operating platform."
- `src/app/layout.tsx` - "Control · Overview · Convenience."
- `docs/architecture/STRAUMVAKT_ARCHITECTURE_V3.md`
  - event log as source of truth
  - control planes behind adapters
  - physical asset hierarchy
  - OCPP, vendor API, external CPMS, and read-only operating modes
  - billing, cost centers, contracts, and sessions

## Main homepage message

Straumvakt helps operators understand and manage EV charging sites. It keeps the physical reality clear:

- organizations
- properties
- sites
- installations
- circuits
- chargers
- meters
- modems
- controllers
- drivers
- sessions
- costs

## Visual model

The hero visual uses a simplified operating map:

```text
Operator / owner / payer
  -> Property and site
  -> Installation and circuits
  -> Chargers, meters, modems
  -> OCPP / vendor / CPMS
  -> Events and billing
```

This maps to the V3 architecture:

```text
Org
  -> Property
  -> Site
  -> Installation
  -> Circuit
  -> SiteAsset
  -> ChargingStation / Meter / Modem / Controller
  -> OCPPIdentity / VendorAssetRef / ExternalCpmsRef
```

## Plain-language sections

The concept has four explanation cards:

1. **What do we own or operate?**  
   Organizations, properties, sites, installations, circuits, chargers, connectors, meters, modems, and controllers are modeled as real physical things.

2. **How are chargers controlled?**  
   Each asset can be controlled through OCPP, OEM API, an external CPMS, or no control when the site is read-only.

3. **What happened?**  
   Every command, status change, session, fault, and meter reading is preserved as a canonical event.

4. **Who pays for what?**  
   Contracts, tariffs, cost centers, drivers, workplaces, owners, and service fees tie back to sessions and physical assets.

## Brand notes

- Uses the actual Straumvakt mark from `src/app/login/page.tsx`.
- Uses the existing dark brand palette from `tailwind.config.ts` and `src/app/globals.css`.
- Keeps copy simple and direct.

## Implementation notes

When implemented in the app:

- Build this as a real Next route, probably `/` or `/about`, not as a raw HTML file.
- Reuse the actual `StraumvaktMark` component instead of duplicating SVG.
- Replace inline CSS with Tailwind tokens.
- Keep the hero visual as semantic HTML/SVG, not a static image.
- Consider linking from the login page for unauthenticated visitors.
- Keep the page public-safe: do not expose tenant data, operational metrics, or internal endpoints.
