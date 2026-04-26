# Vendor integrations — reference catalogue

**Status:** reference data, not schema. Vendor-specific notes — protocol surface, auth quirks, observation catalogues, OCPP behaviour — that the production adapters under V3's `vendors` / `hardware` schemas will draw on.
**Scope:** AC vendor-managed chargers (`credential_scope = installation` per architecture §10). DC adapters (Kempower, Tritium, ABB) will land here in Phase 4 with `credential_scope = identity`.
**Used by:** the production adapter modules (forthcoming) and the **Technical Read** tab in the admin UI (Sprint 1.5 detour) which iframes the `zaptec-test/` scratch app.

---

## Adapter docs

| File | Vendor | Live data | Hardware tier |
|---|---|---|---|
| [`zaptec.md`](zaptec.md) | Zaptec AS · Norway | **Yes — Dalvegur 10–14, 20 chargers** | AC (Pro / Go / Go 2 / Apollo) |
| [`easee.md`](easee.md) | Easee AS · Norway | No (docs + community library only) | AC (Home / Charge / One / Up) + Equalizer meter |

When a vendor file says "(unverified)" against a value, that value is sourced from documentation or a community library, not first-hand observation. Mark verified after the first probe and remove the tag.

---

## Common shape

All AC vendor-managed adapters in V3 share the same skeleton — credentials at the installation row, REST + push channel, OCPP 1.6J as a parallel control plane:

```
Org (CPO)
 └─ ChargerHost
     └─ Property
         └─ Site
             └─ Installation        ← credentials live here  (`credential_scope = installation`)
                 ├─ Circuit         ← load-balancing group
                 └─ SiteAsset (Charger)
                     └─ OCPPIdentity
                         └─ Connector
```

Each vendor doc covers **the same eleven sections** so cross-vendor work translates 1:1:

1. Vendor profile
2. Authentication
3. REST API surface
4. Constants / enum endpoint (or its absence)
5. State observations (full ID catalogue, grouped)
6. Bitmasks (warnings + features)
7. Commands
8. OCPP integration (auth modes + local auth list semantics)
9. Real-time push (transport + token shape)
10. Live findings (what differs from public docs after probing real hardware)
11. Sources + companion artifacts

The Zaptec doc has all eleven populated; the Easee doc has §10 deferred until the first live probe and §11 listing planned scratch-app artifacts.

---

## Connection to the V3 schema

Per [`STRAUMVAKT_ARCHITECTURE_V3.md`](../../architecture/STRAUMVAKT_ARCHITECTURE_V3.md) §5 and §10:

| V3 entity | What this catalogue informs |
|---|---|
| `hardware.HardwareVendor` | one row per vendor here · `slug = "zaptec" \| "easee" \| ...` |
| `hardware.HardwareModel.profile` | technical-fields template — derived from vendor doc §1, §3, §5 |
| `hardware.HardwareModel.credentialScope` | `installation` for everything documented here |
| `properties.installations.vendorInstallationRef` | the vendor's own installation/site UUID |
| `properties.installations.credentialsRef` | secret-store key for the OAuth/JWT credential set |
| `properties.installations.metadata` | vendor-specific extras (Zaptec `OcppCloudUrl`, Easee Site stats, Equalizer pairing, etc.) |
| `ocpp.ocpp_identities.identityString` | OCPP charge-box id (from Zaptec's `OcppCloudUrl` path tail or Easee's backplate id) |

When a new vendor is added, copy the eleven-section template, fill in §1–9 from public docs, then probe a real charger and complete §10. The Zaptec doc is the reference pattern.

---

## Cross-vendor mapping (quick lookup)

A few common operations and where they live in each vendor's API:

| Operation | Zaptec | Easee |
|---|---|---|
| Auth | `POST /oauth/token` (form, `scope=openid`) | `POST /api/accounts/login` (JSON) |
| List installations / sites | `GET /api/installation` | `GET /api/sites` |
| List chargers | `GET /api/chargers?InstallationId=…` | `GET /api/sites/{id}/circuits` (chargers nested) |
| Live state | `GET /api/chargers/{id}/state` | `GET /api/chargers/{id}/state` |
| Stop session | `POST /api/chargers/{id}/sendCommand/506` | `POST /api/chargers/{id}/commands/stop_charging` |
| Reboot | `POST /api/chargers/{id}/sendCommand/102` | `POST /api/chargers/{id}/commands/reboot` |
| Real-time push | Service Bus AMQP per-installation topic | SignalR global hub, JWT-gated |
| Constants / enums | `/api/constants` (single doc) | scattered; use `pyeasee/const.py` |
| Lifetime kWh signed | OCMF (StateId 554) free | add-on feature |

The unified `ActionsPanel` in `zaptec-test/` already groups commands by outcome rather than transport — adding Easee transports is purely a matter of extending the action catalogue, not redesigning the UI.

---

## When to update these docs

- **After the first live probe of a new vendor** — populate or correct §5 (state observations) and §10 (live findings).
- **When a vendor publishes a breaking change** — token format, endpoint move, observation rename. Bump the "Last verified" date in the file header.
- **When a `/api/constants`-style enum dump is refreshed** — re-export and update the companion artifact path in §11.
- **When the V3 schema gains a field that needs vendor mapping** — add a row to the §11 table or to the cross-vendor lookup above.

Edit the `.md` first; if a JSON companion exists (`zaptec-constants.json`), regenerate from a probe rather than hand-editing.
