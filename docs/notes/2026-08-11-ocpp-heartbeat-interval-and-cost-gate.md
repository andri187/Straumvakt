# OCPP heartbeat interval and the cost gate

One number sizes the idle cost of the entire fleet. Until this change
the gateway advertised one value and the cost model assumed another.

---

## The discrepancy

```
gateway/src/identity-do.ts, stubResponseFor:
  case "BootNotification":
    return { status: "Accepted", currentTime: now, interval: 60 };
```

Everything else assumed 3600 s:

- `DEFAULT_LIVENESS_CONFIG.idleHeartbeatIntervalMs = 3_600_000`
- the offline rule: silent past 3 intervals
- every cost figure produced by this project

## Why it matters arithmetically

| | interval 3600 | interval 60 |
|---|---|---|
| Frames / connector / month | 720 | 43,200 |
| Ratio | 1× | **60×** |

A 450 kr per-connector cap cannot absorb a 60× error in the dominant
idle term. Worse, the liveness window would judge a healthy charger
against a window sixty times too wide: a charger silent for 3 hours
would look fine under a 3600 s assumption while actually having missed
180 heartbeats.

The two numbers were free to drift because they were independent
literals in different files. That is the actual defect — `60` was only
its symptom.

## The fix

The advertised interval is **derived** from the liveness config:

```ts
export const PRODUCT_HEARTBEAT_INTERVAL_SECONDS = 3600;

export function bootNotificationIntervalSeconds(
  cfg: LivenessConfig = DEFAULT_LIVENESS_CONFIG,
): number {
  return Math.round(cfg.idleHeartbeatIntervalMs / 1000);
}
```

Move the liveness window and the advertised interval moves with it. The
drift class is now unrepresentable rather than merely corrected. A test
asserts the derivation tracks a changed config, so the coupling itself
is protected.

## The override

`OCPP_HEARTBEAT_INTERVAL_SECONDS`, optional, string, from the env.

```ts
resolveHeartbeatIntervalSeconds(raw) →
  { seconds, source: "product-default" | "env-override" | "rejected-override" }
```

Rules:

- absent or blank → 3600, `product-default`
- integer in **60..86400** → honoured, `env-override`
- anything else → 3600, `rejected-override`, **and an error is logged**

Out-of-range values are **rejected, not clamped**. Clamping turns a typo
into a plausible-looking wrong number; rejection turns it into a log
line and a known-good default. A `0`, a `-1`, a `3.5` or an `abc` all
land on 3600.

`60` is still reachable — deliberately. If M-2 shows the hardware needs
it, an operator can set it. What can no longer happen is 60 arriving as
a silent built-in. The test that encodes this reads:

```
REGRESSION: 60 is legal only as an explicit override, never a default
```

## Gate coverage

| Rule | Asserts |
|---|---|
| OB6 | interval is not a literal other than 3600; routed through the resolver |
| OB7 | `PRODUCT_HEARTBEAT_INTERVAL_SECONDS === 3600`; resolver exists |
| OB1–OB5 | fast path, reply-before-return, frame cap — carried forward so this gate stands alone |

Fixtures `interval-60.invalid`, `no-resolver.invalid` and
`no-3600-const.invalid` fail the gate; `interval-3600-literal.warns`
passes with a warning, because a bare 3600 is correct but reintroduces
the second independent number.

Against `beta-production`, OB6 reports exactly the original defect:

```
ERROR OB6  BootNotification interval is the literal 60, not 3600 or config-driven
```

## What is still unverified

**Whether the charger honours it.** OCPP 1.6J lets a charge point use
its own configured `HeartbeatInterval`; the BootNotification value is
the central system's request, not a command. Zaptec's behaviour is
unknown to this project.

That is measurement **M-2**, it needs no session and no charge, and it
is the highest-value item in the measurement plan. Until it is done:

- the idle cost figure of 720 frames/connector/month is **conditional**
- if the charger ignores the reply, this change is correct but inert,
  and the real interval must be set on the device
- no hardware command was issued by this lane to find out

## Cost model status

Unchanged and still idle-only. The active-session term needs M-3 and is
deliberately not guessed — gate OC6 fails any profile that records an
active-session interval without a measured source.
