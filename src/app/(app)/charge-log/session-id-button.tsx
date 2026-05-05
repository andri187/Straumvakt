"use client";

import { useState } from "react";
import { SessionDetailModal } from "./session-detail-modal";

/**
 * Session UID column on /charge-log. Clicking opens a detail modal
 * with the session header, costs, and a power/cumulative-kWh chart
 * from EnergyDetails or OCMF.
 */
export function SessionIdButton({ sessionId }: { sessionId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="font-mono text-[10px] text-ink-500 hover:text-sv-sky"
      >
        {sessionId.slice(0, 8)}…
      </button>
      {open && (
        <SessionDetailModal
          sessionId={sessionId}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
