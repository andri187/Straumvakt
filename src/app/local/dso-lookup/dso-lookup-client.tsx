"use client";

// The local DSO lookup workspace.
//
// Flow: unlock with the demo credential -> search an address -> select it ->
// the map centres on it and the panel shows which distribution operator the
// sampled service-area layer puts it in, with a confidence grade.
//
// The "login" is a useState boolean. See demo-credential.ts for why that is
// the honest design rather than a shortcoming.

import { useMemo, useState } from "react";
import {
  checkDemoCredential,
  DEMO_CREDENTIAL_WARNING,
  DEMO_PASSWORD,
  DEMO_USERNAME,
} from "./demo-credential";
import { formatAddress, type HmsAddressRecord } from "./address-fixtures";
import { searchAddresses } from "./address-search";
import { DsoMap } from "./dso-map";
import { formatKm, needsManualConfirmation, resolveDso } from "./dso-resolve";
import {
  DSO_SAMPLE_HARVEST_DATE,
  DSO_SAMPLE_SOURCE_LAYER,
  DSO_SAMPLE_SOURCE_SERVICE,
} from "./dso-service-areas";
import { DSO_LAYERS, type DsoLayerId } from "./wms";
import type { LatLng, Viewport } from "./web-mercator";

const MAP_WIDTH_PX = 820;
const MAP_HEIGHT_PX = 520;

/** Iceland, with margin. The map never centres outside this. */
const ICELAND_BOUNDS = { minLat: 63.15, maxLat: 66.75, minLng: -24.95, maxLng: -13.05 };

const VIEWS = {
  southwest: { center: { lat: 64.02, lng: -21.86 }, zoom: 10, label: "Southwest" },
  iceland: { center: { lat: 64.95, lng: -19.0 }, zoom: 6, label: "Iceland" },
} as const;

/** Zoom used when an address is selected — close enough to read a boundary. */
const SELECTED_ZOOM = 13;

function clampToIceland(point: LatLng): LatLng {
  return {
    lat: Math.max(ICELAND_BOUNDS.minLat, Math.min(ICELAND_BOUNDS.maxLat, point.lat)),
    lng: Math.max(ICELAND_BOUNDS.minLng, Math.min(ICELAND_BOUNDS.maxLng, point.lng)),
  };
}

const CONFIDENCE_STYLE: Record<string, string> = {
  exact: "border-brand-300/40 bg-brand-300/10 text-brand-300",
  "near-boundary": "border-amber-300/40 bg-amber-300/10 text-amber-200",
  "manual-review": "border-red-400/40 bg-red-400/10 text-red-300",
};

