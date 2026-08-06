/**
 * dependency-cruiser — domain boundaries for Straumvakt.
 *
 * WHAT THIS IS FOR
 * ----------------
 * The domain boundaries were decided (docs/notes/2026-08-04-target-domain-tree.md,
 * SCOPE_2026-08-04.md) and then had no enforcement, so they were a document
 * rather than a property of the codebase. Dependencies are meant to flow one
 * way:
 *
 *     commercial ──► charging ──► assets ──► identity
 *
 * with two absolutes:
 *
 *     nothing may import vendor      — an adapter must never appear in the core
 *     platform imports nothing       — logs/audit/webhooks are a leaf
 *
 * WHAT IT IS NOT FOR
 * ------------------
 * Not a cleanup tool. Today's violations are recorded in
 * .dependency-cruiser-known-violations.json and deliberately left alone. The
 * point is that the NEXT one fails the build. Removing an entry from the
 * baseline is how a leak gets fixed; adding one requires saying why.
 *
 * TWO LAYOUTS, ONE RULE SET
 * -------------------------
 * apps/api/src is mid-migration. The target is src/domains/<domain>/..., which
 * only `identity` occupies so far. Everything else is still flat in
 * src/repositories/, src/routes/, src/lib/. Both are matched, so a rule keeps
 * working while files move rather than switching on the day the move finishes.
 */

// ── domain membership ──────────────────────────────────────────────────────
// Target layout: apps/api/src/domains/<domain>/**
// Legacy layout: matched by module name, because that is the only signal the
// flat layout carries. Deliberately conservative — a file nobody can classify
// is unclassified, not guessed at.

const domainDir = (d) => `(^|/)src/domains/${d}/`;

/** Vendor modules in the legacy layout. Zaptec is the only adapter today; Easee
 *  is when this bill comes due (target-domain-tree.md). */
const LEGACY_VENDOR = [
  "(^|/)src/lib/zaptec\\.ts$",
  "(^|/)src/lib/zaptec-sync-cron\\.ts$",
  "(^|/)src/repositories/zaptec-.*\\.ts$",
  "(^|/)src/repositories/vendor-credentials\\.ts$",
  "(^|/)src/repositories/vendor-credential-probe\\.ts$",
  "(^|/)src/repositories/vendor-user-groups\\.ts$",
  "(^|/)src/repositories/user-vendor-refs\\.ts$",
  "(^|/)src/repositories/credential-management\\.ts$",
  "(^|/)src/lib/credential-crypto\\.ts$",
];

/** Platform modules in the legacy layout: logs, audit, webhooks, idempotency. */
const LEGACY_PLATFORM = [
  "(^|/)src/lib/audit\\.ts$",
  "(^|/)src/lib/db/",
];

/** Commercial modules in the legacy layout. Named so the layering rule bites
 *  TODAY, while identity is the only domain that has moved — otherwise a
 *  ported domain could reach up into billing and nothing would say so until
 *  commercial itself moves, which is a year away and blocked on ADR 0025. */
const LEGACY_COMMERCIAL = [
  "(^|/)src/repositories/billing-.*\\.ts$",
  "(^|/)src/repositories/agreements\\.ts$",
  "(^|/)src/repositories/contracts\\.ts$",
  "(^|/)src/repositories/bill-objects\\.ts$",
  "(^|/)src/repositories/session-ledger\\.ts$",
  "(^|/)src/repositories/driver-pricing\\.ts$",
  "(^|/)src/repositories/driver-invoices\\.ts$",
  "(^|/)src/repositories/driver-group-memberships\\.ts$",
  "(^|/)src/repositories/driver-access-requests\\.ts$",
  "(^|/)src/repositories/org-tariff-chain\\.ts$",
  "(^|/)src/lib/agreement/",
  "(^|/)src/lib/billing/",
  "(^|/)src/lib/billing-shadow/",
  "(^|/)src/lib/tariff/",
];

const vendorFrom = [domainDir("vendor"), ...LEGACY_VENDOR];
const platformFrom = [domainDir("platform"), ...LEGACY_PLATFORM];

/** The four layered domains, ordered bottom-up. A domain may import itself and
 *  anything below it; importing anything above it is the violation. */
