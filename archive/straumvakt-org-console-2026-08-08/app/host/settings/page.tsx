"use client";

// Host settings — N1 ehf org profile (read-only; profile edits are an
// operator action per ADR 0027). Concept look, live data via /orgs/:id.

import { useEffect, useState } from "react";
import { apiFetchJson } from "@/lib/api-client";
import { useHostOrg } from "../host-shell";

type Address = { street: string; postalCode: string; city: string } | null;
type Org = {
  id: string;
  displayName: string;
  kind: string | null;
  kennitala: string | null;
  legalName: string | null;
  legalForm: string | null;
  vskNr: string | null;
  defaultCurrency: string | null;
  countryCode: string | null;
  postalAddress: Address;
  roles: string[];
  status: string;
  mainContact: { displayName: string; email: string } | null;
};

export default function HostSettings() {
  const org = useHostOrg();
  const [data, setData] = useState<Org | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!org) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await apiFetchJson<{ org: Org }>(
          `/api/admin/orgs/${org.orgId}`,
        );
        if (!cancelled) setData(r.org);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [org]);

  const kindLabel =
    data?.kind === "company"
      ? "Fyrirtæki"
      : data?.kind === "multi_dwelling"
        ? "Fjölbýli (HOA)"
        : "—";
  const addr = data?.postalAddress
    ? `${data.postalAddress.street}, ${data.postalAddress.postalCode} ${data.postalAddress.city}`
    : "—";

  return (
    <>
      <div className="head">
        <div>
          <h1>Stillingar</h1>
          <p>
            Upplýsingar um hýsilinn. Breytingar á skráningu eru í höndum
            Straumvaktar.
          </p>
        </div>
      </div>

      {err && (
        <div
          className="card"
          style={{
            padding: "14px 18px",
            marginBottom: 16,
            borderColor: "rgba(255,107,107,.4)",
            color: "var(--red)",
          }}
        >
          {err}
        </div>
      )}

      <div className="grid g2">
        <div className="card">
          <div className="card-h">Fyrirtæki</div>
          <div style={{ padding: "6px 18px 14px" }}>
            <Kv k="Nafn" v={data?.displayName} />
            <Kv k="Lögheiti" v={data?.legalName ?? data?.displayName} />
            <Kv k="Kennitala" v={data?.kennitala ?? "—"} />
            <Kv k="Tegund" v={data ? kindLabel : undefined} />
            <Kv k="Rekstrarform" v={data?.legalForm ?? "—"} />
            <Kv k="VSK-nr." v={data?.vskNr ?? "—"} />
            <Kv k="Gjaldmiðill" v={data?.defaultCurrency ?? "—"} />
            <Kv k="Heimilisfang" v={data ? addr : undefined} />
            <Kv
              k="Hlutverk"
              v={data ? data.roles.join(", ") || "—" : undefined}
            />
          </div>
        </div>

        <div style={{ display: "grid", gap: 16, alignContent: "start" }}>
          <div className="card">
            <div className="card-h">Tengiliður</div>
            <div style={{ padding: "6px 18px 14px" }}>
              <Kv
                k="Aðaltengiliður"
                v={data?.mainContact?.displayName ?? "—"}
              />
              <Kv k="Netfang" v={data?.mainContact?.email ?? "—"} />
            </div>
          </div>

          <div className="card" style={{ padding: 18 }}>
            <div className="card-h" style={{ border: 0, padding: "0 0 12px" }}>
              Samningur við Straumvakt
            </div>
            <div className="gate">
              <span className="lock">🔒</span>
              <div>
                Kostnaðarþættir (þjónustugjald, gjald á stöð, verð á orku) voru{" "}
                <b>ákveðnir við stofnun</b> og gilda áfram. Nýjar stöðvar falla
                undir sama samning — Straumvakt virkjar þær og þá opnast
                hleðsla.
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function Kv({ k, v }: { k: string; v: string | undefined }) {
  return (
    <div className="kv">
      <span className="k">{k}</span>
      <span className="v">{v === undefined ? "…" : v}</span>
    </div>
  );
}
