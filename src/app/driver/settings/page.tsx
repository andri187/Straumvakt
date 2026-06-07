"use client";

// Stillingar — driver profile (read-only here). Name/password changes go via
// the host or the mobile app.

import { useDriverMe } from "../layout";

export default function DriverSettings() {
  const me = useDriverMe();
  return (
    <>
      <div className="head">
        <div>
          <h1>Stillingar</h1>
          <p>Upplýsingar um aðganginn þinn.</p>
        </div>
      </div>

      <div className="card" style={{ maxWidth: 560 }}>
        <div className="card-h">Prófíll</div>
        <div style={{ padding: "6px 18px 14px" }}>
          <Kv k="Nafn" v={me?.displayName} />
          <Kv k="Netfang" v={me?.email} />
          <Kv k="Tungumál" v={me?.locale ?? "—"} />
          <Kv k="Skráð hjá" v={me?.organizationName ?? "—"} />
        </div>
      </div>

      <p className="sub" style={{ marginTop: 14 }}>
        Til að breyta nafni eða lykilorði, hafðu samband við hýsilinn þinn eða
        notaðu Straumvakt appið.
      </p>
    </>
  );
}

function Kv({ k, v }: { k: string; v: string | null | undefined }) {
  return (
    <div className="kv">
      <span className="k">{k}</span>
      <span className="v">{v ?? "…"}</span>
    </div>
  );
}
