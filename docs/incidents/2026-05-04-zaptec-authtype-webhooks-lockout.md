# 2026-05-04 — Zaptec AuthType=Webhooks lockout at Dalvegur

**Severity:** P1 — every driver locked out for the morning.
**Site affected:** Dalvegur 10 (`536987d3-04e4-4c89-a27c-105fa21d8364`).
**Resolution:** Operator disabled webhooks in the Zaptec portal,
reverting to AuthType=Native.

---

## Timeline

- 2026-05-03 evening — Sprint 8.9 ships webhook receivers; routes
  return 503 (no secret) or 401 (wrong secret) by default, and an
  8.9.1 diagnostic mode that bypasses the bearer-secret check while
  preserving handler logic.
- 2026-05-04 morning — operator switches Dalvegur installation in
  Zaptec portal from `AuthenticationType=Native` (0) to
  `AuthenticationType=Webhooks` (1). Pastes Straumvakt webhook URLs
  into the four portal fields.
- Drivers start tapping. Every charger reports "stuck on
  authentication"; cars do not start.
- Operator disables webhooks in Zaptec portal. AuthType reverts;
  drivers can charge again.

## Root cause

When AuthType=Native, Zaptec's own portal owns the RFID list. Per
memory `ocpp_first_strategy.md`, **Zaptec does not expose that list
to partners via API** — there is no read endpoint that returns "all
RFIDs allowed at installation X". Our `IdToken` table was therefore
empty for Dalvegur drivers (it had only been populated in earlier
sprints from OCPP `Authorize.req` traffic, which Dalvegur was not
seeing under AuthType=2).

When AuthType flipped to Webhooks, Zaptec began calling our `/auth`
webhook for every tap. The handler did:

```
const idToken = await db.idToken.findFirst({ where: { value: cardId, status: "active" } });
if (!idToken) return c.json({ result: "Reject", reason: "card_not_registered" });
```

Empty table → no match → Reject for every card → all drivers locked
out.

## Why diagnostic mode didn't save us

Sprint 8.9.1 added `ZAPTEC_WEBHOOK_DIAGNOSTIC=1` to bypass the
bearer-secret middleware. The intent was "let us see what shape
Zaptec actually sends without 401-rejecting the call". That
worked — but the request still passed through to the handler,
which made its own Accept/Reject decision based on `IdToken`
state. Diagnostic mode therefore did not protect drivers; it only
protected against the operator forgetting to set the bearer secret.

## Why we missed it in pre-flight

When I documented the Zaptec auth modes (see this conversation's
`Authentication type` discussion), I correctly identified that
AuthType=Webhooks would put us in the auth path. I did not flag:

1. The four URLs are bundled with AuthType=Webhooks. You cannot
   enable session-start/session-end URLs without also handing us
   auth ownership.
2. Our `IdToken` table is empty for Dalvegur, and there is no
   automated path to populate it from Zaptec.
3. Empty table + auth ownership = mass denial.

A pre-flight checklist for this kind of mode flip should be:

- [ ] Inventory `IdToken` rows for the affected installation; if
      thin, expect denial-by-default.
- [ ] Confirm whether the new mode bundles auth + sessions or
      separates them.
- [ ] Have a fail-open default in the auth handler whenever the
      operator is in a "still configuring" state.

## Fix shipped (Sprint 8.9.2)

`/auth` handler now checks `ZAPTEC_WEBHOOK_DIAGNOSTIC` and:

- **Diagnostic mode** → fail-OPEN. Returns `{result: "Accept",
  note: "diagnostic_fail_open"}` regardless of `IdToken` state.
  Logs cardId presence (not value) so we can verify Zaptec is
  reaching us without blocking traffic.
- **Normal mode (no diagnostic flag)** → fail-CLOSED. Original
  behaviour: Reject when no `IdToken` match.

Tests in `apps/api/src/routes/webhooks/zaptec.test.ts` lock both
behaviours so a regression here can't sneak back in.

## Path back to AuthType=Webhooks (when ready)

To re-enable webhooks safely we need one of:

1. **Seed `IdToken` with all Dalvegur RFIDs** — operator-side
   manual capture from Zaptec portal (since Zaptec doesn't expose
   the list via API). This is the only path to fail-closed
   correctness.
2. **Ship a temporary always-Accept mode** — set
   `ZAPTEC_WEBHOOK_DIAGNOSTIC=1` and accept that any tap with any
   card is currently allowed. Acceptable for an isolated test
   window; not acceptable for ongoing production.
3. **Stay on AuthType=Native** — Zaptec owns auth, we only catch
   sessions via the polling path (Sprint 8.7 cron, every 5 min)
   and status via 8.8 cron. Sub-5-min lag, but no risk of locking
   anyone out. **This is where Dalvegur is right now.**

Default recommendation: stay on Native until the operator has a
plan + capacity to maintain `IdToken` rows. Polling has been
working since 8.7 deploy; sessions are flowing into the ledger
within 5 minutes of `EndDateTime` on Zaptec's side.

## Action items

- [x] Ship 8.9.2 fail-open in diagnostic mode + tests.
- [ ] Add a pre-flight check to the operator UI: when an
      installation's `AuthenticationType` setting changes from
      Native to Webhooks via our portal, refuse the change unless
      `IdToken.count >= 1` for that installation (or the operator
      explicitly clicks "I accept the lockout risk").
- [ ] Add an `IdToken` seeding flow: operator pastes a CSV of
      RFIDs with optional driver labels; bulk-insert.
- [ ] Open ADR for Sprint 9.x deciding whether the operator
      console should mirror Zaptec's RFID universe at all (vs
      requiring operator to maintain it independently).
