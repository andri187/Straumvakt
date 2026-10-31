"use client";

import { useEffect, useReducer, useRef, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import type { InstallationListRow } from "@/lib/installations/drizzle-store";
import { buildCircuitTree, countCircuitChargers, createDetailLoader, groupSites, type CircuitNode, type DetailView } from "@/lib/installations/tree";
import "./installation-tree.css";

type Detail = DetailView;
type Node = CircuitNode<Detail["circuits"][number], Detail["chargers"][number]>;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const electrical = (amps: number | null, phases: number | null) =>
  [phases ? `${phases} phase${phases === 1 ? "" : "s"}` : null, amps !== null ? `${amps} A` : null].filter(Boolean).join(" · ") || "Rating not set";

const ERRORS = {
  denied: "Access to this installation was lost. Sign in again; nothing is shown because nothing could be read.",
  gone: "This installation no longer exists.",
  failed: "The details could not be read.",
} as const;

function Arrow({ open }: { open: boolean }) {
  return <span className={`it-arrow${open ? " it-open" : ""}`} aria-hidden="true" />;
}

function ChargerRow({ c }: { c: Detail["chargers"][number] }) {
  return (
    <li className="it-charger">
      <span className="it-device" aria-hidden="true" />
      <span>{c.label || "(unnamed)"}</span>
      <code className="it-id">{c.chargePointId}</code>
      <span className="it-dim">{[c.vendor, c.model].filter(Boolean).join(" ")}</span>
    </li>
  );
}

function CircuitRow({ n }: { n: Node }) {
  const [open, setOpen] = useState(false); // circuits start collapsed; their data is already in the loaded snapshot
  const count = countCircuitChargers(n);
  const expandable = n.children.length > 0 || n.chargers.length > 0;
  const panel = `it-c-${n.circuit.id}`;
  return (
    <li className="it-circuit">
      <div className="it-line">
        {expandable ? (
          <button type="button" className="it-toggle" aria-expanded={open} aria-controls={panel} onClick={() => setOpen(!open)}>
            <Arrow open={open} />
            <span className="it-name">{n.circuit.displayName}</span>
          </button>
        ) : (
          <span className="it-leaf"><span className="it-name">{n.circuit.displayName}</span></span>
        )}
        <span className="it-elec">{electrical(n.circuit.ratingAmps, n.circuit.phaseCount)}</span>
        <span className="it-right">{plural(count, "charger")}</span>
      </div>
      {expandable && open ? (
        <ul id={panel} className="it-list">
          {n.children.map((c) => <CircuitRow key={c.circuit.id} n={c} />)}
          {n.chargers.map((c) => <ChargerRow key={c.id} c={c} />)}
        </ul>
      ) : null}
    </li>
  );
}

function DetailBody({ view }: { view: Detail }) {
  const { roots, unplaced } = buildCircuitTree(view.circuits, view.chargers);
  if (roots.length === 0 && unplaced.length === 0) return <p className="it-empty">No circuits or chargers yet.</p>;
  return (
    <ul className="it-list">
      {roots.map((n) => <CircuitRow key={n.circuit.id} n={n} />)}
      {unplaced.length > 0 ? (
        <li className="it-circuit">
          <div className="it-line"><span className="it-leaf"><span className="it-name">Not on a listed circuit</span></span><span className="it-right">{plural(unplaced.length, "charger")}</span></div>
          <ul className="it-list">{unplaced.map((c) => <ChargerRow key={c.id} c={c} />)}</ul>
        </li>
      ) : null}
    </ul>
  );
}

/**
 * Site -> installation -> circuit -> charger, from the overview list plus, on first explicit expansion of an installation,
 * the existing single-installation read. Sites, installations and circuits all start collapsed. No polling, no mutation.
 */
export function InstallationTree({ rows, attachQuery = "", fetchImpl }: { rows: InstallationListRow[]; attachQuery?: string; fetchImpl?: typeof fetch }) {
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [closedSites, setClosedSites] = useState<Record<string, boolean>>({});
  const fetchRef = useRef(fetchImpl);
  fetchRef.current = fetchImpl;
  const loader = useRef<ReturnType<typeof createDetailLoader> | null>(null);
  useEffect(() => {
    const l = createDetailLoader((...a) => (fetchRef.current ?? fetch)(...a), redraw);
    loader.current = l;
    return () => {
      l.dispose();
      loader.current = null;
    };
  }, []);

  // The ref, not the rendered state, decides what a click does, so two clicks before a re-render still alternate.
  const openRef = useRef<Record<string, boolean>>({});
  const toggle = (id: string) => {
    const next = !openRef.current[id];
    openRef.current = { ...openRef.current, [id]: next };
    setOpen(openRef.current);
    if (next) loader.current?.load(id);
  };
  const sites = groupSites(rows);
  return (
    <div className="it-tree">
      <ul className="it-list">
        {sites.map((s) => {
          const siteOpen = closedSites[s.siteId] === false;
          return (
            <li key={s.siteId} className="it-site">
              <div className="it-line it-siteline">
                <button type="button" className="it-toggle" aria-expanded={siteOpen} aria-controls={`it-s-${s.siteId}`} onClick={() => setClosedSites({ ...closedSites, [s.siteId]: siteOpen })}>
                  <Arrow open={siteOpen} />
                  <span className="it-name it-sitename">{s.siteName}</span>
                </button>
                <span className="it-dim">{s.orgName}</span>
                <span className="it-right">{plural(s.installations.length, "installation")}</span>
              </div>
              {siteOpen ? (
                <ul id={`it-s-${s.siteId}`} className="it-list it-sitebody">
                  {s.installations.map((r) => {
                    const isOpen = !!open[r.id];
                    const st = isOpen ? loader.current?.get(r.id) : undefined;
                    const href = `/cpo/installations?id=${r.id}${attachQuery}` as Route;
                    return (
                      <li key={r.id} className="it-installation">
                        <div className="it-line">
                          <button type="button" className="it-toggle it-arrow-only" aria-expanded={isOpen} aria-controls={`it-i-${r.id}`} aria-label={`${isOpen ? "Collapse" : "Expand"} ${r.displayName}`} onClick={() => toggle(r.id)}>
                            <Arrow open={isOpen} />
                          </button>
                          <Link className="it-name it-link" href={href} prefetch={false}>{r.displayName}</Link>
                          {st?.status === "ready" ? (
                            <>
                              {st.view.installation.mainGridType ? <span className="it-badge">{st.view.installation.mainGridType}</span> : null}
                              <span className="it-elec">{electrical(st.view.installation.mainRatingAmps, st.view.installation.mainPhaseCount)}</span>
                            </>
                          ) : null}
                          <span className="it-right">
                            <span>{plural(r.circuitCount, "circuit")} · {plural(r.chargerCount, "charger")}</span>
                            <Link className="it-edit" href={href} prefetch={false}>Edit<span className="it-sr"> {r.displayName}</span></Link>
                          </span>
                        </div>
                        {isOpen ? (
                          <div id={`it-i-${r.id}`} className="it-body" aria-busy={st?.status === "loading"}>
                            {!st || st.status === "loading" ? (
                              <p className="it-empty" role="status">Loading details…</p>
                            ) : st.status === "error" ? (
                              <p className="it-empty it-error" role="alert">
                                {ERRORS[st.kind]}{" "}
                                {st.kind !== "denied" ? <button type="button" className="it-retry" onClick={() => loader.current?.retry(r.id)}>Retry</button> : null}
                              </p>
                            ) : (
                              <DetailBody view={st.view} />
                            )}
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
