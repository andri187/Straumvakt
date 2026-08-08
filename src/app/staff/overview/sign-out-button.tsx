"use client";

// Sign out of the platform session and return to the staff entrance.
//
// POST /api/admin/logout clears the cookie on the API Worker's origin, so
// this has to be a fetch rather than a link, and the navigation afterwards
// has to be a full document load — middleware only re-evaluates the (now
// missing) cookie on a fresh request. We navigate even when the call fails:
// leaving someone parked on a page they think they signed out of is worse
// than a stale cookie they can clear by trying again.

import { useState } from "react";
import { apiFetch } from "@/lib/api-client";

export function SignOutButton() {
  const [busy, setBusy] = useState(false);

  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await apiFetch("/api/admin/logout", { method: "POST" });
        } catch {
          // Ignored on purpose — see the note above.
        }
        window.location.href = "/staff";
      }}
      className="rounded-md border border-bg-border px-2.5 py-1 text-xs font-medium text-ink-300 transition hover:bg-bg-raised hover:text-ink-50 disabled:opacity-60"
    >
      {busy ? "Signing out…" : "Sign out"}
    </button>
  );
}
