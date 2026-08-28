#!/usr/bin/env node
//
// S2 regression guard — offline, no database, no network.
//
// The invite-consume Critical was not that `upsert` existed. It was that
// the credential write happened with no prior check, and that the token
// was claimed BEFORE the route knew whether it would refuse. Two
// properties keep it fixed, and both are orderings that a well-meaning
// refactor can invert while every status-code test stays green:
//
//   1. The credential guard reads before the token is claimed. Inverted,
//      a refusal still burns the invite and locks out the real invitee —
//      the deadlock ADR 0053 fixed on the driver path.
//   2. The credential write happens after the guard.
//
// A unit test covers both (routes/public/invites.test.ts). This exists
// because the unit test needs a runner, and `npm run check` is the only
// gate that has always run in CI. Belt and braces on the one route where
// possession of a token is the whole authorisation.
//
// Deliberately a source-order check rather than a ban on `upsert`:
// banning the verb would push someone to `create`, which raises a unique
// violation on the cleared-password row the guard intentionally lets
// through (password_hash is nullable; clearUserPasswordHash nulls it and
// keeps the row). The guard is the control, not the write verb.

import { readFileSync } from "node:fs";

const FILE = "apps/api/src/routes/public/invites.ts";

const MARKERS = {
  guard: "userCredential.findUnique",
  claim: "userToken.updateMany",
  write: "userCredential.upsert",
};

function main() {
  let src;
  try {
    src = readFileSync(FILE, "utf8");
  } catch {
    fail(`${FILE} not found. If the route moved, update this check — do not delete it.`);
  }

  // Strip comments so the prose above (which names all three markers)
  // cannot satisfy the check on its own.
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, ""))
    .join("\n");

  const at = {};
  for (const [name, marker] of Object.entries(MARKERS)) {
    at[name] = code.indexOf(marker);
    if (at[name] === -1) {
      fail(
        `${FILE}: expected to find \`${marker}\` (the ${name} step). ` +
          `If the consume flow was restructured, re-derive this check from the new shape.`,
      );
    }
  }

  if (at.guard > at.claim) {
    fail(
      `${FILE}: the credential guard (\`${MARKERS.guard}\`) runs AFTER the token claim ` +
        `(\`${MARKERS.claim}\`).\n\n` +
        `  A refusal now burns the invite, so the real invitee can never redeem it.\n` +
        `  Status-code tests do not catch this — the route still returns 409.\n` +
        `  See routes/public/invites.test.ts "does NOT burn the invite on refusal".`,
    );
  }

  if (at.guard > at.write) {
    fail(
      `${FILE}: the credential write (\`${MARKERS.write}\`) runs BEFORE the guard ` +
        `(\`${MARKERS.guard}\`). A bearer of an unused invite token can overwrite ` +
        `an existing password.`,
    );
  }

  process.stdout.write(
    "invite consume: guard precedes claim precedes credential write.\n",
  );
}

function fail(message) {
  process.stderr.write(`\n${message}\n\n`);
  process.exit(1);
}

main();
