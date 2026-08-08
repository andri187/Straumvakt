# straumvakt.org custom domain — DONE (this file is no longer a TODO)

> **Status: live.** `https://straumvakt.org` and `https://www.straumvakt.org`
> both resolve and serve the `hlada-staging` Worker over valid TLS. Verified
> 2026-08-08 — see [Evidence](#evidence) below.
>
> The filename still says `_TODO` only because
> `wrangler.jsonc` references this path in a comment, and renaming the file
> would mean editing config in a documentation-only change. Rename both
> together when something else touches that file.

Everything below the "What the previous version of this doc got wrong"
heading is a correction. If you read this doc before 2026-08-08 and acted on
it, read that section — the old instructions would now actively break the
working setup.

## Evidence

```
$ nslookup straumvakt.org          → 2a06:98c1:3120::   (Cloudflare)
$ nslookup www.straumvakt.org      → 2a06:98c1:3121::   (Cloudflare)
$ curl -sI https://straumvakt.org      → HTTP 200, Server: cloudflare
$ curl -sI https://www.straumvakt.org  → HTTP 200
```

The apex response is **byte-identical** to
`https://hlada-staging.straumvakt.workers.dev` — the same Worker serves all
three hostnames.

Certificates, both issued by Google Trust Services via Cloudflare:

| hostname | subject | issued | expires |
|---|---|---|---|
| `straumvakt.org` | `CN=straumvakt.org` | 2026-08-04 | 2026-11-02 |
| `www.straumvakt.org` | `CN=straumvakt.org` | 2026-07-31 | 2026-10-29 |

Two separate issuance dates, both **before** the config was committed
(`1641e4f`, 2026-08-02, *"wrangler: record straumvakt.org custom-domain
routing"* — note the verb: **record**). So the Custom Domains were attached
out-of-band via the dashboard or API, and the wrangler block was written
afterwards to codify what already existed. That ordering is the reason this
doc went stale without anyone noticing.

## What is actually configured

In the **root** `wrangler.jsonc`, under `env.staging`:

```jsonc
"routes": [
  { "pattern": "straumvakt.org",     "custom_domain": true },
  { "pattern": "www.straumvakt.org", "custom_domain": true }
],
"workers_dev": true
```

Two things to notice:

- The patterns are **bare hostnames**, not `straumvakt.org/*`. Custom Domains
  match on exact hostname and ignore path and query entirely — every path goes
  to the Worker. A `/*` suffix belongs to the *route* mechanism, not this one.
- Apex and `www` are listed **separately, and must be.** Cloudflare: *"Because
  Custom Domains require an exact hostname match, a Worker attached to
  `example.com` will not receive requests sent to `www.example.com`, and vice
  versa."* There is no wildcard fallback — Custom Domains do not support
  wildcard DNS records.

`workers_dev: true` keeps `hlada-staging.straumvakt.workers.dev` alive as a
fallback, which is what makes the byte-identical comparison above possible.

## What the previous version of this doc got wrong

It recommended a `routes` + `zone_name` approach and offered a raw-API "Path B"
alternative. Both are wrong now, and Path B is actively harmful.

| old claim | reality |
|---|---|
| "`https://straumvakt.org` does NOT yet resolve" | It has resolved since ~2026-08-04. |
| Use `routes` with `pattern: "straumvakt.org/*"` + `zone_name` | The implementation uses `custom_domain: true` with a bare hostname. Different mechanism. |
| "Wrangler auto-creates the Workers Routes **AND** auto-creates the DNS records" for the `routes` path | False for plain routes. Routes need a **pre-existing proxied DNS record** — typically an originless placeholder (`A → 192.0.2.0` or `AAAA → 100::`). Only **Custom Domains** create DNS records for you. |
| Path B: `POST /zones/{zone}/dns_records` creating a **CNAME** for apex and `www` | **Do not run this.** Cloudflare: *"You cannot create a Custom Domain on a hostname with an existing CNAME DNS record."* Creating those CNAMEs would block or break the Custom Domains that are currently serving the site. |
| Path B: `POST /zones/{zone}/workers/routes` | Wrong API resource for this mechanism. Custom Domains live under the Workers **domains** resource (`/accounts/{account_id}/workers/domains`), not zone workers routes. |
| "Within ~30 seconds" | Certificate issuance is not instant and is not guaranteed to a stopwatch. Budget minutes, and treat TLS errors in the first few minutes as provisioning rather than failure. |
| No rollback section at all | See [Removing it](#removing-it). |

## Operational reference

**DNS and certificates are managed for you.** Cloudflare: *"After you set up a
Custom Domain for your Worker, Cloudflare will create DNS records and issue
necessary certificates on your behalf."* Creating a Custom Domain also
generates an **Advanced Certificate** on the zone for that hostname — which is
what the two certs above are.

**Preconditions**, both already satisfied here:
1. An active Cloudflare zone that you own (`straumvakt.org`, on Cloudflare Registrar).
2. No pre-existing CNAME on the target hostname.

**The Worker is treated as an origin.** Unlike Routes, a Custom Domain Worker
can be reached by `fetch()` from within the same zone, and other Workers on
routes can sit in front of it and chain into it.

**The email records are unaffected.** `resend._domainkey` TXT,
`send.straumvakt.org` MX/SPF, and `_dmarc` TXT are all on subdomains and do not
collide with the apex or `www` records. Nothing in this setup touches mail.

## What happens on the next deploy

The staging catch-up (see `docs/notes/2026-08-08-staging-catchup-runbook.md`)
will eventually run `npm run deploy:staging` from a branch that contains this
`routes` block. Because both Custom Domains already exist and already point at
`hlada-staging`, that is a **reconciliation no-op** — no new DNS record, no new
certificate, no propagation window, no externally visible change to the domain.

> **Correction to the runbook.** Its Step 6 describes this deploy as attaching
> the brand domain "for the first time" and treats DNS/SSL provisioning as the
> step's main risk. That was written before this was checked and is wrong: the
> domains and certificates predate it. The deploy still changes *what code* the
> already-live domain serves, which is the real risk — but it does not
> provision anything.

## Removing it

There is no documented "remove by deleting the config block and redeploying".
Cloudflare documents attaching via dashboard, Wrangler, or API, and removal via:

- **Dashboard** — Workers & Pages → your Worker → Settings → Domains & Routes → remove the entry.
- **API** — the Workers domains resource (`/accounts/{account_id}/workers/domains`).

Assume deleting the wrangler block is **not** sufficient to detach a live
Custom Domain, and plan removal as an explicit dashboard/API action. The DNS
record and the Advanced Certificate may need separate attention afterwards.

This matters for rollback: of everything in the staging catch-up, detaching the
brand domain is the least clean thing to undo. It is not on the catch-up's path
today precisely because it is already done.

## Production cutover — still open

The Custom Domains bind to `hlada-staging`. When a real production Worker takes
customer traffic:

1. Move the `routes` block from `env.staging` into the **root** config (which
   targets `hlada`).
2. Add a parallel `staging.straumvakt.org` Custom Domain under `env.staging` so
   staging stays reachable by name.
3. Redeploy both Workers.

Note the ordering hazard: a hostname can only be attached to one Worker at a
time, so the cutover is a detach-then-attach, not an atomic swap. Expect a gap
and plan it deliberately.

Separately: `hlada` is currently the **CPMS** production Worker, connected to
the `andri187/CPMS` repo. It is not a Straumvakt Worker today. That has to be
resolved before any of the above means anything.

## If you need to verify this again

```
nslookup straumvakt.org
curl -sI https://straumvakt.org
curl -sI https://www.straumvakt.org
curl -sI https://hlada-staging.straumvakt.workers.dev
echo | openssl s_client -servername straumvakt.org -connect straumvakt.org:443 2>/dev/null \
  | openssl x509 -noout -subject -issuer -dates
```

Expect HTTP 200 from all three hostnames and a valid, unexpired certificate.
