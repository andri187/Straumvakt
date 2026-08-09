"use client";

import {
  Activity, AlertTriangle, ArrowRight, Building2, CheckCircle2,
  ChevronRight, CircleHelp, ClipboardCheck, FileClock, Gauge, History,
  KeyRound, LayoutDashboard, ListChecks, Map, Menu, RadioTower, Search,
  Settings, SlidersHorizontal, Zap, ShieldCheck, UserRound, UsersRound,
  Wrench, X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { visualFamilies, type Tone, type VisualFamily } from "./visual-data";

const familyIcons = { admin: ShieldCheck, organisation: Building2, driver: UserRound, service: Wrench };
const navIcons = [LayoutDashboard, Building2, RadioTower, UsersRound, Activity, FileClock, Settings, ClipboardCheck, History, KeyRound, CircleHelp];

function requestedValue(name: string) {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(name);
}

export function VisualStudio() {
  const [familyId, setFamilyId] = useState<VisualFamily["id"]>("admin");
  const [screenId, setScreenId] = useState("overview");
  const [navOpen, setNavOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [reviewOpen, setReviewOpen] = useState(true);

  useEffect(() => {
    const family = requestedValue("family");
    const screen = requestedValue("screen");
    if (visualFamilies.some((item) => item.id === family)) {
      setFamilyId(family as VisualFamily["id"]);
      const target = visualFamilies.find((item) => item.id === family)!;
      setScreenId(target.screens.some((item) => item.id === screen) ? screen! : target.screens[0].id);
    }
  }, []);

  const family = visualFamilies.find((item) => item.id === familyId)!;
  const screen = family.screens.find((item) => item.id === screenId) ?? family.screens[0];
  const filteredRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle ? screen.rows.filter((row) => row.some((cell) => cell.toLowerCase().includes(needle))) : screen.rows;
  }, [query, screen]);

  function chooseFamily(next: VisualFamily) {
    setFamilyId(next.id); setScreenId(next.screens[0].id); setQuery(""); setNavOpen(false);
  }

  function chooseScreen(id: string) {
    setScreenId(id); setQuery(""); setNavOpen(false);
  }

  return (
    <main className={`vx-root vx-${family.id}`}>
      <a className="vx-skip" href="#visual-content">Skip to content</a>
      <aside className={`vx-sidebar ${navOpen ? "is-open" : ""}`} aria-label={`${family.label} navigation`}>
        <div className="vx-brand">
          <span className="vx-mark" aria-hidden="true"><Zap size={20} /></span>
          <div><strong>Straumvakt</strong><small>{family.role}</small></div>
          <button className="vx-close" type="button" onClick={() => setNavOpen(false)} aria-label="Close navigation"><X size={19} /></button>
        </div>
        {family.future ? <div className="vx-future"><Wrench size={14} /> Future service concept</div> : null}
        <nav className="vx-nav">
          <div className="vx-nav-label">Workspace</div>
          {family.screens.map((item, index) => {
            const Icon = navIcons[index % navIcons.length];
            return <button key={item.id} type="button" className={item.id === screen.id ? "active" : ""} aria-current={item.id === screen.id ? "page" : undefined} onClick={() => chooseScreen(item.id)}><Icon size={17} /><span>{item.label}</span>{item.id === screen.id ? <ChevronRight size={15} /> : null}</button>;
          })}
        </nav>
        <div className="vx-absent"><strong>Intentionally absent</strong><p>{family.navigationAbsent}</p></div>
        <div className="vx-profile"><span>{family.shortLabel.slice(0, 2).toUpperCase()}</span><div><strong>{family.role}</strong><small>{family.account}</small></div></div>
      </aside>
      {navOpen ? <button className="vx-scrim" onClick={() => setNavOpen(false)} aria-label="Close navigation overlay" /> : null}

      <section className="vx-main">
        <header className="vx-topbar">
          <button className="vx-menu" type="button" onClick={() => setNavOpen(true)} aria-label="Open navigation"><Menu size={20} /></button>
          <div className="vx-family-switch" role="tablist" aria-label="Visual workspace">
            {visualFamilies.map((item) => {
              const Icon = familyIcons[item.id];
              return <button key={item.id} type="button" role="tab" aria-selected={item.id === family.id} onClick={() => chooseFamily(item)}><Icon size={15} /><span>{item.shortLabel}</span>{item.future ? <small>Future</small> : null}</button>;
            })}
          </div>
          <div className="vx-demo"><span /> Visual preview / demo data</div>
        </header>

        <div id="visual-content" className="vx-content" tabIndex={-1}>
          <header className="vx-pagehead">
            <div><p>{screen.eyebrow}</p><h1>{screen.title}</h1><span>{screen.summary}</span></div>
            <div className="vx-page-actions">
              <Status tone={screen.stateTone}>{screen.state}</Status>
              <button className="vx-ghost-action" type="button" aria-pressed={reviewOpen} onClick={() => setReviewOpen((value) => !value)}><SlidersHorizontal size={16} />Review</button>
              {screen.action ? <button type="button" disabled={screen.actionDisabled}>{screen.action}<ArrowRight size={16} /></button> : null}
            </div>
          </header>
          {screen.notice ? <div className="vx-notice" role="note"><AlertTriangle size={18} /><span>{screen.notice}</span></div> : null}

          <section className="vx-journey" aria-label={`${family.label} screen journey`}>
            <header><Map size={16} /><div><p>Persona journey</p><strong>{family.reviewFocus}</strong></div></header>
            <div>
              {family.screens.map((item, index) => (
                <button key={item.id} type="button" className={item.id === screen.id ? "active" : ""} onClick={() => chooseScreen(item.id)}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <strong>{item.journeyStep}</strong>
                  <small className={`tone-${toneForMaturity(item.maturity)}`}>{item.maturity}</small>
                </button>
              ))}
            </div>
          </section>

          <section className="vx-metrics" aria-label="Key measures">
            {screen.metrics.map((item) => <article key={item.label}><span>{item.label}</span><strong className={`tone-${item.tone}`}>{item.value}</strong><small>{item.detail}</small></article>)}
          </section>

          {reviewOpen ? (
            <section className="vx-review" aria-label="Visual review notes">
              <ReviewCard icon={ListChecks} title="Design intent" body={screen.review.intent} />
              <ReviewCard icon={CheckCircle2} title="Reviewable now" body={screen.review.real} />
              <ReviewCard icon={AlertTriangle} title="Boundary" body={screen.review.blocked} />
              <ReviewCard icon={CircleHelp} title="Decision prompt" body={screen.review.decision} />
            </section>
          ) : null}

          <div className="vx-grid">
            <section className="vx-table-panel" aria-labelledby="visual-table-title">
              <header><div><p>Operational view</p><h2 id="visual-table-title">{screen.tableTitle}</h2></div><label className="vx-search"><Search size={15} /><span className="vx-sr">Search this table</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter current view" /></label></header>
              <div className="vx-table-scroll" tabIndex={0}>
                <table><caption>{screen.tableTitle}. Demo data only.</caption><thead><tr>{screen.columns.map((column) => <th key={column} scope="col">{column}</th>)}</tr></thead><tbody>{filteredRows.map((row) => <tr key={row.join("|")}>{row.map((cell, index) => <td key={`${index}-${cell}`}>{index === 0 ? <strong>{cell}</strong> : cell}</td>)}</tr>)}</tbody></table>
              </div>
              <footer><span aria-live="polite">Showing {filteredRows.length} of {screen.rows.length}</span><button type="button">View details <ChevronRight size={15} /></button></footer>
            </section>

            <aside className="vx-queue" aria-labelledby="visual-queue-title">
              <header><p>Priority</p><h2 id="visual-queue-title">{screen.queueTitle}</h2></header>
              <div>{screen.queue.map((item) => <article key={item.title}><span className={`vx-signal tone-${item.tone}`} aria-hidden="true" /> <div><strong>{item.title}</strong><p>{item.detail}</p></div><ChevronRight size={16} aria-hidden="true" /></article>)}</div>
              <footer><Gauge size={16} /><span>Source-shaped visual concept</span></footer>
            </aside>
          </div>

          <section className="vx-workflow" aria-label="Workflow states">
            <header><p>Interaction model</p><h2>Expected states</h2></header>
            <div>
              <Workflow icon={CheckCircle2} title="Ready" body="Real data can later replace this fixture without changing hierarchy." />
              <Workflow icon={FileClock} title="Loading" body="Dimensions stay stable and the region announces progress." />
              <Workflow icon={AlertTriangle} title="Unavailable" body="Missing contracts disable actions and explain the dependency." />
              <Workflow icon={ShieldCheck} title="Scoped" body="Each persona sees only the information required for its job." />
            </div>
          </section>

          <section className="vx-system" aria-label="Design system notes">
            <article><span className="vx-swatch is-accent" /><div><strong>Accent</strong><p>Persona color marks location and active state only.</p></div></article>
            <article><span className="vx-swatch is-surface" /><div><strong>Surfaces</strong><p>Flat operational panels, no marketing cards or hero treatment.</p></div></article>
            <article><span className="vx-swatch is-warn" /><div><strong>Disabled means planned</strong><p>Unavailable actions must explain the missing contract.</p></div></article>
            <article><span className="vx-swatch is-bad" /><div><strong>Hidden means rejected</strong><p>Do not render controls that imply unwanted roadmap commitments.</p></div></article>
          </section>

          <section className="vx-decisions" aria-label={`${family.label} next design decisions`}>
            <header><p>Review queue</p><h2>Next decisions for {family.shortLabel}</h2></header>
            <div>{family.nextDecisions.map((decision) => <article key={decision}><ChevronRight size={15} /><span>{decision}</span></article>)}</div>
          </section>
        </div>
      </section>
    </main>
  );
}

function Status({ tone, children }: { tone: Tone; children: React.ReactNode }) { return <span className={`vx-status tone-${tone}`}><span aria-hidden="true" />{children}</span>; }
function Workflow({ icon: Icon, title, body }: { icon: typeof CheckCircle2; title: string; body: string }) { return <article><Icon size={18} /><div><strong>{title}</strong><p>{body}</p></div></article>; }
function ReviewCard({ icon: Icon, title, body }: { icon: typeof CheckCircle2; title: string; body: string }) { return <article><Icon size={18} /><div><strong>{title}</strong><p>{body}</p></div></article>; }
function toneForMaturity(maturity: "ready" | "preview" | "blocked" | "future"): Tone {
  if (maturity === "ready") return "good";
  if (maturity === "blocked") return "bad";
  if (maturity === "future") return "warn";
  return "info";
}
