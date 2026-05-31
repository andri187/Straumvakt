# Rate-limiter bindings — operator TODO

> Audit AUD-2 / FIX-2. Lands alongside `src/lib/rate-limit.ts`. **Not yet
> applied to `wrangler.jsonc`** because Rule 4 forbids automated edits to
> that file. The operator must add the bindings manually before any
> production rollout.

## What to add

Append the following to **`wrangler.jsonc`** at the **root** (production) and
again under **`env.staging`** (staging). Both environments need the bindings
or the rate limiter will fail open in that environment.

```jsonc
"unsafe": {
  "bindings": [
    {
      "name": "ADMIN_LOGIN_RATE_LIMITER",
      "type": "ratelimit",
      "namespace_id": "1001",
      "simple": { "limit": 10, "period": 900 }
    },
    {
      "name": "DRIVER_LOGIN_RATE_LIMITER",
      "type": "ratelimit",
      "namespace_id": "1002",
      "simple": { "limit": 10, "period": 900 }
    }
  ]
}
```

## Field notes

- **`name`** — must match the `bindingName` arg passed to
  `enforceRateLimit({ bindingName: ... })`. The names declared above are the
  ones the helper knows about (see `RateLimitBindingName` union in
  `src/lib/rate-limit.ts`).
- **`namespace_id`** — arbitrary positive integer chosen by the operator.
  **Must be unique per binding within the worker.** The values `1001` /
  `1002` above are placeholders; pick any pair that does not collide with
  future bindings.
- **`simple.limit`** — max requests in the window.
- **`simple.period`** — window length in **seconds**. Cloudflare's "simple"
  ratelimit bindings currently document support for `10` and `60` second
  windows; **if `900` is rejected on deploy, drop to `60` and update the
  `windowSec` arg in both login route handlers to match.**
- Staging and production may use the same `namespace_id` values — buckets are
  per-Worker, not per-account.

## Where the bindings are used today

- `src/app/api/admin/login/route.ts` —
  `enforceRateLimit(req, { keyBy: "email_or_ip", limit: 10, windowSec: 900, bindingName: "ADMIN_LOGIN_RATE_LIMITER", email })`
- **Driver login route — does not exist yet** in this V3 rebuild (driver
  auth lands in a later sprint per
  `docs/architecture/STRAUMVAKT_V3_DELIVERY_PLAN.md`). The
  `DRIVER_LOGIN_RATE_LIMITER` binding is declared above so the wiring is in
  place the moment that route lands; the helper already accepts
  `"DRIVER_LOGIN_RATE_LIMITER"` as a valid `bindingName`. When you wire the
  route, call:

  ```ts
  const limited = await enforceRateLimit(req, {
    keyBy: "email_or_ip",
    limit: 10,
    windowSec: 900,
    bindingName: "DRIVER_LOGIN_RATE_LIMITER",
    email,
  });
  if (limited) return limited;
  ```

## Fail-open behaviour (deliberate)

The helper is intentionally fail-open: if the binding is missing at runtime,
`enforceRateLimit` returns `null` (allow) and emits a `console.warn` with
`ev: "rate_limit_binding_missing"`. This keeps `next dev` usable and prevents
a typo in `wrangler.jsonc` from locking out admins. **Grep staging logs for
that event after deploy to confirm the bindings landed.**

## After landing the bindings

1. `npm run deploy:staging`
2. Probe with `curl -X POST https://hlada-staging.straumvakt.workers.dev/api/admin/login`
   from the same IP 11 times within 15 minutes and confirm the 11th returns
   HTTP 429 with body `{ "error": "rate_limited", "retry_after_sec": 900 }`.
3. Tail staging logs for the absence of `rate_limit_binding_missing`.
4. Repeat in production after staging soak.
