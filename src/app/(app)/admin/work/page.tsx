// GENERATED — do not edit.
// Source: WORKSPACE.md + TASKS.md. Regenerate: `npm run work-view`.
// `npm run check:work-view` fails if this file is stale.
//
// ADMIN-GATED. It sits under /admin, which the console's admin session
// already guards; it is not a public page.

export const dynamic = "force-dynamic";

const HEALTH = {
  "prisma": "481",
  "drizzle": "131",
  "ported": "21",
  "baseline": "24",
  "vendorLeaks": "22",
  "adrs": "51",
  "packages": "3",
  "mirrors": "2"
} as const;

const GROUPS = [
  {
    "title": "NOW",
    "items": [
      {
        "state": "done",
        "n": "1",
        "title": "Commit the contracts harvest",
        "gate": null,
        "blocker": null
      },
      {
        "state": "wip",
        "n": "2",
        "title": "Housekeeping",
        "gate": "secret go-ahead ✅ cleared",
        "blocker": null
      }
    ]
  },
  {
    "title": "TRACK A",
    "items": [
      {
        "state": "todo",
        "n": "3",
        "title": "Approve the money-engine design",
        "gate": "design approval",
        "blocker": null
      },
      {
        "state": "todo",
        "n": "4",
        "title": "Build the parity harness",
        "gate": null,
        "blocker": null
      },
      {
        "state": "todo",
        "n": "5",
        "title": "Harvest the resolver into `packages/commercial`",
        "gate": "parity green before retiring the old path",
        "blocker": null
      },
      {
        "state": "todo",
        "n": "6",
        "title": "Build the line-agnostic invoice ledger",
        "gate": null,
        "blocker": null
      },
      {
        "state": "todo",
        "n": "7",
        "title": "Build the flat-fee principal line → invoice",
        "gate": null,
        "blocker": null
      },
      {
        "state": "todo",
        "n": "8",
        "title": "Scope and wire the invoice delivery + collection rail",
        "gate": null,
        "blocker": null
      }
    ]
  },
  {
    "title": "TRACK B",
    "items": [
      {
        "state": "todo",
        "n": "9",
        "title": "Stand up the shared Dev tier",
        "gate": "deploy go-ahead",
        "blocker": null
      },
      {
        "state": "todo",
        "n": "10",
        "title": "Per-service path-scoped deploys",
        "gate": "deploy go-ahead",
        "blocker": null
      },
      {
        "state": "todo",
        "n": "11",
        "title": "Clean Prod from migrations + clean seed + data hygiene",
        "gate": "prod go-ahead",
        "blocker": null
      }
    ]
  },
  {
    "title": "ONBOARDING",
    "items": [
      {
        "state": "todo",
        "n": "12",
        "title": "Admin-onboard customer 1",
        "gate": null,
        "blocker": null
      },
      {
        "state": "todo",
        "n": "13",
        "title": "Self-serve onboarding — BLOCKED",
        "gate": null,
        "blocker": "invite codes are bearer-only"
      }
    ]
  },
  {
    "title": "GO-LIVE",
    "items": [
      {
        "state": "todo",
        "n": "14",
        "title": "Verify gate",
        "gate": null,
        "blocker": null
      },
      {
        "state": "todo",
        "n": "15",
        "title": "Send customer 1's first correct invoice from clean Prod",
        "gate": null,
        "blocker": null
      }
    ]
  },
  {
    "title": "EXPAND",
    "items": [
      {
        "state": "todo",
        "n": "16",
        "title": "Un-park attribution",
        "gate": null,
        "blocker": null
      }
    ]
  }
] as const;

export default function WorkViewPage() {
  return (
    <main className="mx-auto max-w-4xl p-8">
      <h1 className="text-2xl font-semibold">Market phase — work status</h1>
      <p className="mt-1 text-sm opacity-70">
        Generated from WORKSPACE.md and TASKS.md. 1 of 16 tasks
        complete, 1 in progress, 1 blocked.
      </p>

      <section className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Prisma calls", HEALTH.prisma, "→ 0"],
          ["Drizzle calls", HEALTH.drizzle, `${HEALTH.ported}% ported`],
          ["Vendor leaks", HEALTH.vendorLeaks, `of ${HEALTH.baseline} baseline`],
          ["Packages", HEALTH.packages, `mirrors ${HEALTH.mirrors}`],
        ].map(([label, value, sub]) => (
          <div key={label} className="rounded-lg border p-3">
            <div className="text-xs uppercase tracking-wide opacity-60">{label}</div>
            <div className="text-2xl font-semibold tabular-nums">{value}</div>
            <div className="text-xs opacity-60">{sub}</div>
          </div>
        ))}
      </section>

      {GROUPS.map((g) => (
        <section key={g.title} className="mt-8">
          <h2 className="text-sm font-semibold uppercase tracking-wide opacity-70">
            {g.title}
          </h2>
          <ul className="mt-2 space-y-1">
            {g.items.map((t) => (
              <li key={t.n} className="flex gap-2 text-sm">
                <span aria-hidden className="opacity-60">
                  {t.state === "done" ? "✓" : t.state === "wip" ? "◐" : "○"}
                </span>
                <span className={t.state === "done" ? "opacity-50 line-through" : ""}>
                  <span className="opacity-60">{t.n}.</span> {t.title}
                  <span className="sr-only">
                    {t.state === "done"
                      ? " (complete)"
                      : t.state === "wip"
                        ? " (in progress)"
                        : " (not started)"}
                  </span>
                </span>
                {t.state === "wip" ? (
                  <span className="shrink-0 rounded bg-sky-500/15 px-1.5 py-0.5 text-[11px] text-sky-600">
                    in progress
                  </span>
                ) : null}
                {t.blocker ? (
                  <span className="ml-auto shrink-0 rounded bg-red-500/15 px-1.5 py-0.5 text-[11px] font-semibold text-red-600">
                    BLOCKED — {t.blocker}
                  </span>
                ) : null}
                {t.gate && !t.blocker ? (
                  <span className="ml-auto shrink-0 rounded bg-amber-500/15 px-1.5 py-0.5 text-[11px] text-amber-600">
                    {t.gate}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ))}

      <p className="mt-10 text-xs opacity-50">
        Track A (money) and Track B (environments) run in parallel and converge
        at GO-LIVE. By-product work — Drizzle conversion, the vendor ratchet —
        happens inside tasks, not as separate items.
      </p>
    </main>
  );
}
