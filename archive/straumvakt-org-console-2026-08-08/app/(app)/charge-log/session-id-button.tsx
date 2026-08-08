"use client";

import { useState } from "react";
import { SessionDetailModal } from "./session-detail-modal";

/**
 * Session UID column — primary entry point on /charge-log. Styled
 * as a chip-button: short UID + an "open" chevron, sky-coloured
 * border, hover lift, focus ring. Clear visual affordance that
 * it's clickable. Click opens the SessionDetailModal.
 */
export function SessionIdButton({ sessionId }: { sessionId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={`Open session ${sessionId}`}
        className="
          group inline-flex items-center gap-1.5 rounded-md
          border border-sv-sky/30 bg-sv-sky/5
          px-2 py-1 font-mono text-[11px] text-sv-sky
          transition
          hover:border-sv-sky/60 hover:bg-sv-sky/15 hover:text-sv-sky
          focus:outline-none focus:ring-2 focus:ring-sv-sky/40
          active:translate-y-[1px]
        "
      >
        <span>{sessionId.slice(0, 8)}…</span>
        <span
          aria-hidden
          className="text-[10px] opacity-70 transition group-hover:opacity-100 group-hover:translate-x-0.5"
        >
          ↗
        </span>
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
