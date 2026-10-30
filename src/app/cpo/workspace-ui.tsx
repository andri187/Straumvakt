// Presentation pieces for the unconnected workspace screens. Server
// components only: every control here either navigates or is visibly disabled
// with the reason shown beside it.

import Link from "next/link";
import type { Route } from "next";
import type { ReactNode } from "react";
import type { Action, ShellPage, ShellTab, TabContent } from "./sections";

export function ContextBar() {
  return (
    <div className="ws-context">
      <span>
        <i className="ws-context-dot" aria-hidden="true" />
        Shared test login · no organisation selected
      </span>
      <span>Charge point operator workspace</span>
    </div>
  );
}

export function UnconnectedBanner() {
  return (
    <p className="ws-banner" role="note">
      Not connected · No records, invitations, chargers or costs are connected
      to this workspace yet. Nothing shown here is a measured total, and an
      empty list is not a confirmed zero.
    </p>
  );
}

export function PageHeader({
  title,
  subtitle,
  action,
  actionId,
}: {
  title: string;
  subtitle: string;
  action?: Action;
  actionId?: string;
}) {
  return (
    <div className="ws-title">
      <div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      {action ? <UnavailableAction action={action} id={actionId ?? "action"} /> : null}
    </div>
  );
}

export function UnavailableAction({ action, id }: { action: Action; id: string }) {
  const reasonId = `${id}-reason`;
  return (
    <div className="ws-action">
      <button
        type="button"
        className="ws-button ws-primary"
        disabled
        aria-describedby={reasonId}
      >
        {action.label}
      </button>
      <small id={reasonId}>{action.reason}</small>
    </div>
  );
}

export function TabNav({ page, active }: { page: ShellPage; active: ShellTab }) {
  if (page.tabs.length < 2) return null;
  return (
    <nav className="ws-tabs" aria-label="Page sections">
      {page.tabs.map((tab, index) => (
        <Link
          key={tab.key}
          href={(index === 0 ? page.href : `${page.href}?tab=${tab.key}`) as Route}
          aria-current={tab.key === active.key ? "page" : undefined}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}

export function Note({ children }: { children: ReactNode }) {
  return <p className="ws-note">{children}</p>;
}

export function TabBody({ content }: { content: TabContent }) {
  if (content.kind === "facts") {
    return (
      <section className="ws-panel" aria-label="Details">
        <dl className="ws-facts">
          {content.facts.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>
                {value === "Not connected" ? (
                  <span className="ws-badge">{value}</span>
                ) : (
                  value
                )}
              </dd>
            </div>
          ))}
        </dl>
      </section>
    );
  }
  return (
    <div className="ws-table-wrap">
      <table className="ws-table">
        <thead>
          <tr>
            {content.columns.map((column) => (
              <th key={column} scope="col">
                {column}
              </th>
            ))}
          </tr>
        </thead>
      </table>
      <div className="ws-empty">
        <strong>{content.emptyTitle}</strong>
        {content.emptyDetail}
      </div>
    </div>
  );
}
