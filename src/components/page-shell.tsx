import { ReactNode } from "react";

export function PageShell({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-ink-50">{title}</h1>
        {description ? (
          <p className="mt-1 text-sm text-ink-300">{description}</p>
        ) : null}
      </header>
      {children}
    </div>
  );
}
