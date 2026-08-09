"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ContractGate,
  MetricValue,
  ProductEmpty,
  ProductError,
  ProductLoading,
  StatusBadge,
} from "@/components/product-state";
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
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const secretRef = useRef<HTMLElement>(null);

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

  useEffect(() => {
    if (created) secretRef.current?.focus();
  }, [created]);

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
        <button
          className="org-button secondary"
          type="button"
          onClick={load}
          disabled={loading}
          aria-busy={loading}
        >
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </section>

      {error ? <ProductError message={error} onRetry={load} /> : null}

      <div className="org-grid g4" style={{ marginBottom: 14 }}>
        <MetricValue label="Chargers" value={chargers.length} loading={loading} />
        <MetricValue
          label="Online"
          value={online}
          loading={loading}
          tone="accent"
        />
        <MetricValue
          label="Installations"
          value={installations.length}
          loading={loading}
        />
        <MetricValue
          label="Credentials missing"
          value={missingCredentials}
          loading={loading}
          tone={missingCredentials > 0 ? "warning" : "default"}
        />
      </div>

      {created ? (
        <section
          className="org-secret"
          aria-live="polite"
          aria-label="One-time OCPP credential"
          ref={secretRef}
          tabIndex={-1}
        >
          <div>
            <strong>Copy this OCPP password now</strong>
            <p>
              It is returned once for {created.identityString}. Straumvakt
              stores only its hash and cannot retrieve it later.
            </p>
          </div>
          <code>{created.ocppPassword}</code>
          <div className="org-secret-actions">
            <button
              type="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(created.ocppPassword);
                  setCopied(true);
                  setCopyError(false);
                } catch {
                  setCopyError(true);
                }
              }}
            >
              {copied ? "Copied" : "Copy password"}
            </button>
            <button
              type="button"
              onClick={() => {
                setCreated(null);
                setCopied(false);
                setCopyError(false);
              }}
            >
              I have stored it
            </button>
          </div>
          {copyError ? (
            <span role="alert">Copy failed. Select the password manually.</span>
          ) : null}
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
              <caption className="org-sr-only">
                Chargers registered to {org.displayName}
              </caption>
              <thead>
                <tr>
                  <th scope="col">Identity</th>
                  <th scope="col">Installation</th>
                  <th scope="col">Hardware</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td className="empty" colSpan={4}>
                      <ProductLoading label="Loading charger inventory" />
                    </td>
                  </tr>
                ) : chargers.length === 0 ? (
                  <tr>
                    <td className="empty" colSpan={4}>
                      <ProductEmpty
                        title="No chargers registered"
                        detail="Add a charger after a site is available."
                      />
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
                        <StatusBadge
                          label={charger.online ? "Online" : "Offline"}
                          tone={charger.online ? "ok" : "mut"}
                        />
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

      <ContractGate
        id="driver-visibility"
        eyebrow="Driver visibility"
        title="Visibility is not the same as site classification"
        detail="Site access can be public, private or taxi-only, but driver charger access is currently derived from agreements and group membership. A persisted driver visibility contract is required."
        action="Configure visibility"
      />
    </>
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
          <div className="org-inline-warning" id="site-required-note" role="status">
            A site must exist before a charger can be added.
          </div>
        ) : null}
        <label>
          Site
          <select
            required
            aria-describedby={sites.length === 0 ? "site-required-note" : undefined}
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
            disabled={!siteId}
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
              min="0.1"
              step="0.1"
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
            autoComplete="off"
            aria-describedby="ocpp-identity-hint"
            value={identity}
            onChange={(event) => setIdentity(event.target.value)}
          />
        </label>
        <p className="org-form-note" id="ocpp-identity-hint">
          Creating a charger writes the station, EVSE, connector and OCPP
          identity in one transaction. Do not submit twice after an uncertain
          response.
        </p>
        {error ? (
          <div className="org-inline-error" role="alert">
            {error} The form was not retried automatically.
          </div>
        ) : null}
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
