"use client";

import {
  AlertTriangle,
  ArrowRight,
  Building2,
  ChevronRight,
  CircleHelp,
  Clock3,
  FileText,
  Gauge,
  History,
  KeyRound,
  LayoutDashboard,
  LockKeyhole,
  Menu,
  RadioTower,
  Search,
  Settings,
  ShieldCheck,
  UserRound,
  UsersRound,
  X,
  Zap,
} from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useMemo, useState } from "react";
import type { VisualFamily, VisualScreen } from "../visual/visual-data";
import { getCoreDetail } from "./core-product-data";
import {
  getPostLoginNavigationSections,
  postLoginHref,
  type PostLoginNavigationSection,
  type PostLoginPersona,
} from "./post-login-data";

const navIcons = [
  LayoutDashboard,
  Building2,
  RadioTower,
  UsersRound,
  KeyRound,
  History,
  FileText,
  Settings,
  CircleHelp,
];
const contextIcons = { admin: ShieldCheck, org: Building2, driver: UserRound };

export function PostLoginShell({
  persona,
  family,
  screen,
}: {
  persona: PostLoginPersona;
  family: VisualFamily;
  screen: VisualScreen;
}) {
  const [navOpen, setNavOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ContextIcon = contextIcons[persona.routeId];
  const coreDetail = getCoreDetail(persona.routeId, screen.id);
  const navigationSections = getPostLoginNavigationSections(persona, family);
  const filteredRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle
      ? screen.rows.filter((row) =>
          row.some((cell) => cell.toLowerCase().includes(needle)),
        )
      : screen.rows;
  }, [query, screen.rows]);

  return (
    <main className={`pl-root pl-${persona.routeId}`}>
      <a className="pl-skip" href="#post-login-content">
        Skip to content
      </a>
      <aside
        className={`pl-sidebar ${navOpen ? "is-open" : ""}`}
        aria-label={`${persona.label} navigation`}
      >
        <div className="pl-brand">
          <span className="pl-mark">
            <Zap size={19} />
          </span>
          <div>
            <strong>Straumvakt</strong>
            <small>{persona.label}</small>
          </div>
          <button
            type="button"
            className="pl-close"
            onClick={() => setNavOpen(false)}
            aria-label="Close navigation"
          >
            <X size={19} />
          </button>
        </div>

        <section className="pl-context" aria-label="Current operating context">
          <ContextIcon size={17} />
          <div>
            <span>{persona.contextLabel}</span>
            <strong>{persona.contextValue}</strong>
          </div>
        </section>

        <nav className="pl-nav" aria-label="Workspace pages">
          <span>Workspace</span>
          {navigationSections.map((section) => (
            <NavigationSection
              key={section.id}
              section={section}
              family={family}
              persona={persona}
              currentScreenId={screen.id}
              onNavigate={() => setNavOpen(false)}
            />
          ))}
        </nav>

        <div className="pl-boundary">
          <LockKeyhole size={16} />
          <div>
            <strong>Scope boundary</strong>
            <p>{persona.boundary}</p>
          </div>
        </div>
        <div className="pl-account">
          <span>{persona.label.slice(0, 2).toUpperCase()}</span>
          <div>
            <strong>{persona.account}</strong>
            <Link href={"/login-demo" as Route}>Leave demo</Link>
          </div>
        </div>
      </aside>
      {navOpen ? (
        <button
          type="button"
          className="pl-scrim"
          onClick={() => setNavOpen(false)}
          aria-label="Close navigation overlay"
        />
      ) : null}

      <section className="pl-main">
        <header className="pl-topbar">
          <button
            type="button"
            className="pl-menu"
            onClick={() => setNavOpen(true)}
            aria-label="Open navigation"
          >
            <Menu size={20} />
          </button>
          <div className="pl-crumb">
            <span>Demo app</span>
            <ChevronRight size={13} />
            <strong>{persona.label}</strong>
          </div>
          <div className="pl-demo-state">
            <span /> Local fixture / no authentication
          </div>
        </header>

        <div id="post-login-content" className="pl-content" tabIndex={-1}>
          <header className="pl-pagehead">
            <div>
              <p>{screen.eyebrow}</p>
              <h1>{screen.title}</h1>
              <span>{screen.summary}</span>
              <div
                className="pl-capabilities"
                aria-label="Screen capability and data state"
              >
                <span>Core</span>
                <span>Local fixture</span>
                <span>Read only</span>
                {screen.actionDisabled ? <span>Backend gated</span> : null}
              </div>
            </div>
            <div className="pl-actions">
              <Status tone={screen.stateTone}>{screen.state}</Status>
              {screen.action ? (
                <button
                  type="button"
                  disabled
                  aria-describedby="demo-action-boundary"
                >
                  {screen.action}
                  <ArrowRight size={16} />
                </button>
              ) : null}
            </div>
          </header>

          <div id="demo-action-boundary" className="pl-demo-notice" role="note">
            <LockKeyhole size={17} />
            <span>
              Visual demo only. Data-changing actions are unavailable and
              nothing is submitted.
            </span>
          </div>
          {screen.notice ? (
            <div className="pl-warning" role="alert">
              <AlertTriangle size={18} />
              <span>{screen.notice}</span>
            </div>
          ) : null}

          <PersonaWorkflowBand persona={persona.routeId} />

          {coreDetail ? (
            <section
              className="pl-core-contract"
              aria-labelledby="core-contract-title"
            >
              <header>
                <div>
                  <p>{coreDetail.eyebrow}</p>
                  <h2 id="core-contract-title">Core product contract</h2>
                </div>
                <span>Iceland / ISK / UTC+0</span>
              </header>
              <div>
                {coreDetail.items.map((item) => (
                  <article key={item.label}>
                    <span>{item.label}</span>
                    <strong className={`tone-${item.tone}`}>
                      {item.value}
                    </strong>
                    <small>{item.detail}</small>
                  </article>
                ))}
              </div>
              <footer>{coreDetail.summary}</footer>
            </section>
          ) : null}

          {!coreDetail ? (
            <section className="pl-metrics" aria-label="Key measures">
              {screen.metrics.map((metric) => (
                <Metric key={metric.label} metric={metric} />
              ))}
            </section>
          ) : null}

          <div className="pl-grid">
            <section
              className="pl-table-panel"
              aria-labelledby="post-login-table-title"
            >
              <header>
                <div>
                  <p>Operational view</p>
                  <h2 id="post-login-table-title">{screen.tableTitle}</h2>
                </div>
                <label className="pl-search">
                  <Search size={15} />
                  <span className="pl-sr">Filter current table</span>
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Filter current view"
                  />
                </label>
              </header>
              <div className="pl-table-scroll" tabIndex={0}>
                <table>
                  <caption>{screen.tableTitle}. Local demo data only.</caption>
                  <thead>
                    <tr>
                      {screen.columns.map((column) => (
                        <th key={column} scope="col">
                          {column}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.map((row) => (
                      <tr key={row.join("|")}>
                        {row.map((cell, index) => (
                          <td key={`${index}-${cell}`}>
                            {index === 0 ? <strong>{cell}</strong> : cell}
                            {isMoney(cell) ? <small>demo</small> : null}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <footer aria-live="polite">
                Showing {filteredRows.length} of {screen.rows.length} demo
                records
              </footer>
            </section>

            <aside
              className="pl-queue"
              aria-labelledby="post-login-queue-title"
            >
              <header>
                <p>Needs attention</p>
                <h2 id="post-login-queue-title">{screen.queueTitle}</h2>
              </header>
              <div>
                {screen.queue.map((item) => (
                  <article key={item.title}>
                    <span className={`pl-signal tone-${item.tone}`} />
                    <div>
                      <strong>{item.title}</strong>
                      <p>{item.detail}</p>
                    </div>
                    <ChevronRight size={16} />
                  </article>
                ))}
              </div>
              <footer>
                <Gauge size={16} />
                <span>Source-shaped local fixtures</span>
              </footer>
            </aside>
          </div>

          <section
            className="pl-state-strip"
            aria-label="Product state boundary"
          >
            <article>
              <Clock3 size={17} />
              <div>
                <strong>Current state</strong>
                <p>
                  {screen.state}. Values remain local and reset with the demo.
                </p>
              </div>
            </article>
            <article>
              <LockKeyhole size={17} />
              <div>
                <strong>Not wired</strong>
                <p>{screen.review.blocked}</p>
              </div>
            </article>
          </section>
        </div>
      </section>
    </main>
  );
}

function NavigationSection({
  section,
  family,
  persona,
  currentScreenId,
  onNavigate,
}: {
  section: PostLoginNavigationSection;
  family: VisualFamily;
  persona: PostLoginPersona;
  currentScreenId: string;
  onNavigate: () => void;
}) {
  const [expanded, setExpanded] = useState(section.screenIds.includes(currentScreenId));
  const screens = section.screenIds
    .map((id) => family.screens.find((screen) => screen.id === id))
    .filter((item): item is VisualScreen => Boolean(item));
  const links = screens.map((item, index) => {
    const Icon = navIcons[index % navIcons.length];
    const current = item.id === currentScreenId;
    return (
      <Link
        key={item.id}
        href={postLoginHref(persona, item.id) as Route}
        aria-current={current ? "page" : undefined}
        onClick={onNavigate}
      >
        <Icon size={17} />
        <span>{item.label}</span>
        {current ? <ChevronRight size={15} /> : null}
      </Link>
    );
  });

  if (section.collapsed) {
    return (
      <details
        className="pl-nav-group"
        open={expanded}
        onToggle={(event) => setExpanded(event.currentTarget.open)}
      >
        <summary>
          {section.label}
          <span>{screens.length}</span>
        </summary>
        {links}
      </details>
    );
  }
  return (
    <section className="pl-nav-group" aria-label={section.label}>
      <h2>{section.label}</h2>
      {links}
    </section>
  );
}

const workflowCopy: Record<
  PostLoginPersona["routeId"],
  { label: string; steps: string[]; note: string }
> = {
  admin: {
    label: "Platform control path",
    steps: [
      "Organisation readiness",
      "Fleet exceptions",
      "Billing evidence",
      "Attributed support",
    ],
    note: "Support can inspect context; it cannot impersonate a tenant or complete commercial acceptance.",
  },
  org: {
    label: "Monthly operating path",
    steps: [
      "CDR evidence",
      "Versioned rates",
      "Period review",
      "Statements and delivery",
    ],
    note: "A configured tariff is not proof of a final charge. Mismatched or unlabelled sessions remain held.",
  },
  driver: {
    label: "Your charging record",
    steps: [
      "Access scope",
      "Metered energy",
      "Rate and fees",
      "Statement status",
    ],
    note: "A statement explains charging costs. It is not an invoice, payment request or paid status.",
  },
};

function PersonaWorkflowBand({
  persona,
}: {
  persona: PostLoginPersona["routeId"];
}) {
  const workflow = workflowCopy[persona];
  return (
    <section className="pl-workflow" aria-label={workflow.label}>
      <header>
        <span>{workflow.label}</span>
        <p>{workflow.note}</p>
      </header>
      <ol>
        {workflow.steps.map((step, index) => (
          <li key={step}>
            <span>{index + 1}</span>
            <strong>{step}</strong>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Status({
  tone,
  children,
}: {
  tone: VisualScreen["stateTone"];
  children: React.ReactNode;
}) {
  return (
    <span className={`pl-status tone-${tone}`}>
      <span />
      {children}
    </span>
  );
}

function Metric({ metric }: { metric: VisualScreen["metrics"][number] }) {
  const money = isMoney(`${metric.label} ${metric.value}`);
  return (
    <article>
      <span>{metric.label}</span>
      <strong className={`tone-${metric.tone}`}>{metric.value}</strong>
      <small>{metric.detail}</small>
      {money ? <em>Demo / read only</em> : null}
    </article>
  );
}

function isMoney(value: string): boolean {
  return /\bkr\b|kr\/kWh|cost|price/i.test(value);
}
