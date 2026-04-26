import Link from "next/link";
import type { ReactNode } from "react";
import { Plus } from "lucide-react";

export function ActionBar({
  title,
  description,
  primaryAction,
}: {
  title: string;
  description?: ReactNode;
  primaryAction?: { href: string; label: string };
}) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-3 border-b border-bg-border pb-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold text-ink-50">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-sm text-ink-400">{description}</p>}
      </div>
      {primaryAction && (
        <Link
          href={primaryAction.href as Parameters<typeof Link>[0]["href"]}
          className="inline-flex items-center gap-1.5 rounded-md bg-sv-green/20 px-3 py-2 text-sm font-medium text-sv-green ring-1 ring-sv-green/30 transition-colors hover:bg-sv-green/30"
        >
          <Plus className="h-4 w-4" />
          {primaryAction.label}
        </Link>
      )}
    </header>
  );
}
