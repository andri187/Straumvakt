"use client";

// Driver web login (ADR 0033) — bearer-token. On success the token is stored
// and we land on /driver. Charging stays in the mobile app; this is the
// management surface.

import { useState } from "react";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { driverLogin } from "../driver-auth";

export default function DriverLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await driverLogin(email.trim(), password);
      router.replace("/driver" as Route);
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : String(ex));
      setBusy(false);
    }
  }

  return (
    <div className="host-root">
      <div className="login-wrap">
        <form onSubmit={submit} className="card login-card" style={{ padding: 28 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
            <div style={{ width: 38, height: 38, borderRadius: 10, background: "linear-gradient(135deg,var(--green),var(--teal) 55%,var(--blue))", display: "grid", placeItems: "center", color: "#04121b", fontWeight: 900 }}>S</div>
            <div>
              <div className="sv-wordmark" style={{ fontWeight: 800 }}>Straumvakt</div>
              <div style={{ fontSize: 10, letterSpacing: ".22em", textTransform: "uppercase", color: "var(--sky)" }}>Ökumaður · Driver</div>
            </div>
          </div>
          <h2 style={{ margin: "0 0 4px", fontSize: 20 }}>Skrá inn</h2>
          <p className="sub" style={{ margin: "0 0 18px" }}>Ökumannagátt — yfirlit, saga og aðgangur.</p>

          <div className="field">
            <label>Netfang</label>
            <input className="inp" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="netfang@…" />
          </div>
          <div className="field">
            <label>Lykilorð</label>
            <input className="inp" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
          </div>

          {err && <div style={{ color: "var(--red)", fontSize: 13, marginBottom: 12 }}>{err}</div>}

          <button className="btn primary" type="submit" disabled={busy} style={{ width: "100%", justifyContent: "center", height: 46, marginTop: 2 }}>
            {busy ? "…" : "Skrá inn"}
          </button>
          <div className="sub" style={{ textAlign: "center", marginTop: 14 }}>
            Til að hefja hleðslu, notaðu Straumvakt appið.
          </div>
        </form>
      </div>
    </div>
  );
}
