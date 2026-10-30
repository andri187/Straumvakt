import Link from "next/link";
import type { Route } from "next";
import { NAV_GROUPS } from "./sections";
import { ContextBar, PageHeader, UnconnectedBanner } from "./workspace-ui";

export const metadata = { title: "Overview" };

const STEPS = NAV_GROUPS.flatMap((group) => group.items).filter(
  (item) => item.key !== "overview",
);

export default function CpoOverviewPage() {
  return (
    <>
      <ContextBar />
      <UnconnectedBanner />
      <PageHeader
        title="Overview"
        subtitle="Your organisation's setup progress, charger activity and items needing attention."
      />

      <section className="ws-panel" aria-labelledby="areas-heading">
        <div className="ws-panel-heading">
          <h2 id="areas-heading">Workspace areas</h2>
        </div>
        {STEPS.map((step) => (
          <Link key={step.href} href={step.href as Route} className="ws-task">
            <span className="ws-task-dot" aria-hidden="true" />
            <span>
              <strong>{step.label}</strong>
              <small>{step.summary}</small>
            </span>
            <span className="ws-badge">Not connected</span>
          </Link>
        ))}
      </section>

      <section className="ws-panel" aria-labelledby="attention-heading">
        <div className="ws-panel-heading">
          <h2 id="attention-heading">Needs attention</h2>
        </div>
        <p className="ws-muted">
          Nothing can be assessed yet because no records are connected. This is
          not a statement that nothing needs attention.
        </p>
      </section>
    </>
  );
}
