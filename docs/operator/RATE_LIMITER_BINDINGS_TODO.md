# Rate-limiter bindings — operator TODO

> Audit AUD-2 / FIX-2. Lands alongside `apps/api/src/lib/rate-limit.ts`.
> Bindings added to `apps/api/wrangler.jsonc` 2026-05-31 — see commit
> history. This doc is kept as the canonical operator reference for the
> wiring shape. Update if the binding names or values change.

## What was added

The block lives in **`apps/api/wrangler.jsonc`** under **`env.staging`**.
The original audit pointed at the root `wrangler.jsonc` because the
helper was first drafted for the Next.js UI Worker; it was rewritten in
Hono flavor and now lives in the API Worker.

```jsonc
"unsafe": {
  "bindings": [
    {
      "name": "ADMIN_LOGIN_RATE_LIMITER",
      "type": "ratelimit",
      "namespace_id": "1001",
      "simple": { "limit": 10, "period": 60 }
    },
    {
      "name": "DRIVER_LOGIN_RATE_LIMITER",
      "type": "ratelimit",
      "namespace_id": "1002",
      "simple": { "limit": 10, "period": 60 }
    }
  ]
}
```

## Field notes

- **`name`** — must match the `bindingName` arg passed to
  `rateLimit({ bindingName: ... })`. The names declared above are the
  ones the helper knows about (see `RateLimitOptions.bindingName` in
  `apps/api/src/lib/rate-limit.ts`).
- **`namespace_id`** — arbitrary positive integer chosen by the operator.
  **Must be unique per binding within the Worker.** Buckets are scoped
  per-Worker not per-account, so staging and production can reuse the
  same values.
- **`simple.limit`** — max requests in the window.
- **`simple.period`** — window length in **seconds**. Cloudflare's
  documented values are **`10` or `60`**. `900` is NOT supported and
  CF rejects it at deploy time. The 10 attempts / 60 seconds setting
  burns brute-force at 600 req/hour — still impractical against any
  reasonable password.

## Where the bindings are used today

- `apps/api/src/routes/admin/auth.ts` — `rateLimit({ keyBy: "email_or_ip", limit: 10, windowSec: 60, bindingName: "ADMIN_LOGIN_RATE_LIMITER" })`
- **Driver login route — does not exist yet** on either worker. The
  `DRIVER_LOGIN_RATE_LIMITER` binding is declared above so the wiring is
  in place the moment that route lands. When you wire the route, call
  the middleware factory with the same shape, just swap the binding
  name and adjust `limit` / `windowSec` if you want a different policy
  for drivers.

## Fail-open behaviour (deliberate)

The middleware is intentionally fail-open: if the binding is missing at
runtime, `rateLimit` emits a `console.warn`
(`[rate-limit] binding ADMIN_LOGIN_RATE_LIMITER missing or malformed — failing open`)
and calls `next()`. This keeps dev environments usable and prevents a
typo in `wrangler.jsonc` from locking out admins. Grep staging logs for
that line after deploy — its absence confirms the binding is live.

## Verification after deploy

1. `cd apps/api && npm run deploy:staging`
2. Tail staging logs for ~1 minute of normal traffic: the
   `binding ... missing or malformed` warn should NOT appear.
3. Smoke-test the gate with 11 rapid bad-password attempts from one IP
   to the same email:

   ```
   for i in $(seq 1 11); do
     curl -sS -X POST -H 'content-type: application/json' \
       -d '{"email":"test@example.com","password":"x"}' \
       https://hlada-api-staging.straumvakt.workers.dev/api/admin/login \
       -w '\n[%{http_code}]\n'
   done
   ```

   First 10 should return `401` (invalid credentials). The 11th should
   return `429` with body `{ "error": "rate_limited", "retry_after_sec": 60, "limit": 10 }`.

4. Wait 60 seconds, retry once more — should be back to `401`.

## When production deploys

The current `apps/api/wrangler.jsonc` has only `env.staging`. When you
add an `env.production` block, mirror the same `unsafe.bindings` array
inside it — same names, same values. Buckets are per-Worker so staging
and production don't share counters even if the `namespace_id` values
match.
