"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetchJson } from "@/lib/api-client";
import { useOrg } from "../org-shell";

type Site = {
  id: string;
  orgId: string;
  displayName: string;
  accessLevel: string;
  provisioningStatus: string;
};

type Installation = {
  id: string;
  orgId: string;
  siteId: string;
  displayName: string;
  onboardingStatus: string;
  credentialsRef: string | null;
};

type Charger = {
  chargingStationId: string;
  identityString?: string | null;
  installationDisplayName?: string | null;
  vendor?: string | null;
  model?: string | null;
  serialNumber?: string | null;
  online?: boolean;
};

type CreatedCharger = {
  identityString: string;
  ocppPassword: string;
  note: string;
};

export default function OrgChargersPage() {
  const { org } = useOrg();
  const [sites, setSites] = useState<Site[]>([]);
  const [installations, setInstallations] = useState<Installation[]>([]);
  const [chargers, setChargers] = useState<Charger[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedCharger | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [siteBody, installationBody, chargerBody] = await Promise.all([
        apiFetchJson<{ sites: Site[] }>("/api/admin/sites"),
        apiFetchJson<{ installations: Installation[] }>(
          "/api/admin/installations",
        ),
        apiFetchJson<{ chargers: Charger[] }>(
          `/api/admin/orgs/${org.id}/chargers`,
        ),
      ]);
      setSites(siteBody.sites.filter((site) => site.orgId === org.id));
      setInstallations(
        installationBody.installations.filter(
          (installation) => installation.orgId === org.id,
        ),
      );
      setChargers(chargerBody.chargers);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  }, [org.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const online = chargers.filter((charger) => charger.online).length;
  const missingCredentials = installations.filter(
    (installation) => !installation.credentialsRef,
  ).length;

  return (
    <>
      <section className="org-page-head">
        <div>
          <div className="org-eyebrow">Infrastructure</div>
          <h1>Chargers</h1>
          <p>Tenant-scoped inventory and OCPP onboarding.</p>
        </div>
        <button className="org-button secondary" type="button" onClick={load}>
          Refresh
        </button>
      </section>

      {error ? <div className="org-error">{error}</div> : null}

      <div className="org-grid g4" style={{ marginBottom: 14 }}>
        <Metric label="Chargers" value={loading ? null : chargers.length} />
        <Metric label="Online" value={loading ? null : online} accent />
        <Metric
          label="Installations"
          value={loading ? null : installations.length}
        />
        <Metric
          label="Credentials missing"
          value={loading ? null : missingCredentials}
          warning={missingCredentials > 0}
        />
      </div>

      {created ? (
        <section className="org-secret" aria-live="polite">
          <div>
            <strong>Copy this OCPP password now</strong>
            <p>
              It is returned once for {created.identityString}. Straumvakt
              stores only its hash and cannot retrieve it later.
            </p>
          </div>
          <code>{created.ocppPassword}</code>
          <button type="button" onClick={() => setCreated(null)}>
            I have stored it
          </button>
        </section>
      ) : null}

      <div className="org-grid g2 org-align-start">
        <section className="org-card">
          <div className="org-card-h">
            Fleet inventory
            <span className="sub">{chargers.length} stations</span>
          </div>
          <div className="org-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Identity</th>
                  <th>Installation</th>
                  <th>Hardware</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td className="empty" colSpan={4}>
                      Loading...
                    </td>
                  </tr>
                ) : chargers.length === 0 ? (
                  <tr>
                    <td className="empty" colSpan={4}>
                      No chargers registered.
                    </td>
                  </tr>
                ) : (
                  chargers.map((charger) => (
                    <tr key={charger.chargingStationId}>
                      <td className="mono">
                        {charger.identityString ?? charger.chargingStationId}
                      </td>
                      <td>{charger.installationDisplayName ?? "Unassigned"}</td>
                      <td>
                        {[charger.vendor, charger.model]
                          .filter(Boolean)
                          .join(" ") || "Unknown"}
                        {charger.serialNumber ? (
                          <div className="org-cell-sub">
                            {charger.serialNumber}
                          </div>
                        ) : null}
                      </td>
                      <td>
                        <span
                          className={`org-badge ${charger.online ? "ok" : "mut"}`}
                        >
                          <span className="dot" />
                          {charger.online ? "Online" : "Offline"}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <ChargerCreateForm
          orgId={org.id}
          sites={sites}
          installations={installations}
          onCreated={(result) => {
            setCreated(result);
            void load();
          }}
        />
      </div>

      <section className="org-blocked-panel">
        <div>
          <div className="org-eyebrow">Driver visibility</div>
          <h2>Visibility is not the same as site classification</h2>
          <p>
            Site access can be public, private or taxi-only, but driver charger
            access is currently derived from agreements and group membership.
          </p>
        </div>
        <button type="button" disabled>
          Configure visibility
        </button>
      </section>
    </>
  );
}

function Metric({
  label,
  value,
  accent = false,
  warning = false,
}: {
  label: string;
  value: number | null;
  accent?: boolean;
  warning?: boolean;
}) {
  return (
    <div className="org-card org-kpi">
      <div className="lbl">{label}</div>
      <div
        className={`val${accent ? " accent" : ""}${warning ? " warning" : ""}`}
      >
        {value ?? "-"}
      </div>
    </div>
  );
}

function ChargerCreateForm({
  orgId,
  sites,
  installations,
  onCreated,
}: {
  orgId: string;
  sites: Site[];
  installations: Installation[];
  onCreated: (created: CreatedCharger) => void;
}) {
  const [siteId, setSiteId] = useState("");
  const [installationId, setInstallationId] = useState("");
  const [vendor, setVendor] = useState("");
  const [model, setModel] = useState("");
  const [serial, setSerial] = useState("");
  const [identity, setIdentity] = useState("");
  const [power, setPower] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const compatibleInstallations = useMemo(
    () =>
      installations.filter(
        (installation) => !siteId || installation.siteId === siteId,
      ),
    [installations, siteId],
  );

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await apiFetchJson<CreatedCharger>("/api/admin/chargers", {
        method: "POST",
        body: JSON.stringify({
          orgId,
          siteId,
          ...(installationId ? { installationId } : {}),
          stationVendor: vendor.trim(),
          stationModel: model.trim(),
          stationSerialNumber: serial.trim(),
          identityString: identity.trim(),
          evseIndex: 1,
          connectorIndex: 1,
          connectorType: "Type2",
          ocppVersion: "ocpp_1_6",
          assetClass: "ac",
          ...(power
            ? {
                evseMaxPowerKw: Number(power),
                connectorMaxPowerKw: Number(power),
              }
            : {}),
        }),
      });
      onCreated(result);
      setSerial("");
      setIdentity("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="org-card">
      <div className="org-card-h">
        Add charger <span className="sub">existing site</span>
      </div>
      <form className="org-form" onSubmit={submit}>
        {sites.length === 0 ? (
          <div className="org-inline-warning">
            A site must exist before a charger can be added.
          </div>
        ) : null}
        <label>
          Site
          <select
            required
            value={siteId}
            onChange={(event) => {
              setSiteId(event.target.value);
              setInstallationId("");
            }}
          >
            <option value="">Select site</option>
            {sites.map((site) => (
              <option key={site.id} value={site.id}>
                {site.displayName}
              </option>
            ))}
          </select>
        </label>
        <label>
          Installation
          <select
            value={installationId}
            onChange={(event) => setInstallationId(event.target.value)}
          >
            <option value="">No installation assignment</option>
            {compatibleInstallations.map((installation) => (
              <option key={installation.id} value={installation.id}>
                {installation.displayName}
              </option>
            ))}
          </select>
        </label>
        <div className="org-form-grid">
          <label>
            Vendor
            <input
              required
              value={vendor}
              onChange={(event) => setVendor(event.target.value)}
            />
          </label>
          <label>
            Model
            <input
              required
              value={model}
              onChange={(event) => setModel(event.target.value)}
            />
          </label>
          <label>
            Serial number
            <input
              required
              value={serial}
              onChange={(event) => setSerial(event.target.value)}
            />
          </label>
          <label>
            Max power kW
            <input
              inputMode="decimal"
              value={power}
              onChange={(event) => setPower(event.target.value)}
            />
          </label>
        </div>
        <label>
          OCPP identity
          <input
            required
            pattern="[A-Za-z0-9._:-]{3,64}"
            value={identity}
            onChange={(event) => setIdentity(event.target.value)}
          />
        </label>
        <p className="org-form-note">
          Creating a charger writes the station, EVSE, connector and OCPP
          identity in one transaction. Do not submit twice after an uncertain
          response.
        </p>
        {error ? <div className="org-inline-error">{error}</div> : null}
        <button
          className="org-button"
          type="submit"
          disabled={busy || sites.length === 0}
        >
          {busy ? "Creating..." : "Create charger"}
        </button>
      </form>
    </section>
  );
}
