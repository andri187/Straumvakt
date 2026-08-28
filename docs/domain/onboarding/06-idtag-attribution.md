# Technical idTag versus driver attribution

Phase 5. Zaptec may require an OCPP idTag even for open/free-vend charging.
Shared technical authorization is not driver attribution. Proposal only.

## 1. The distinction

**Authorization** answers "may this session start?"
**Attribution** answers "whose session was it?"

They are different questions with different evidence, and conflating them is how
a shared service token becomes a person in a billing report. A token can
authorize without identifying anyone.

## 2. Five token/evidence classes

| # | Class | Authorizes | Attributes | Notes |
| --- | --- | --- | --- | --- |
| 1 | Driver-specific virtual RFID / idTag | yes | **yes** | minted per driver; ADR 0042 |
| 2 | Physical RFID card | yes | **yes, weakly** | attributes the *card*, not the person holding it |
| 3 | Installation-level technical/service token | **yes** | **no** | required by hardware; shared |
| 4 | App / tap / Autocharge evidence | no | **yes** | attribution without authorization |
| 5 | OCPP transaction identity | no | no | station + EVSE/connector + transaction id |

**Class 3 is the one that matters here.** A shared installation token must
authorize and must never identify. Class 4 is the mirror image: it identifies but
does not authorize, and it is how an open/free-vend session gets a driver.

## 3. Current source

**[F]** `apps/api/src/routes/internal/ocpp-authorize.ts`:

- Request `{ idTag, identityId, orgId }`; response
  `{ verdict, reason, userId?, idTokenId?, enforceAuthorize }` with
  `verdict ∈ Accepted | Blocked | Expired | Invalid` (`:17-19`, `:40`).
- **`userId` is set only when `verdict === "Accepted"`** (`:21`).
- `enforceAuthorize` comes from the Installation (`:22`).
- **Shadow mode is the default**: when `enforceAuthorize` is false the gateway
  "logs the verdict but always replies Accepted" (`:23-24`), and for Sprint 3
  closure the gateway "always replies Accepted … to observe what the verdict
  pipeline says" (`:7-10`).

**[F]** `enforceAuthorize` lives on `Installation` today, and
`repositories/chargers.ts:230` notes it "moves to ChargingStation per ADR 0047
D1" — so its home is already scheduled to change.

**[I] The current contract already couples authorization and attribution**:
`userId` rides along with the verdict. For classes 1–2 that is correct. For
class 3 it is a trap — the moment a shared installation token is resolved to a
`userId` (for example the person who created it), every session started with it
is attributed to that person.

## 4. Rules

1. **A token record declares its class.** `IdToken` gains an explicit
   `tokenClass ∈ driver | physical_card | installation_technical`. Class is not
   inferred from whether a `userId` happens to be set.
2. **`installation_technical` tokens must never resolve to a `userId`.** The
   authorize response returns `Accepted` with `userId: null` and an explicit
   `attribution: "installation"`. **[R]** Enforce this in the resolver, not by
   convention, and assert it in a test — this is the single most important rule
   in this document.
3. **Attribution has three values, and "unknown" is legitimate:**
   - `driver` — class 1/2 token, or class 4 evidence correlated to the session
   - `installation` — class 3 token, no driver evidence
   - `unknown` — free vend, no token, no evidence
   Attribution is never guessed. An `unknown` session stays `unknown`.
4. **Concurrent sessions on a shared token are expected**, not an error. A
   class-3 token has no per-person concurrency limit; a class-1 token may.
   **[U]** Whether a driver may hold two concurrent sessions is a product
   decision — accepted direction says multiple active sessions are allowed, but
   that was about app sessions, not charging sessions.
5. **Meter evidence is retained regardless of attribution.** A session with
   `attribution: "unknown"` still keeps signed meter values. Retaining the
   evidence and declining to name a person is the honest combination; inventing
   a person to satisfy a non-null column is not.
6. **Attribution may be upgraded later, never downgraded silently.** If tap
   evidence arrives after the fact, `unknown → driver` is allowed and recorded
   as an event with its basis. The reverse requires an explicit correction event.

## 5. Free vend and RemoteStart

| Scenario | Authorization | Attribution |
| --- | --- | --- |
| Free vend, no idTag | hardware-local | `unknown` |
| Free vend, hardware demands an idTag | class-3 token, `Accepted` | `installation` |
| App RemoteStart | driver session authorizes | `driver` |
| Local start + tap evidence | class-3 or none | `driver` if correlated, else `installation`/`unknown` |
| Local start, driver-specific card | class-1/2, `Accepted` | `driver` |

**[U] Hardware assumptions needing bench validation** — flagged rather than
assumed:

1. Whether Zaptec demands a non-empty idTag for free-vend `StartTransaction` in
   the installed firmware, or only in some configurations.
2. Whether the same technical token can be presented concurrently on multiple
   EVSEs of one installation without the charger de-duplicating it.
3. Whether `RemoteStartTransaction` idTag echoes back unchanged in
   `StartTransaction`/`TransactionEvent`, which is what tap correlation relies on.
4. OCPP 1.6 vs 2.0.1 differences in `idTagInfo` handling once `enforceAuthorize`
   is switched on for real.

None of these can be settled from the repository. They need a charger on a
bench, and until then the design must tolerate all branches.

## 6. Switching `enforceAuthorize` on

**[F]** Today it defaults false and the gateway replies `Accepted` regardless.

**[I]** Flipping it per installation is a genuine availability risk: any driver
whose token is missing, expired or mis-seeded goes from "charges fine" to
"rejected at the plug", in a car park, with no recourse. The shadow-mode design
is right, and the observation period is the whole point of it.

**[R]** Gate the flip on evidence from shadow mode: for a candidate
installation, zero `Blocked`/`Invalid`/`Expired` verdicts for a sustained window
covering its real usage pattern, then flip one installation, then widen. Never
flip globally. **[U]** Window length is an operations decision.