export function DsoLookup() {
  const [unlocked, setUnlocked] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<HmsAddressRecord | null>(null);
  const [layer, setLayer] = useState<DsoLayerId>("raforkudreifing");
  const [showOverlay, setShowOverlay] = useState(true);
  const [view, setView] = useState<keyof typeof VIEWS>("southwest");
  const [overrideReason, setOverrideReason] = useState("");

  const results = useMemo(() => searchAddresses(query), [query]);
  const suggestion = useMemo(
    () => (selected ? resolveDso({ lat: selected.lat, lng: selected.lng }) : null),
    [selected],
  );

  const viewport: Viewport = useMemo(() => {
    if (selected) {
      return {
        center: clampToIceland({ lat: selected.lat, lng: selected.lng }),
        zoom: SELECTED_ZOOM,
        widthPx: MAP_WIDTH_PX,
        heightPx: MAP_HEIGHT_PX,
      };
    }
    const preset = VIEWS[view];
    return {
      center: clampToIceland(preset.center),
      zoom: preset.zoom,
      widthPx: MAP_WIDTH_PX,
      heightPx: MAP_HEIGHT_PX,
    };
  }, [selected, view]);

  function submitLogin(event: React.FormEvent) {
    event.preventDefault();
    if (checkDemoCredential(username, password)) {
      setUnlocked(true);
      setLoginError(null);
      return;
    }
    setLoginError("Incorrect demo credential.");
  }

  if (!unlocked) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-bg-base px-4 text-ink-50">
        <div className="w-full max-w-md border border-bg-border bg-bg-surface p-6">
          <p className="text-[10px] font-semibold uppercase tracking-normal text-brand-300">
            Local preview · DSO lookup
          </p>
          <h1 className="mt-1 text-xl font-semibold">Sign in to the DSO demo</h1>
          <p className="mt-2 text-xs leading-relaxed text-ink-500">{DEMO_CREDENTIAL_WARNING}</p>

          <form className="mt-5 grid gap-3" onSubmit={submitLogin}>
            <label className="grid gap-1 text-xs">
              <span className="text-ink-400">User</span>
              <input
                className="border border-bg-border bg-bg-base px-3 py-2 text-sm outline-none focus:border-brand-300"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="off"
                name="demo-user"
              />
            </label>
            <label className="grid gap-1 text-xs">
              <span className="text-ink-400">Password</span>
              <input
                type="password"
                className="border border-bg-border bg-bg-base px-3 py-2 text-sm outline-none focus:border-brand-300"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="off"
                name="demo-pass"
              />
            </label>
            {loginError ? (
              <p role="alert" className="text-xs text-red-300">
                {loginError}
              </p>
            ) : null}
            <button
              type="submit"
              className="mt-1 border border-brand-300/50 bg-brand-300/10 px-3 py-2 text-sm font-medium text-brand-300 hover:bg-brand-300/20"
            >
              Open DSO workspace
            </button>
          </form>

          <p className="mt-4 border border-dashed border-bg-border px-3 py-2 text-[11px] text-ink-500">
            Demo credential: <code className="text-brand-300">{DEMO_USERNAME}</code> /{" "}
            <code className="text-brand-300">{DEMO_PASSWORD}</code>
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-bg-base text-ink-50">
      <header className="border-b border-bg-border bg-bg-surface">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-normal text-brand-300">
              Local preview · not production
            </p>
            <h1 className="mt-1 text-lg font-semibold">DSO lookup — address to distribution operator</h1>
          </div>
          <p className="max-w-md text-[11px] leading-relaxed text-ink-500">
            Addresses are demo records. Distribution areas were sampled from the live{" "}
            <code className="text-brand-300">{DSO_SAMPLE_SOURCE_LAYER}</code> layer on{" "}
            {DSO_SAMPLE_HARVEST_DATE}.
          </p>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl gap-5 px-4 py-6 sm:px-6 lg:grid-cols-[1fr_380px]">
        <section className="grid gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {(Object.keys(DSO_LAYERS) as DsoLayerId[]).map((id) => (
              <button
                key={id}
                type="button"
                aria-pressed={layer === id}
                onClick={() => setLayer(id)}
                className={`border px-3 py-1.5 text-xs ${
                  layer === id
                    ? "border-brand-300/60 bg-brand-300/10 text-brand-300"
                    : "border-bg-border text-ink-400 hover:text-ink-50"
                }`}
              >
                {DSO_LAYERS[id].label}
              </button>
            ))}
            <span className="mx-1 h-4 w-px bg-bg-border" />
            {(Object.keys(VIEWS) as (keyof typeof VIEWS)[]).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => {
                  setSelected(null);
                  setView(key);
                }}
                className="border border-bg-border px-3 py-1.5 text-xs text-ink-400 hover:text-ink-50"
              >
                {VIEWS[key].label}
              </button>
            ))}
            <button
              type="button"
              aria-pressed={showOverlay}
              onClick={() => setShowOverlay((v) => !v)}
              className="border border-bg-border px-3 py-1.5 text-xs text-ink-400 hover:text-ink-50"
            >
              {showOverlay ? "Overlay on" : "Overlay off"}
            </button>
          </div>

          <DsoMap
            viewport={viewport}
            layer={layer}
            showOverlay={showOverlay}
            marker={selected ? { lat: selected.lat, lng: selected.lng } : null}
            markerLabel={selected ? `${selected.heitiNf} ${selected.husnr}` : undefined}
          />

          {layer === "orkusparsvaedi" ? (
            <p className="border border-amber-300/35 bg-amber-300/10 px-3 py-2 text-[11px] text-amber-200">
              Orkuspársvæði is an energy <em>forecast</em> layer shown for comparison. It does not
              define distribution operators — only Raforkudreifing does.
            </p>
          ) : null}
        </section>

        <aside className="grid content-start gap-4">
          <div className="border border-bg-border bg-bg-surface">
            <div className="border-b border-bg-border px-4 py-3 text-xs font-semibold">
              Address search
            </div>
            <div className="p-4">
              <input
                className="w-full border border-bg-border bg-bg-base px-3 py-2 text-sm outline-none focus:border-brand-300"
                placeholder="e.g. Garðatorg, gardatorg, 210, Akureyri"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Search an Icelandic address"
              />
              <p className="mt-2 text-[10px] text-ink-500">
                Demo address records — Staðfangaskrá has not been imported.
              </p>

              <ul className="mt-3 grid gap-px">
                {results.map((hit) => (
                  <li key={hit.record.hnitnum}>
                    <button
                      type="button"
                      onClick={() => setSelected(hit.record)}
                      className={`w-full border px-3 py-2 text-left text-xs hover:border-brand-300/50 ${
                        selected?.hnitnum === hit.record.hnitnum
                          ? "border-brand-300/60 bg-brand-300/10"
                          : "border-bg-border"
                      }`}
                    >
                      {hit.display}
                    </button>
                  </li>
                ))}
                {query.trim().length > 0 && results.length === 0 ? (
                  <li className="px-1 py-2 text-xs text-ink-500">No demo address matches that.</li>
                ) : null}
              </ul>
            </div>
          </div>

          {selected && suggestion ? (
            <div className="border border-bg-border bg-bg-surface">
              <div className="border-b border-bg-border px-4 py-3 text-xs font-semibold">
                Suggested distribution operator
              </div>
              <dl className="grid gap-px text-xs">
                <Row label="Address" value={formatAddress(selected)} />
                <Row
                  label="Coordinates"
                  value={`${selected.lat.toFixed(5)}, ${selected.lng.toFixed(5)}`}
                />
                <Row
                  label="Postal code"
                  value={selected.postnr}
                  hint="Supportive only — never decides the operator"
                />
                <Row label="Suggested DSO" value={suggestion.dso ?? "Not determined"} strong />
                <Row label="Tariff area" value={suggestion.serviceArea ?? "—"} />
                <Row
                  label="Area class"
                  value={
                    suggestion.areaClass === "urban"
                      ? "Þéttbýli (urban)"
                      : suggestion.areaClass === "rural"
                        ? "Dreifbýli (rural)"
                        : "—"
                  }
                />
                <Row
                  label="Nearest sample"
                  value={
                    suggestion.distanceM === null
                      ? "—"
                      : `${formatKm(suggestion.distanceM)} · ${suggestion.matchedSampleLabel ?? "—"}`
                  }
                />
                {suggestion.contender ? (
                  <Row
                    label="Next operator"
                    value={`${suggestion.contender.dso} · ${formatKm(suggestion.contender.distanceM)}`}
                  />
                ) : null}
                <Row label="Source" value={suggestion.source} />
              </dl>

              <div className="border-t border-bg-border p-4">
                <span
                  className={`inline-block border px-2 py-1 text-[10px] font-semibold uppercase ${
                    CONFIDENCE_STYLE[suggestion.confidence] ?? ""
                  }`}
                >
                  {suggestion.confidence}
                </span>
                <p className="mt-2 text-[11px] leading-relaxed text-ink-400">
                  {suggestion.explanation}
                </p>
              </div>

              <div className="border-t border-bg-border bg-amber-300/5 p-4">
                <p className="text-[11px] font-semibold text-amber-200">
                  An admin must confirm before billing.
                </p>
                <p className="mt-1 text-[11px] leading-relaxed text-ink-400">
                  Billing applicability is{" "}
                  <code className="text-amber-200">{suggestion.billingApplicability}</code>. Billing
                  reads a versioned DSO rate record, never this map.
                  {needsManualConfirmation(suggestion)
                    ? " This location cannot be auto-accepted."
                    : ""}
                </p>
                <label className="mt-3 grid gap-1 text-[11px]">
                  <span className="text-ink-500">Override reason (disabled in this demo)</span>
                  <input
                    disabled
                    value={overrideReason}
                    onChange={(e) => setOverrideReason(e.target.value)}
                    placeholder="Recorded to the audit log in production"
                    className="w-full cursor-not-allowed border border-bg-border bg-bg-base/60 px-3 py-2 text-ink-500"
                  />
                </label>
              </div>
            </div>
          ) : (
            <div className="border border-dashed border-bg-border px-4 py-6 text-xs text-ink-500">
              Search and select an address to see its suggested distribution operator.
            </div>
          )}

          <p className="text-[10px] leading-relaxed text-ink-500">
            Overlay source: {DSO_SAMPLE_SOURCE_SERVICE}
          </p>
        </aside>
      </div>
    </main>
  );
}

function Row({
  label,
  value,
  hint,
  strong,
}: {
  label: string;
  value: string;
  hint?: string;
  strong?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-bg-border px-4 py-2 last:border-b-0">
      <dt className="text-ink-500">
        {label}
        {hint ? <span className="mt-0.5 block text-[10px] text-ink-500/70">{hint}</span> : null}
      </dt>
      <dd className={`text-right ${strong ? "font-semibold text-brand-300" : "text-ink-50"}`}>
        {value}
      </dd>
    </div>
  );
}
