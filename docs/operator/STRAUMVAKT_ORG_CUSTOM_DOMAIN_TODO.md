# straumvakt.org custom domain — operator TODO

> Registered 2026-05-31 via Cloudflare Registrar. DNS records for sending
> email (DKIM, SPF, DMARC) are in place and verified (Resend EU).
> The web side (typing `https://straumvakt.org` in a browser) does
> NOT yet resolve to the operator UI. This doc captures what's needed.

## Why this is open

When we set up `straumvakt.org` we added the email-routing records:

| Record | Purpose |
|---|---|
| `resend._domainkey` TXT | DKIM signing for outbound mail |
| `send.straumvakt.org` MX | bounce return path |
| `send.straumvakt.org` SPF TXT | SPF |
| `_dmarc.straumvakt.org` TXT | DMARC report-only |

But we deliberately **skipped** the root `A`/`AAAA`/`CNAME` and `www`
record at the time because we didn't have a destination to point them
at. As a result, `https://straumvakt.org` shows "site can't be reached"
in any browser.

## What needs to happen (recommended path — wrangler config edit)

Edit `wrangler.jsonc` at the **root** of the repo, under `env.staging`,
add a `routes` array:

```jsonc
"env": {
  "staging": {
    "name": "hlada-staging",
    // ... existing config ...
    "routes": [
      { "pattern": "straumvakt.org/*",     "zone_name": "straumvakt.org" },
      { "pattern": "www.straumvakt.org/*", "zone_name": "straumvakt.org" }
    ]
  }
}
```

Then redeploy:

```
cd e:/Claude/Straumvakt
npm run deploy:staging
```

Wrangler auto-creates the Workers Routes in Cloudflare AND auto-creates
the DNS records (it uses CF's "auto" CNAME flattening at the apex). No
manual DNS work needed.

Within ~30 seconds, `https://straumvakt.org` reaches the same operator
UI as `https://hlada-staging.straumvakt.workers.dev`. The login screen
gates access — nothing leaks.

## Alternative path — pure CF API (no wrangler edit)

If you'd rather not touch `wrangler.jsonc`, this can be done entirely
via the Cloudflare REST API. Requires a token with `Zone:Workers
Routes:Edit` (the existing `straumvakt-dns-setup-temp` token only has
`DNS:Write` so it can't do this — either expand it or roll a new one).

### Step 1 — Create Workers Route via API

```bash
curl -X POST "https://api.cloudflare.com/client/v4/zones/4f40b41fe94a59dd5e643875df8bf336/workers/routes" \
  -H "Authorization: Bearer <token-with-workers-routes-edit>" \
  -H "Content-Type: application/json" \
  -d '{"pattern":"straumvakt.org/*","script":"hlada-staging"}'
```

And again for `www`:

```bash
curl -X POST "https://api.cloudflare.com/client/v4/zones/4f40b41fe94a59dd5e643875df8bf336/workers/routes" \
  -H "Authorization: Bearer <token-with-workers-routes-edit>" \
  -H "Content-Type: application/json" \
  -d '{"pattern":"www.straumvakt.org/*","script":"hlada-staging"}'
```

### Step 2 — DNS records (CNAME with CF proxying)

```bash
curl -X POST "https://api.cloudflare.com/client/v4/zones/4f40b41fe94a59dd5e643875df8bf336/dns_records" \
  -H "Authorization: Bearer <token-with-dns-write>" \
  -H "Content-Type: application/json" \
  -d '{"type":"CNAME","name":"straumvakt.org","content":"hlada-staging.straumvakt.workers.dev","proxied":true,"ttl":1}'

curl -X POST "https://api.cloudflare.com/client/v4/zones/4f40b41fe94a59dd5e643875df8bf336/dns_records" \
  -H "Authorization: Bearer <token-with-dns-write>" \
  -H "Content-Type: application/json" \
  -d '{"type":"CNAME","name":"www","content":"hlada-staging.straumvakt.workers.dev","proxied":true,"ttl":1}'
```

The apex CNAME (`straumvakt.org` pointing at a `.workers.dev` target)
works because Cloudflare auto-applies CNAME flattening. Outside of CF
this would be illegal per the DNS spec; on CF it's standard.

## What you get either way

After either path lands:
- `https://straumvakt.org` → operator UI login screen (TLS handled by CF)
- `https://www.straumvakt.org` → same
- The original `https://hlada-staging.straumvakt.workers.dev` continues
  to work — both URLs hit the same Worker. (Eventually you may want to
  add a 301 redirect from one to the other for canonical URLs.)

## When this should change for production

The `routes` above bind to `hlada-staging`. When `hlada` (production
Worker) is ready to take real customer traffic, the path is:

1. Move the routes block out of `env.staging` and into the **root**
   `wrangler.jsonc` config (which targets `hlada`).
2. Add a parallel staging subdomain (e.g. `staging.straumvakt.org`)
   that maps to `hlada-staging` so you can keep testing.
3. Redeploy both Workers.

That's a separate operator action when the production cutover happens.
For now (pilot) `straumvakt.org` → staging is the right shape.

## Tracking

This TODO closes when either Path A or Path B is run. Drop a note in
the operator log / commit message once `straumvakt.org` resolves.
