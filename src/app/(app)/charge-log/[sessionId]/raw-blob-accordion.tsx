"use client";

// Sprint 9 / 2026-05-08 — collapsed raw-blob accordion with copy button.
// Used for raw OCMF envelope and raw 723 CompletedSession JSON.

import { useState } from "react";

export function RawBlobAccordion({
  title,
  content,
}: {
  title: string;
  content: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore — clipboard may be denied in some contexts
    }
  }

  return (
    <details className="mt-3 rounded-lg border border-bg-border bg-bg-base/30">
      <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-ink-300 hover:bg-bg-raised/30">
        {title}{" "}
        <span className="ml-2 font-mono text-[10px] text-ink-500">
          {(content.length / 1024).toFixed(1)} KB
        </span>
      </summary>
      <div className="border-t border-bg-border p-3">
        <div className="mb-2 flex justify-end">
          <button
            type="button"
            onClick={copy}
            className="rounded bg-bg-raised/60 px-2 py-1 text-xs text-ink-300 hover:bg-bg-raised hover:text-ink-100"
          >
            {copied ? "✓ Copied" : "Copy"}
          </button>
        </div>
        <pre className="max-h-96 overflow-auto rounded bg-bg-base/50 p-3 font-mono text-xs leading-relaxed text-ink-300">
          {content}
        </pre>
      </div>
    </details>
  );
}
