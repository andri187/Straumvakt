"use client";

// Driver page — "Leysa inn boð" (redeem an invite). ADR 0028 host↔driver
// INVITE loop, driver side. The driver is already authenticated (bearer in
// localStorage); they paste the invite code/token they were given and we
// call POST /api/driver/redeem-invite to create the DriverGroupMembership.
//
// NOTE: a parallel task owns src/app/driver/driver-auth.ts — to avoid a
// merge conflict we DO NOT import from it. The bearer token + API base are
// inlined here using the same localStorage key + host→api map as driverFetch.

import { useState } from "react";

const TOKEN_KEY = "sv_driver_access";
const HOSTMAP: Record<string, string> = {
  "straumvakt.org": "https://api.straumvakt.org",
  "www.straumvakt.org": "https://api.straumvakt.org",
  "hlada-staging.straumvakt.workers.dev": "https://hlada-api-staging.straumvakt.workers.dev",
  "hlada.straumvakt.workers.dev": "https://hlada-api.straumvakt.workers.dev",
};

function apiBase(): string {
  if (typeof window === "undefined") return "";
  return HOSTMAP[window.location.hostname] ?? "";
}

type RedeemResult = {
  ok: true;
  driverGroupId: string;
  driverGroupDisplayName: string;
  installationDisplayName: string | null;
};

export default function DriverRedeem() {
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<RedeemResult | null>(null);

  // Accept either a bare code or a full "…/invite/<code>" link — extract the
  // trailing segment so the hash matches the server-stored token hash.
  function extractCode(raw: string): string {
    const s = raw.trim();
    const m = s.match(/\/invite\/([^/?#\s]+)/);
    return m ? m[1] : s;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const token = extractCode(code);
    if (!token) return;
    setSubmitting(true);
    setErr(null);
    setDone(null);
    try {
      const bearer =
        typeof window !== "undefined"
          ? window.localStorage.getItem(TOKEN_KEY)
          : null;
      const res = await fetch(`${apiBase()}/api/driver/redeem-invite`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
        },
        body: JSON.stringify({ token }),
      });
      const body = (await res.json().catch(() => null)) as
        | RedeemResult
        | { error?: string; message?: string }
        | null;
      if (!res.ok || !body || !("ok" in body)) {
        const eb = body as { error?: string; message?: string } | null;
        throw new Error(eb?.message || eb?.error || `HTTP ${res.status}`);
      }
      setDone(body);
      setCode("");
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : String(e2));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <div className="head">
        <div>
          <h1>Leysa inn boð</h1>
          <p>
            Sláðu inn boðskóðann sem hýsillinn sendi þér til að fá aðgang að
            hleðslustöðvunum þeirra.
          </p>
        </div>
      </div>

      {err && (
        <div
          className="card"
          style={{ padding: "14px 18px", marginBottom: 16, borderColor: "rgba(255,107,107,.4)", color: "var(--red)" }}
        >
          {err}
        </div>
      )}

      <div className="grid g2">
        <div className="card" style={{ alignSelf: "start" }}>
          <div className="card-h">Boðskóði</div>
          <div style={{ padding: 18 }}>
            {done ? (
              <div
                className="card"
                style={{ padding: 16, borderColor: "rgba(53,224,167,.45)" }}
              >
                <div style={{ fontWeight: 700, marginBottom: 6 }}>Aðgangur veittur ✓</div>
                <div className="sub">
                  Þú hefur nú aðgang að hópnum{" "}
                  <strong>{done.driverGroupDisplayName}</strong>
                  {done.installationDisplayName
                    ? ` (${done.installationDisplayName})`
                    : ""}
                  .
                </div>
                <button
                  type="button"
                  className="btn sm"
                  style={{ marginTop: 14 }}
                  onClick={() => setDone(null)}
                >
                  Leysa inn annað boð
                </button>
              </div>
            ) : (
              <form onSubmit={submit}>
                <div className="field">
                  <label htmlFor="code">Kóði eða hlekkur</label>
                  <input
                    id="code"
                    className="inp mono"
                    placeholder="t.d. abcd2345efgh…"
                    value={code}
                    onChange={(ev) => setCode(ev.target.value)}
                    required
                  />
                </div>
                <button
                  className="btn primary"
                  type="submit"
                  disabled={submitting || !code.trim()}
                >
                  {submitting ? "Leysi inn…" : "Leysa inn boð"}
                </button>
              </form>
            )}
          </div>
        </div>

        <div className="card" style={{ alignSelf: "start" }}>
          <div className="card-h">Hvernig virkar þetta?</div>
          <div style={{ padding: 18 }} className="sub">
            <p style={{ marginTop: 0 }}>
              Hýsillinn þinn (t.d. húsfélag eða vinnuveitandi) býr til boð og
              sendir þér kóða eða hlekk.
            </p>
            <p>
              Þegar þú leysir hann inn færðu aðgang að hleðslustöðvum þeirra og
              hleðslur þínar fara á réttan reikning.
            </p>
            <p style={{ marginBottom: 0 }}>
              Ef hlekkurinn inniheldur <span className="mono">/invite/&lt;kóði&gt;</span>{" "}
              dugar að líma allan hlekkinn eða bara kóðann hér.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