const LAYERS = ["identity", "assets", "charging", "commercial"];

/** Legacy-layout members, where they can be named. Empty means "only the
 *  target layout is matched for this domain" — assets and charging are still
 *  entirely flat and no filename pattern separates them cleanly. */
const LEGACY_MEMBERS = {
  identity: [],
  assets: [],
  charging: [],
  commercial: LEGACY_COMMERCIAL,
};

const layerRules = LAYERS.flatMap((domain, i) => {
  const above = LAYERS.slice(i + 1);
  if (above.length === 0) return [];
  const targets = above.flatMap((d) => [domainDir(d), ...LEGACY_MEMBERS[d]]);
  return [
    {
      name: `no-${domain}-to-higher-layer`,
      severity: "error",
      comment:
        `${domain} sits below ${above.join(", ")} in the dependency chain. ` +
        `An import in this direction inverts it, and the inversion is what ` +
        `makes a domain impossible to extract later.`,
      from: { path: domainDir(domain) },
      to: { path: targets },
    },
  ];
});

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    ...layerRules,

    {
      name: "no-import-from-vendor",
      severity: "error",
      comment:
        "Vendor identifiers and vendor clients belong at the edge. The core " +
        "must not name Zaptec, Easee, or any other adapter — that is the " +
        "slowest-changing layer depending on the fastest-changing external " +
        "dependency. Route it through VendorAssetRef or a domain service " +
        "instead. Known exceptions are in the baseline file.",
      from: {
        path: "^(apps/api/src|src)/",
        pathNot: [...vendorFrom, "\\.test\\.ts$"],
      },
      to: { path: vendorFrom },
    },

    {
      name: "platform-imports-nothing",
      severity: "error",
      comment:
        "Everything may import platform; platform imports nothing. A logger " +
        "that reaches into charging cannot be used by charging.",
      from: { path: platformFrom },
      to: {
        path: LAYERS.map(domainDir).concat(vendorFrom),
      },
    },

    {
      name: "no-circular",
      severity: "error",
      comment:
        "A cycle means the two files are one file that has not admitted it. " +
        "Cheap to prevent, expensive to unpick once a third joins.",
      from: {},
      to: { circular: true },
    },

    {
      name: "not-to-dev-dep",
      severity: "error",
      comment:
        "Shipping code must not import a devDependency — it resolves on a " +
        "developer machine and fails in the Worker.",
      from: { path: "^(apps/api/src|src)/", pathNot: "\\.(test|spec)\\.tsx?$" },
      to: { dependencyTypes: ["npm-dev"] },
    },

    {
      name: "no-console-to-api-internals",
      severity: "error",
      comment:
        "The console (src/) and the API Worker (apps/api/src/) are separate " +
        "deployables. Shared code goes through packages/shared, not a reach " +
        "across the workspace boundary.",
      from: { path: "^src/" },
      to: { path: "^apps/api/src/" },
    },
  ],

  options: {
    doNotFollow: { path: "node_modules" },

    // Generated Prisma clients, build output, and the Flutter app are not
    // source. apps/mobile has no TypeScript at all; gateway/ has no ORM and
    // nothing to enforce.
    //
    // `straumvakt-prisma-cf-client` is matched by name as well as by path.
    // It is generated INTO node_modules, so it resolves there once
    // `npm run db:generate` has run and shows up as an unresolved bare
    // specifier before that. Without this the graph differs depending on
    // whether the client happens to exist, which makes the generated artefact
    // flap between two versions.
    exclude: {
      path: [
        "node_modules",
        "^straumvakt-prisma-cf-client",
        "(^|/)generated/",
        "(^|/)\\.next/",
        "(^|/)\\.open-next/",
        "(^|/)apps/mobile/",
        "(^|/)dist/",
      ],
    },

    tsPreCompilationDeps: true,

    tsConfig: { fileName: "tsconfig.json" },

    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default", "types"],
      extensions: [".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"],
    },

    reporterOptions: {
      dot: { collapsePattern: "node_modules/(@[^/]+/[^/]+|[^/]+)" },
      archi: {
        collapsePattern:
          "^(apps/api/src/domains/[^/]+|apps/api/src/[^/]+|src/[^/]+|packages/[^/]+)",
      },
    },
  },
};
