# SteVe — OCPP 1.6 CSMS for development

**Status:** development tool reference (not a production integration).
**Last verified:** 2026-05-03.
**Used by:** Straumvakt engineers who need a known-good CSMS to compare against, or a quick way to drive a real charger when developing the gateway.

> SteVe is **not** part of the Straumvakt production stack. It is the OCPP 1.6
> equivalent of "what does Postgres think this query means?" — when our gateway
> behaves unexpectedly, SteVe is the cheap second opinion.

---

## 1. What it is

[SteVe](https://github.com/steve-community/steve) is a Java/Spring open-source
CSMS (Central System Management System) maintained by the steve-community fork
of the original RWTH Aachen project. It speaks **OCPP 1.6 SOAP and 1.6J
WebSocket**, ships with a web UI for chargers/transactions/reservations, and is
the de-facto reference CSMS in industry — most charger vendors test against it
before shipping firmware.

| Property | Value |
|---|---|
| Licence | GPL-3.0 |
| OCPP versions | 1.2, 1.5, 1.6 (SOAP + JSON) |
| OCPP 2.0.1 | **No** — out of scope |
| Plug & Charge / ISO 15118 | **No** |
| SmartCharging | Partial (SetChargingProfile UI exists) |
| Storage | MySQL / MariaDB |
| Runtime | Java 17 + Maven (or Docker) |
| UI | Web admin on `:8080` |
| Auth | Basic auth on web UI; OCPP-side optional Basic auth |

## 2. Why Straumvakt would use it

Three concrete use cases, in order of frequency:

1. **Reference CSMS for OCPP 1.6J behaviour.** When our gateway DO replies to a
   `BootNotification` differently from what a real charger expects, point the
   same charger at SteVe and diff the wire frames. SteVe's responses are the
   industry baseline.
2. **Drive a real charger without Straumvakt running.** If you have a Zaptec
   Pro or used Easee on the bench and Straumvakt staging is down or
   mid-migration, SteVe gives you a working CSMS in five minutes so you can
   keep testing the hardware.
3. **Cross-check our local-auth-list and reservation logic.** SteVe's UI
   exercises `SendLocalList`, `ReserveNow`, `RemoteStartTransaction`,
   `ChangeAvailability`, etc. with no ambiguity — useful when tracking down a
   "did the charger reject our payload or did our payload not arrive" bug.

It is **not** a replacement for the Straumvakt gateway, the queue-backed
ingest path, the cabinet allocator, or any Phase 4 DC work — those problems
are out of scope for SteVe.

## 3. Run it locally (Docker, fastest path)

The maintained image is `steve-community/steve` (check the repo for the
current tag). The simplest setup is a `docker-compose.yml` with MariaDB +
SteVe.

Suggested `e:\Claude\steve-dev\docker-compose.yml`:

```yaml
version: "3.9"
services:
  mariadb:
    image: mariadb:10.11
    environment:
      MARIADB_ROOT_PASSWORD: changeme
      MARIADB_DATABASE: stevedb
      MARIADB_USER: steve
      MARIADB_PASSWORD: changeme
    volumes:
      - steve-db:/var/lib/mysql
    ports:
      - "3306:3306"

  steve:
    build:
      context: https://github.com/steve-community/steve.git
    depends_on:
      - mariadb
    environment:
      DB_HOST: mariadb
      DB_PORT: "3306"
      DB_DATABASE: stevedb
      DB_USER: steve
      DB_PASSWORD: changeme
      STEVE_HOST: 0.0.0.0
      STEVE_PORT: "8080"
    ports:
      - "8080:8080"   # web UI + OCPP-J WebSocket
      - "8443:8443"   # OCPP-S SOAP (rarely used)

volumes:
  steve-db:
```

Bring it up:

```powershell
cd e:\Claude\steve-dev
docker compose up -d
```

Open the web UI at `http://localhost:8080/steve/manager/home` — default
credentials are in the SteVe README (`admin` / `1234`; change on first run).

> The official image build path in the repo changes from time to time. If the
> `build:` form above fails, check the SteVe README for the current "Run with
> Docker" instructions and substitute the published image tag.

## 4. Configure SteVe to accept a charger

Two pieces are required: a **ChargeBox row** for the charger's identity, and
the **OCPP endpoint URL** the charger should dial.

In the web UI:

1. **Data Management → Charge Points → Add New** — set:
   - `chargeBoxId` (must match the charger's identity — e.g. `ZAP123456`)
   - leave the rest blank for a quick test
2. The OCPP-J endpoint is `ws://<host>:8080/steve/websocket/CentralSystemService/<chargeBoxId>`
3. On the charger, configure:
   - CSMS URL = the WebSocket URL above
   - OCPP version = 1.6J (JSON)
   - HTTP Basic auth = off (or set a password and configure SteVe to require it)
4. Reboot the charger; it should appear in **Operations → ...** with status
   `Available` once the BootNotification round-trip completes.

## 5. Cross-check Straumvakt against SteVe

Recommended pattern when chasing a wire-level issue:

```
Charger
  -> ws://localhost:8080/steve/websocket/CentralSystemService/ZAP123456
  (compare responses)
  -> wss://hlada-ocpp-staging.straumvakt.workers.dev/<identity>
```

Tooling:

- **`wireshark` with the WebSocket dissector** for raw frames.
- **`tcpdump -i lo -A -s 0 'tcp port 8080'`** if running SteVe locally on
  Linux.
- **`wrangler tail straumvakt-ocpp-staging`** for the Straumvakt side
  (per `gbtNotes/staging_deploy_half_fixed.md` patterns).

When a charger behaves differently against SteVe vs Straumvakt:

- **Charger-side problem**: same wire frames in both directions, same
  charger reaction → not the CSMS.
- **Straumvakt-side problem**: SteVe's reply works, Straumvakt's reply
  doesn't → diff the JSON. Common offenders are `BootNotification`
  `interval` field shape, `MeterValues` `sampledValue` array nesting, and
  `Authorize` `idTagInfo.status` casing.

## 6. Use SteVe to drive a charger Straumvakt does not yet support

If a vendor model isn't in `hardware.models` yet but is on the bench (e.g.
a borrowed Alfen or an Autel AC unit), SteVe can take it through full
session lifecycle while we model the catalogue entry:

1. Add ChargeBox in SteVe.
2. Boot charger against SteVe; observe its real BootNotification payload,
   model name, firmware, supported features.
3. Capture wire traces of the full session (BootNotification → Authorize
   → StartTransaction → MeterValues → StopTransaction).
4. Use the captures to write the `docs/reference/integrations/<vendor>.md`
   "Live findings" section before the production adapter ships.

This is the lowest-cost way to onboard a new AC vendor without standing
up a full Straumvakt environment for it.

## 7. Limitations relevant to Straumvakt's roadmap

| Concern | Status in SteVe | Implication |
|---|---|---|
| OCPP 2.0.1 | Not supported | Cannot validate Sprint DC1 (gbtnotes DC). Use CitrineOS or MaEVe instead. |
| ISO 15118 / Plug & Charge | Not supported | Cannot validate Sprint DC6. Use EVerest. |
| Multi-tenant org/property model | Single-tenant | Won't help with our `org_id` boundaries. |
| Dispatch profile composer | Manual UI | Won't validate Sprint DC5 allocator behaviour. |
| Hubject / OCPI roaming | Not supported | Use the Hubject sandbox directly. |
| Tariff engine | None | Pricing has to be tested in Straumvakt itself. |
| Load test | Single-instance, MariaDB-bound | Use the GBT-scale Sprint S7 simulator. |

In practice, SteVe is **valid for OCPP 1.6J wire-level work and AC vendor
on-boarding**. It has nothing to say about anything in `gbtNotes/dc-readiness-sprint-plan.md`
beyond "is your 1.6J behaviour conformant before you start adding 2.0.1."

## 8. Common operations cheat-sheet

Web UI navigation (paths under `/steve/manager`):

| Goal | Path |
|---|---|
| List connected chargers | `Data Management → Charge Points` |
| Send `RemoteStartTransaction` | `Operations → ChargePoint → Remote Start` |
| Send `RemoteStop` | `Operations → ChargePoint → Remote Stop` |
| Push a local auth list | `Operations → ChargePoint → Send Local List` |
| Reserve a connector | `Operations → ChargePoint → Reserve Now` |
| Trigger arbitrary message | `Operations → ChargePoint → Trigger Message` |
| Get config | `Operations → ChargePoint → Get Configuration` |
| Change config | `Operations → ChargePoint → Change Configuration` |
| Reset | `Operations → ChargePoint → Reset` |

Database access (when the UI doesn't show what you need):

```powershell
docker exec -it steve-dev-mariadb-1 mariadb -usteve -pchangeme stevedb
```

Useful tables:

- `charge_box` — registered chargers
- `transaction` — session history
- `connector_meter_value` — meter samples
- `ocpp_tag` — local auth list

## 9. Sources

- SteVe community fork: `https://github.com/steve-community/steve`
- Original RWTH project (archived): `https://github.com/RWTH-i5-IDSG/steve`
- OCPP 1.6 spec — see [`../reference/integrations/ocpp-1.6j.md`](../reference/integrations/ocpp-1.6j.md)
  for Straumvakt's reference of the same protocol.

## 10. When to update this doc

- After the first time a Straumvakt engineer actually uses SteVe in anger —
  add a "Live findings" section with the version tag, charger model, and any
  surprises.
- If we adopt CitrineOS or MaEVe for OCPP 2.0.1 development, add sibling
  files `citrineos.md` / `maeve.md` under this folder and link them from
  the reference README.
- If SteVe ever ships OCPP 2.0.1 support, revisit §7.
