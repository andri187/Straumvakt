// Straumvakt-employee entrance — the landing page for platform staff.
//
// Why /staff and not /admin or /login:
//
//   • "admin" is already overloaded in this codebase and means the wrong
//     thing. The session cookie, the middleware header and the whole
//     /api/admin/* namespace call anyone holding a verified session an
//     "admin", including org operators who authenticate through Path B of
//     apps/api/src/routes/admin/auth.ts and have no platform scope at all.
//     A route called /admin would read as "the admin area" to exactly the
//     people it is not for.
//   • /login was the old shared sign-in page and is parked in
//     archive/straumvakt-org-console-2026-08-08/app/login/. Reviving that
//     name would re-create the single front door the relaunch is splitting
//     up, and would collide with the org-facing entry point being built in
//     parallel.
//   • /staff names the persona rather than the permission, so it sits
//     cleanly beside a per-org route without either having to know about
//     the other.
//
// This is a landing page rather than a bare form: it says what the entrance
// is, who it is for, what is behind it, and where org customers should go
// instead — because the credential endpoint behind both doors is the same
// one, and someone arriving at the wrong door gets no signal from a login
// box alone.
//
// Public by design. middleware.ts carries a staffRouteResponse() that lets
// "/staff" through unauthenticated and session-gates everything under it —
// but be aware that file does not currently execute at all (Next 16 resolves
// the convention to src/middleware.ts when a src/ directory exists, which
// this repo has). Nothing on this route may assume it ran. See
// docs/relaunch-middleware-reconciliation.md for the whole picture; the
// practical consequence is that /staff/overview does its own server-side
// session check rather than trusting a gate upstream of it.

import { StaffLoginForm } from "./staff-login-form";

export const metadata = { title: "Staff sign-in" };

/**
 * Straumvakt brand mark. Deliberately local to this route rather than
 * hoisted into src/components/: src/app/page.tsx carries its own copy and
 * is being rewritten for the org-facing entry point in parallel, so a
 * shared extraction right now would put a merge conflict in the middle of
 * two unrelated tasks. Worth folding together once both landings land.
 */
function StraumvaktMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 120" className={className} fill="none" aria-hidden="true">
      <defs>
        <linearGradient
          id="svStaffBolt"
          x1="40"
          y1="20"
          x2="80"
          y2="100"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#8EF5C7" />
          <stop offset="100%" stopColor="#6FDCEA" />
        </linearGradient>
      </defs>
      <path
        d="M 84 18 L 54 18 A 24 24 0 0 0 30 42 L 30 60"
        stroke="#3EE9A7"
        strokeWidth="13"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M 36 102 L 66 102 A 24 24 0 0 0 90 78 L 90 60"
        stroke="#2BB6E8"
        strokeWidth="13"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M 66 28 L 44 66 L 58 66 L 52 96 L 78 56 L 62 56 Z" fill="url(#svStaffBolt)" />
    </svg>
  );
}

/** What sits behind the door — kept honest, these are the panels /staff/overview renders. */
const BEHIND_THE_DOOR = [
  {
    title: "The queue",
    body: "Host applications waiting on a reply, and chargers knocking on the gateway with no credentials yet.",
  },
  {
    title: "What is charging",
    body: "Every live session across every tenant, with the charger, the site and the org it belongs to.",
  },
  {
    title: "The estate",
    body: "Organisations, installations and the charger fleet — the cross-tenant view no customer can see.",
  },
];

export default function StaffLandingPage() {
  const version = process.env.APP_VERSION ?? "dev";
  const buildTime = process.env.BUILD_TIME ?? "unknown";

  return (
    <div className="relative min-h-screen overflow-hidden px-4 py-10 sm:py-16">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-brand-halo" />

      <div className="relative mx-auto grid w-full max-w-5xl gap-10 lg:grid-cols-[1.1fr_minmax(0,26rem)] lg:items-start lg:gap-14">
        {/* ── Left: what this entrance is ─────────────────────────────── */}
        <div className="pt-2">
          <div className="flex items-center gap-3">
            <StraumvaktMark className="h-11 w-11" />
            <div>
              <div className="sv-wordmark text-xl font-bold leading-tight">Straumvakt</div>
              <div className="sv-tagline">Platform operations</div>
            </div>
          </div>

          <h1 className="mt-8 text-3xl font-semibold leading-tight tracking-tight text-ink-50 sm:text-4xl">
            The staff entrance.
          </h1>
          <p className="mt-4 max-w-xl text-sm leading-relaxed text-ink-300">
            This door is for people who work at Straumvakt. Behind it is the
            cross-tenant view of the platform — every organisation, every
            installation, every charger, and everything currently waiting on
            one of us.
          </p>

          <dl className="mt-8 space-y-4 border-l border-bg-border pl-5">
            {BEHIND_THE_DOOR.map((item) => (
              <div key={item.title}>
                <dt className="text-sm font-medium text-ink-100">{item.title}</dt>
                <dd className="mt-0.5 max-w-lg text-sm leading-relaxed text-ink-400">
                  {item.body}
                </dd>
              </div>
            ))}
          </dl>

          <p className="mt-8 max-w-xl text-xs leading-relaxed text-ink-400">
            Running a site, a fleet or a building? You are in the wrong place —
            your organisation signs in at{" "}
            <a
              href="/"
              className="font-medium text-brand-300 underline underline-offset-2 hover:text-brand-200"
            >
              straumvakt.org
            </a>
            . Drivers do not sign in on the web at all; charging lives in the
            Straumvakt app.
          </p>
        </div>

        {/* ── Right: the actual sign-in ───────────────────────────────── */}
        <div className="rounded-2xl border border-bg-border bg-bg-surface/90 p-8 shadow-card backdrop-blur">
          <h2 className="text-lg font-semibold text-ink-50">Sign in</h2>
          <p className="mt-1 text-sm text-ink-300">
            Use your Straumvakt platform account.
          </p>

          <StaffLoginForm />

          {/*
            Only claims what the code actually does. POST /api/admin/login is
            wrapped in rateLimit() at 10 attempts / 60s bucketed by email-or-IP
            (apps/api/src/routes/admin/auth.ts), and the binding is configured
            in apps/api/wrangler.jsonc. There is deliberately no "every attempt
            is logged" line here: the route logs only [admin-bootstrap] on
            first-time account creation, so saying otherwise would be an
            assurance the system does not deliver.
          */}
          <p className="mt-6 border-t border-bg-border pt-4 text-[11px] leading-relaxed text-ink-500">
            Sign-ins are rate limited — ten attempts a minute. If your account
            has no platform grant you will be told so on the next screen rather
            than dropped into an empty console.
          </p>
        </div>
      </div>

      <div className="relative mt-12 text-center text-xs tracking-wide text-ink-500 tabular-nums">
        <span>v{version}</span>
        <span className="mx-2 text-ink-600">·</span>
        <span>build {buildTime}</span>
      </div>
    </div>
  );
}
