"use client";

// Host "Hleðslulota" — full read-only detail for one session under the
// host's org. Live via GET /api/admin/orgs/:id/sessions/:sessionId
// (billing.read + org-scoped; 404 for cross-tenant sessions). Renders the
// shared SessionDetailView.

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import type { Route } from "next";
import { apiFetchJson } from "@/lib/api-client";
import { useHostOrg } from "../../host-shell";
import {
  SessionDetailView,
  type SessionDetail,
} from "@/components/session-detail-view";

export default function HostSessionDetail() {
  const org = useHostOrg();
  const params = useParams();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!org || !id) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await apiFetchJson<{ session: SessionDetail }>(
          `/api/admin/orgs/${org.orgId}/sessions/${id}`,
        );
        if (!cancelled) setDetail(r.session);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [org, id]);

  return (
    <>
      <div className="head">
        <div>
          <h1>Hleðslulota</h1>
          <p>
            <Link href={"/host" as Route}>← Til baka</Link>
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
