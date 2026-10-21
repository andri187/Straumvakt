"use client";

import Link from "next/link";
import type { Route } from "next";
import { useMemo, useState } from "react";

export type StaffOrganisation = {
  id: string;
  displayName: string;
  kind: string;
  status: string;
  countryCode: string | null;
};

export function OrganisationList({
  organisations,
}: {
  organisations: StaffOrganisation[];
}) {
  const [query, setQuery] = useState("");
  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return organisations;
    return organisations.filter((org) =>
      `${org.displayName} ${org.kind} ${org.status}`
        .toLocaleLowerCase()
        .includes(needle),
    );
  }, [organisations, query]);

  return (
    <div>
      <label className="block max-w-md">
        <span className="sr-only">Search organisations</span>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search organisations"
          className="w-full rounded-md border border-bg-border bg-bg-inset px-3 py-2 text-sm text-ink-50 outline-none placeholder:text-ink-500 focus:border-brand-400"
        />
      </label>
      <div className="mt-4 overflow-x-auto border border-bg-border">
        <table className="w-full min-w-[40rem] text-left text-sm">
          <thead className="bg-bg-surface text-[11px] uppercase tracking-wider text-ink-500">
            <tr>
              <th className="px-4 py-3 font-medium">Organisation</th>
              <th className="px-4 py-3 font-medium">Kind</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 text-right font-medium">Support</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-bg-border">
            {visible.map((org) => (
              <tr key={org.id}>
                <td className="px-4 py-3 font-medium text-ink-100">
                  {org.displayName}
                </td>
                <td className="px-4 py-3 text-ink-400">{org.kind}</td>
                <td className="px-4 py-3 text-ink-400">{org.status}</td>
                <td className="px-4 py-3 text-right">
                  <Link
                    href={`/staff/overview/support/${org.id}` as Route}
                    className="text-brand-300 underline underline-offset-2"
                  >
                    Assist
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {visible.length === 0 ? (
          <p className="border-t border-bg-border px-4 py-8 text-center text-sm text-ink-500">
            No organisations match that search.
          </p>
        ) : null}
      </div>
    </div>
  );
}
