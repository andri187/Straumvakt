import Link from "next/link";
import type { Route } from "next";
import { modelCards } from "@/lib/installations/oem-models";
import "./model-picker.css";

/**
 * Step 1 of Add installation: choose the charger model. A server component with no client JavaScript and no data access: the
 * list of switched-on OEMs is a deployment setting passed in by the page. An available card is a plain link into the direct
 * OEM flow; every other card is shown for orientation only (not focusable, not a link). Manual entry stays one clear step away.
 */
export function ModelPicker({ enabledVendors, manualHref }: { enabledVendors: readonly string[]; manualHref: string }) {
  const cards = modelCards(enabledVendors);
  const any = cards.some((c) => c.state === "available");
  return (
    <section className="mp" aria-labelledby="mp-h">
      <p className="mp-step">ADD INSTALLATION · 1 / 2</p>
      <h2 id="mp-h">Choose your charger</h2>
      {any ? null : (
        <p className="ws-note" role="status">
          Direct connection to an OEM account is not enabled for this deployment, so no model can be chosen here. Enter the installation by hand instead.
        </p>
      )}
      <ul className="mp-grid" aria-label="Charger models">
        {cards.map((c) => {
          const inner = (
            <>
              <span className="mp-status">{c.state === "available" ? "Available" : c.state === "not_enabled" ? "Not enabled here" : "Not available yet"}</span>
              {/* Decorative: the model is named in text. Explicit size keeps the layout still while images load. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/oem-models/${c.image}`} alt="" width={360} height={360} loading="lazy" decoding="async" />
              <span className="mp-brand">{c.brand}</span>
              <strong>{c.model}</strong>
              {c.state === "available" ? <span className="mp-arrow" aria-hidden="true">↗</span> : null}
            </>
          );
          return (
            <li key={c.id}>
              {c.href ? (
                <Link className="mp-card mp-on" href={c.href as Route} prefetch={false}>{inner}</Link>
              ) : (
                <div className="mp-card" aria-disabled="true">{inner}</div>
              )}
            </li>
          );
        })}
      </ul>
      <p className="mp-foot">More models will be enabled as their integrations are verified.</p>
      <div className="mp-manual">
        <span>Charger not listed, or no OEM account to connect?</span>
        <Link className="ws-button" href={manualHref as Route} prefetch={false}>Enter installation manually</Link>
      </div>
    </section>
  );
}
