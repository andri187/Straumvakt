"use client";

// Stillingar — mirrors the Straumvakt mobile app's settings IA: a profile
// card plus grouped sections (Aðgangur & auðkenni / Greiðslur / Appið / Annað).
// Items that have a web page link through; not-yet-built ones are marked
// "soon" (same convention as the sidebar). NFC tap-to-charge is mobile-only
// and intentionally absent here.

import Link from "next/link";
import type { Route } from "next";
import type { CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { useDriverMe } from "../layout";
import { clearDriverToken } from "../driver-auth";

const ROW: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "12px 18px",
  borderTop: "1px solid var(--line, rgba(255,255,255,0.08))",
  color: "var(--soft, #e7eef5)",
  fontWeight: 600,
  fontSize: 14,
  textDecoration: "none",
  width: "100%",
  background: "none",
  border: "none",
  borderTopWidth: 1,
  borderTopStyle: "solid",
  textAlign: "left",
  cursor: "pointer",
};

function NavRow({
  label,
  href,
  soon,
}: {
  label: string;
  href?: Route;
  soon?: boolean;
}) {
  const inner = (
    <>
      <span style={{ flex: 1 }}>{label}</span>
      {soon ? (
        <span className="tag soon solo">soon</span>
      ) : (
        <span style={{ color: "var(--muted, #8aa)", fontSize: 18 }}>›</span>
      )}
    </>
  );
  if (href && !soon) {
    return (
      <Link href={href} style={ROW}>
        {inner}
      </Link>
    );
  }
  return <div style={{ ...ROW, opacity: soon ? 0.6 : 1, cursor: "default" }}>{inner}</div>;
}

function ValueRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ ...ROW, cursor: "default" }}>
      <span style={{ flex: 1 }}>{label}</span>
      <span style={{ color: "var(--muted, #8aa)", fontWeight: 700 }}>{value}</span>
    </div>
  );
}

function langLabel(locale: string | null | undefined): string {
  if (!locale) return "Íslenska";
  return locale.toLowerCase().startsWith("en") ? "English" : "Íslenska";
}

export default function DriverSettings() {
  const me = useDriverMe();
  const router = useRouter();

  function logout() {
    clearDriverToken();
    router.replace("/driver/login" as Route);
  }

  return (
    <>
      <div className="head">
        <div>
          <h1>Stillingar</h1>
          <p>Aðgangur, auðkenni og greiðslur.</p>
        </div>
      </div>

      <div className="card" style={{ maxWidth: 560 }}>
        <div className="card-h">Prófíll</div>
        <div style={{ padding: "6px 18px 14px" }}>
          <Kv k="Nafn" v={me?.displayName} />
          <Kv k="Netfang" v={me?.email} />
          <Kv k="Skráð hjá" v={me?.organizationName ?? "—"} />
        </div>
      </div>

      <div className="card" style={{ maxWidth: 560, marginTop: 14 }}>
        <div className="card-h">Aðgangur & auðkenni</div>
        <NavRow label="Mínir aðgangar" href={"/driver/access" as Route} />
        <NavRow label="Leysa inn boð" href={"/driver/redeem" as Route} />
        <NavRow label="RFID-lyklar" soon />
        <NavRow label="Fjölskylda" soon />
      </div>

      <div className="card" style={{ maxWidth: 560, marginTop: 14 }}>
        <div className="card-h">Greiðslur</div>
        <NavRow label="Greiðslusaga" href={"/driver/cost" as Route} />
        <NavRow label="Greiðsluskilmálar" soon />
      </div>

      <div className="card" style={{ maxWidth: 560, marginTop: 14 }}>
        <div className="card-h">Appið</div>
        <ValueRow label="Tungumál" value={langLabel(me?.locale)} />
      </div>

      <div className="card" style={{ maxWidth: 560, marginTop: 14 }}>
        <div className="card-h">Annað</div>
        <NavRow label="Aðstoð" soon />
        <button type="button" onClick={logout} style={{ ...ROW, color: "var(--bad, #ff6b6b)" }}>
          <span style={{ flex: 1 }}>Útskrá</span>
        </button>
      </div>

      <p className="sub" style={{ marginTop: 14, maxWidth: 560 }}>
        Til að breyta nafni eða lykilorði, hafðu samband við hýsilinn þinn eða
        notaðu Straumvakt appið. Snertilaust (NFC) er aðeins í appinu.
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
