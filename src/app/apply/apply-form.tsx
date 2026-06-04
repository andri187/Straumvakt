"use client";

// Public RFQ funnel — POSTs to /api/public/host-applications (no auth;
// the path is allow-listed in middleware.ts). On success we swap the
// whole form for a "we'll be in touch" confirmation. No mock data: the
// only state held is what the operator inbox will read back (Rule 6).

import { useState } from "react";
import { apiFetch } from "@/lib/api-client";
import type {
  HostApplicationSiteType,
} from "@straumvakt/shared/domain/host-applications";
import "./apply.css";

type SiteDraft = {
  address: string;
  estimatedChargers: string;
  estimatedDrivers: string;
};

const BLANK_SITE: SiteDraft = {
  address: "",
  estimatedChargers: "",
  estimatedDrivers: "",
};

const SITE_TYPE_LABELS: Record<HostApplicationSiteType, string> = {
  multi_dwelling: "Húsfélag / fjölbýli (multi-dwelling)",
  company: "Fyrirtæki / vinnustaður (company)",
};

export function ApplyForm() {
  const [companyName, setCompanyName] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [kennitala, setKennitala] = useState("");
  const [siteType, setSiteType] =
    useState<HostApplicationSiteType>("multi_dwelling");
  const [sites, setSites] = useState<SiteDraft[]>([{ ...BLANK_SITE }]);
  const [description, setDescription] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  function updateSite(index: number, patch: Partial<SiteDraft>) {
    setSites((prev) =>
      prev.map((s, i) => (i === index ? { ...s, ...patch } : s)),
    );
  }

  function addSite() {
    setSites((prev) => [...prev, { ...BLANK_SITE }]);
  }

  function removeSite(index: number) {
    setSites((prev) => prev.filter((_, i) => i !== index));
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    // Build the API body. Numbers come from text inputs; the API
    // validates min(1), so we coerce and let the server reject empties.
    const trimmedKennitala = kennitala.replace(/\D/g, "");
    const body = {
      companyName: companyName.trim(),
      contactName: contactName.trim(),
      contactEmail: contactEmail.trim(),
      contactPhone: contactPhone.trim() || undefined,
      kennitala: trimmedKennitala.length > 0 ? trimmedKennitala : undefined,
      siteType,
      sites: sites.map((s) => ({
        address: s.address.trim(),
        estimatedChargers: Number(s.estimatedChargers),
        estimatedDrivers: Number(s.estimatedDrivers),
      })),
      description: description.trim() || undefined,
    };

    setSubmitting(true);
    try {
      const res = await apiFetch("/api/public/host-applications", {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => null)) as
          | {
              error?: string;
              issues?: { path: (string | number)[]; message: string }[];
            }
          | null;
        const msg =
          b?.issues
            ?.map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; ") ||
          b?.error ||
          `HTTP ${res.status}`;
        throw new Error(msg);
      }
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="success" role="status" aria-live="polite">
        <div className="check" aria-hidden="true">
          ✓
        </div>
        <h1>Takk fyrir — we&apos;ll be in touch</h1>
        <p>
          Your application has reached the Straumvakt team. We review every
          enquiry and a team member will contact you at{" "}
          <strong>{contactEmail || "your email"}</strong> to discuss next
          steps for your charging network.
        </p>
        <p className="foot-hint">
          You can safely close this page. There&apos;s nothing else to do.
        </p>
      </div>
    );
  }

  const siteTypeNoun = siteType === "company" ? "site" : "building";

  return (
    <form onSubmit={onSubmit} noValidate>
      <fieldset>
        <legend>Organisation</legend>
        <label>
          <span>Company / association name *</span>
          <input
            type="text"
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            required
            maxLength={200}
            autoComplete="organization"
            placeholder="Húsfélagið Dalvegi 16 / Acme ehf."
          />
        </label>
        <label>
          <span>Kennitala (optional — we confirm this later)</span>
          <input
            type="text"
            value={kennitala}
            onChange={(e) => setKennitala(e.target.value)}
            inputMode="numeric"
            maxLength={11}
            placeholder="000000-0000"
          />
        </label>
        <label>
          <span>What kind of host are you? *</span>
          <select
            value={siteType}
            onChange={(e) =>
              setSiteType(e.target.value as HostApplicationSiteType)
            }
          >
            <option value="multi_dwelling">
              {SITE_TYPE_LABELS.multi_dwelling}
            </option>
            <option value="company">{SITE_TYPE_LABELS.company}</option>
          </select>
        </label>
      </fieldset>

      <fieldset>
        <legend>Contact</legend>
        <div className="grid-2">
          <label>
            <span>Contact name *</span>
            <input
              type="text"
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
              required
              maxLength={200}
              autoComplete="name"
            />
          </label>
          <label>
            <span>Phone (optional)</span>
            <input
              type="tel"
              value={contactPhone}
              onChange={(e) => setContactPhone(e.target.value)}
              maxLength={40}
              autoComplete="tel"
              placeholder="+354"
            />
          </label>
        </div>
        <label>
          <span>Email *</span>
          <input
            type="email"
            value={contactEmail}
            onChange={(e) => setContactEmail(e.target.value)}
            required
            maxLength={200}
            autoComplete="email"
          />
        </label>
      </fieldset>

      <fieldset>
        <legend>Sites &amp; charging</legend>
        {sites.map((site, i) => (
          <div className="site-card" key={i}>
            <div className="site-card-head">
              <h3>
                {siteType === "company" ? "Site" : "Building"} {i + 1}
              </h3>
              {sites.length > 1 && (
                <button
                  type="button"
                  className="link-button"
                  onClick={() => removeSite(i)}
                >
                  Remove
                </button>
              )}
            </div>
            <label>
              <span>Address *</span>
              <input
                type="text"
                value={site.address}
                onChange={(e) => updateSite(i, { address: e.target.value })}
                required
                maxLength={500}
                placeholder={`${
                  siteType === "company" ? "Site" : "Building"
                } address, postcode, city`}
              />
            </label>
            <div className="grid-2">
              <label>
                <span>Estimated chargers *</span>
                <input
                  type="number"
                  min={1}
                  max={100000}
                  value={site.estimatedChargers}
                  onChange={(e) =>
                    updateSite(i, { estimatedChargers: e.target.value })
                  }
                  required
                  inputMode="numeric"
                />
              </label>
              <label>
                <span>Estimated drivers *</span>
                <input
                  type="number"
                  min={1}
                  max={100000}
                  value={site.estimatedDrivers}
                  onChange={(e) =>
                    updateSite(i, { estimatedDrivers: e.target.value })
                  }
                  required
                  inputMode="numeric"
                />
              </label>
            </div>
          </div>
        ))}
        <button type="button" className="add-site" onClick={addSite}>
          + Add another {siteTypeNoun}
        </button>
      </fieldset>

      <fieldset>
        <legend>Anything else?</legend>
        <label>
          <span>
            Tell us about your network and any specific requirements
            (optional)
          </span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={4000}
            placeholder="Existing hardware, timeline, billing expectations, neighbour-sharing…"
          />
        </label>
      </fieldset>

      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}

      <button type="submit" className="button" disabled={submitting}>
        {submitting ? "Sending…" : "Submit application"}
      </button>
      <p className="foot-hint">
        We&apos;ll never share your details. Kennitala is confirmed formally
        only if we move forward together.
      </p>
    </form>
  );
}
