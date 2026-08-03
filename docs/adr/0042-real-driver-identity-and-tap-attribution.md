# ADR 0042 — Real per-driver identity and tap attribution

**Status:** Proposed — 2026-08-03.
**Relates to:** [ADR 0020](./0020-driver-access-via-driver-groups.md),
[ADR 0022](./0022-driver-self-onboarding.md),
[ADR 0028](./0028-driver-invite-mechanism.md),
[ADR 0031](./0031-cost-model-and-money-flow.md),
[ADR 0036](./0036-autocharge-vehicle-identity.md),
[ADR 0041](./0041-local-auth-list-management-completion.md).

---

## Context — verified against `br-tiny-river-abgpqq37`, 2026-08-03

The entire identity table is **eight rows**:

| email | audience | credentials | idTokens | sessions |
|---|---|---|---|---|
| `driver@n1.is` | driver | 1 | 2 | **46** |
| `kronan@kronan.is` | driver | **0** | 0 | 0 |
| `elko@elko.is` | **operator** | 0 | 0 | 0 |
| `festi@festi.is` | **operator** | 0 | 0 | 0 |
| `klettas@klettas.is` | **operator** | 0 | 0 | 0 |
| `lyfja@lyfja.is` | **operator** | 0 | 0 | 0 |
| `host@n1.is` | operator | 1 | 0 | 0 |
| `admin` | operator | 0 | 0 | 0 |

Three distinct problems:

1. **One working driver account.** `driver@n1.is` is the only row with
   `audience='driver'` *and* a credential. **All 46 charging sessions in
   the system resolve to it.**
2. **Four accounts named as drivers are `audience='operator'`** — elko,
   festi, klettas, lyfja. They cannot use the driver app at all.
3. **`kronan@kronan.is` is `audience='driver'` with no credential** — it
   can never log in.

### Why this is more than seed hygiene

**ADR 0031's billing model has never been exercised.** Cost resolution
runs `sessions → idTag → IdToken → userId`, and with one shared account
every session resolves to the same person. That means none of the
following has been proven against real data:

- per-driver invoicing (§4)
- group-owner billing, where an HOA apartment owner receives one invoice
  covering their household including kennitala-less dependents (§10, §18)
- workplace coverage redirecting the bearer from driver to employer (§12)
- non-payment suspension being **per-host**, so a delinquent driver at
  one site retains access at another (§8)

Each of these is a *resolution* rule, and a single-identity dataset
cannot distinguish a correct resolver from one that always returns the
same row.

There is a sharper version. The F21 decision (2026-08-02) chose to fail
the Authorize gate **closed** specifically because *"at a multi-payer
installation an unattributable session cannot be settled."* That
reasoning is right — and today there are no multi-payer installations,
because there is one driver. The decision was made for a future the data
has not reached yet, which is the correct order, but it means the risk it
guards against is currently invisible in production.

### Phone taps do not attribute

`zpr074002` phone taps present random `08…` UIDs, matching neither of
`driver@n1.is`'s two tokens. They therefore attach to **no** account —
not even the collective one. The tap-intent work in flight is the fix;
this ADR records why it is load-bearing rather than a convenience.

---

## Decision

### D1 — One `identity.users` row per person

Each with `audience='driver'`, its own credential, and its own
IdToken(s). The collective account was a reasonable pilot shortcut; it
stops being reasonable the moment two parties could be billed
differently for the same charger.

### D2 — Correct the miscategorised accounts

The four `operator`-audience org accounts are either corrected to
`driver` with credentials issued, or deleted as placeholders. **Deleting
is preferred** unless a real person is behind each — a login that exists
but cannot be used is worse than no login, because it reads as
provisioned.

`kronan@kronan.is` gets a credential or is removed. Same reasoning.

### D3 — Taps attribute to the logged-in person

Phone taps resolve through tap-intent to the authenticated driver, not
through idTag matching alone. Random per-tap UIDs cannot be enrolled in
advance, so idTag matching structurally cannot work for them.

### D4 — Audience is an invariant worth enforcing

`audience='driver'` with no credential, and `audience='operator'` on a
row created as a driver, are both states the schema currently permits.
Both existed simultaneously in an eight-row table. Whatever creates
these accounts should refuse to.

---

## Consequences

**Positive.** Billing attribution becomes testable. ADR 0031's
resolution rules can be exercised against data that can actually
distinguish them. Sessions answer *"who charged"* with a person rather
than *"someone at N1."*

**Negative.** Existing sessions stay attributed to the collective
account. Re-attributing 46 historical sessions is possible via idTag but
only where the physical card maps to a known person — the phone taps
never attributed to anything and cannot be recovered.

**Sequencing.** This gates any meaningful test of the billing model, and
therefore P1's invoice generation. Building invoice generation against a
single-identity dataset would prove only that it runs.

**Not urgent for the pilot itself.** One shared account bills correctly
*in total* — the money is right, only the attribution is wrong. It
becomes urgent the moment a second payer exists at any installation.
