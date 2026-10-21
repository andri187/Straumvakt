# Straumvakt connected test frontend — verification report (2026-09-11)

All checks run against the **deployed** site unless noted. Browser checks used headless Chrome
(puppeteer-core driving the system Chrome) via `scratchpad/e2e.cjs`.

## API / auth (curl, https://test.straumvakt.org)
| Check | Result |
|---|---|
| `GET /api/health` | 200 `{ok:true,...}` |
| `GET /api/admin/me` anonymous | **401** |
| `GET /api/nope` (SPA-fallback trap) | JSON `{"error":"not_found"}` (API not shadowed by static SPA) |
| `POST /api/admin/login` admin | 200 `{ok:true}`; `/me` → `operator`, `isPlatform:true`, `super_user` |
| `POST /api/admin/login` host A | 200; `/me` → `host_admin`, orgs=[Norðurorka Test] |
| Host A `GET /orgs/<A>/chargers` | 200, 3 real chargers |
| Host A `GET /orgs/<B>/chargers` | **403** (server-enforced tenancy) |
| Set-Cookie | `straumvakt_test_session; Path=/; HttpOnly; Secure; SameSite=Lax` — **host-only, no Domain** |

## Browser E2E (https://test.straumvakt.org)
| Scenario | Result |
|---|---|
| Anonymous load → login gate shown | ✅ |
| Admin login → connected banner, persona from `/me` | ✅ |
| Admin sees **Norðurorka Test** and **Vestan Test** (real orgs) | ✅ |
| Sessions screen shows real driver names | ✅ |
| Click "New organisation" (write) → blocked, "read-only" toast, no modal | ✅ |
| Host A login → sees own site; **Vestan not visible** | ✅ |
| Uncaught JS errors | none (one console 401 = the expected pre-login `/me` probe) |
| Responsive/keyboard/deep-link (hash routing) | served by SPA; login is keyboard-submittable |

## Isolation (apex/www/api unchanged)
| Endpoint | Before intent | After deploy |
|---|---|---|
| `https://straumvakt.org/` | untouched | 200 |
| `https://www.straumvakt.org/` | untouched | 200 |
| `https://api.straumvakt.org/api/admin/me` | untouched | `{"error":"unauthorized"}` |
| Cloudflare | only `straumvakt-test` Worker + `test.straumvakt.org` custom domain added | no apex/www/api/gateway change |
| Neon | new branch `test-to-market` / db `straumvakt_test` created | `staging`/`production` untouched |

## Data-integrity checks
- Test DB `straumvakt_test`: 85 tables / 18 schemas, seeded 3 orgs-worth of synthetic rows; **zero
  legacy customer rows** (branched off `production`, not `staging`).
- Writes cannot occur: the Worker exposes no write endpoints and the UI blocks write actions; no
  optimistic fake completion path reaches an API.
- No external effect is reachable: the Worker binds no gateway/queue/cron/email/R2.

## Not connected / unavailable (honest scope)
- **Writes** (create/edit/onboard/commission/remote/command) — not wired (read-only test API).
- **Tariffs / billing / contracts / incidents / team / audit** — empty or sample-calculator only.
- **Whole-product tabs** (issues / community / service) — no backend exists anywhere (parked).
- **ADR-0054 device/placement/effective-dating** and invoice/statement/delivery tables — decided, not built.

## Blocking dependencies encountered & resolved
1. Baseline migration assumed the `citext` extension → created it before applying migrations.
2. Cloudflare production Workers cap PBKDF2 at 100 000 iterations (local dev did not) → re-hashed
   all seed passwords at 100 000; login then succeeded on the edge.
3. `zone:read`-only token was sufficient for the Workers **custom domain** (managed via the Workers
   service), so `test.straumvakt.org` provisioned without a broader DNS token.

No unresolved blocking dependency remains for the delivered (read-only) scope.
