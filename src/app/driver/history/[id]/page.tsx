"use client";

// Driver "Hleðslulota" — full read-only detail for one of the driver's own
// sessions. Live via GET /api/driver/sessions/:id (driver-scoped; 404 for
// any session that isn't theirs). Renders the shared SessionDetailView.

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import type { Route } from "next";
import { driverFetch, DriverAuthError } from "../../driver-auth";
import {
  SessionDetailView,
  type SessionDetail,
} from "@/components/session-detail-view";

export default function DriverSessionDetail() {
  const params = useParams();
  const router = useRouter();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await driverFetch<{ session: SessionDetail }>(
          "/api/driver/sessions/" + id,
        );
        if (!cancelled) setDetail(r.session);
      } catch (e) {
        if (cancelled) return;
        if (e instanceof DriverAuthError) {
          router.replace("/driver/login" as Route);
          return;
        }
        setErr(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, router]);

  return (
    <>
      <div className="head">
        <div>
          <h1>Hleðslulota</h1>
          <p>
            <Link href={"/driver/history" as Route}>← Til baka</Link>
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

      {!detail && !err && (
        <div className="card">
          <div className="empty">Hleð…</div>
        </div>
      )}

      {detail && <SessionDetailView detail={detail} />}
    </>
  );
}
