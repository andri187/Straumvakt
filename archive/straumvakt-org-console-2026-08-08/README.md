# Archived — pre-relaunch straumvakt.org surfaces (2026-08-08)

**Status: parked, not deleted.** Every file under this directory was moved
here verbatim from `src/app/` and `src/components/` in one commit on
`dev/straumvakt-org-relaunch`. Nothing was rewritten in the move — use
`git log --follow` on any path here to see its full history from before the
move.

## Why this happened

`straumvakt.org` was reset to a single clean login landing page (real admin
auth, no driver-login fallback, no links into any of this) as the starting
point for splitting the web presence into distinct entry points instead of
one monolithic console:

- a Straumvakt-employee landing page
- a per-org landing page (starting with N1, built as a reusable template)
- the driver-facing UI moves fully to the mobile app — no driver web portal
  going forward

Everything that used to be reachable on `straumvakt.org` besides the login
itself is parked here so it can be looked at or selectively brought back,
rather than lost.

## What's here

| Path (under `app/`) | What it was |
|---|---|
| `(app)/` | The full operator console — dashboard, billing, chargers, installations, sites, circuits, people, onboarding, agreements, reference pages, technical-read, vehicle-ids, vehicles, accounts, applications, charge-log, hosts, status, concepts. Note: `(app)/dashboard/page.tsx` itself was already a static "homepage concept" mockup since Sprint 4 (see its own header comment and `docs/app/dashboard-original.tsx` for the real Sprint 3 dashboard it replaced) — that predates this parking and isn't a new loss. |
| `apply/` | The public host-application (lead capture) form. |
| `driver/` | The driver web portal (ADR 0033) — login, chargers/history/cost/settings, redeem-invite page. Superseded by the mobile app as the driver UI. |
| `host/` | The host_admin console (agreements, chargers, drivers, invite, sessions, settings) — the predecessor to the new per-org (N1) landing page. Worth reading before building the new one. |
| `host-invoice-preview/`, `invoice-preview/` | Standalone invoice-rendering preview routes. |
| `invite/[token]/` | The org-invite acceptance page (ADR 0026) — recipient-side UI for `POST /api/public/invites/consume`. The backend endpoint itself is untouched and still live; only this UI route moved. Needed again as soon as an org-invite flow needs a web page to land on. |
| `login/` | The old dedicated Straumvakt-admin/staff login page (env-secret credentials), separate from the root landing's own login form. Its component (`login-auth-switcher.tsx`, below) is a reasonable starting point for the new Straumvakt-employee landing page. |
| `page.tsx.original` | The pre-relaunch root page (`src/app/page.tsx`) — the combined marketing hero + host/driver login form, saved here for reference since the live file was overwritten in place rather than moved. |
| `landing.css` | The stylesheet the original root page used for its hero section. |

| Path (under `components/`) | What it was | Used exclusively by |
|---|---|---|
| `sidebar.tsx`, `sidebar-context.tsx`, `topbar.tsx`, `action-bar.tsx`, `section-tabs.tsx` | The operator console's chrome (sidebar nav, page topbar, list-page action bar, section tab nav). | `(app)/*` |
| `admin-login-form.tsx`, `electronic-login-form.tsx`, `login-auth-switcher.tsx` | The old `/login` page's auth UI (admin/host cookie-path form + electronic-ID/kennitala form, switched between). | `app/login/` |
| `reference/` | Vendor reference-page components (party cards, tech sections). | `(app)/reference/*` |

## How to restore something

Reverse the move with `git mv`, preserving the relative path — e.g. to bring
back the host console:

```
git mv archive/straumvakt-org-console-2026-08-08/app/host src/app/host
```

Components move back the same way. After restoring a route, `middleware.ts`
will likely need its matching public/protected-path exception added back
(it was simplified when this was parked — see its own git history for the
pre-relaunch version), and the restored code should be re-checked against
whatever the employee/N1 landing pages look like by the time it comes back,
since it was written against the old single-console shape.

## What was NOT parked

`docs/app/homepage-concept.html`, `docs/app/installation-picker-concept.html`,
and `docs/app/dashboard-original.tsx` were already inert reference docs
before this change and are untouched. The `/api/admin/login` and
`/api/public/invites/consume` backend endpoints (in `apps/api`) are untouched
and still live — only the UI routes that called them moved.
