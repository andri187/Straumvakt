"use client";
// Sprint 8.4.5 — client-side polling for the technical-read panels.
//
// Why: volatile fields (signal, comm, op mode, online, power, phase
// V/A, temp, uptime) live in Zaptec's per-charger /state response.
// The cron writes status + lastSeenAt every */5 but doesn't refresh
// the UI's full read; static fields (serial, FW, OCPP config) come
// from /api/chargers/{id} (detail) which doesn't need refreshing.
//
// This module owns a single poller per page render (one HTTP fetch
// every POLL_MS regardless of how many panels mount). State is
// shared via Context so <TechnicalReadPillsLive> and
// <TechnicalReadDetailLive> can sit in different parts of the page
// tree without doubling the API load.
//
// Visibility: paused when the tab is hidden (no point burning Zaptec
// calls when nobody's looking). Resumes immediately on visibilitychange.

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { apiFetch } from "@/lib/api-client";
import type { ChargerTechnicalRead } from "@straumvakt/shared/domain/charger-technical-read";
import { TechnicalReadPills, TechnicalReadDetail } from "./technical-read-panel";

const POLL_MS = 30_000;

const Ctx = createContext<ChargerTechnicalRead | null>(null);

export function TechnicalReadProvider({
  chargingStationId,
  initial,
  children,
}: {
  chargingStationId: string;
  initial: ChargerTechnicalRead | null;
  children: ReactNode;
}) {
  const [read, setRead] = useState<ChargerTechnicalRead | null>(initial);
  const inFlight = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      if (cancelled || inFlight.current) return;
      // Skip the fetch if the tab is hidden but keep the timer running
      // so we resume promptly once the operator comes back.
      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
        timer = setTimeout(tick, POLL_MS);
        return;
      }
      inFlight.current = true;
      try {
        const res = await apiFetch(`/api/admin/chargers/${chargingStationId}/technical-read`);
        if (res.ok && !cancelled) {
          const json = (await res.json()) as { technicalRead: ChargerTechnicalRead };
          setRead(json.technicalRead);
        }
      } catch {
        // Network blip — keep last-known state, the next tick will retry.
      } finally {
        inFlight.current = false;
        if (!cancelled) timer = setTimeout(tick, POLL_MS);
      }
    };

    timer = setTimeout(tick, POLL_MS);

    const onVisChange = () => {
      if (document.visibilityState === "visible" && !inFlight.current) {
        if (timer) clearTimeout(timer);
        tick();
      }
    };
    document.addEventListener("visibilitychange", onVisChange);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisChange);
    };
  }, [chargingStationId]);

  return <Ctx.Provider value={read}>{children}</Ctx.Provider>;
}

export function TechnicalReadPillsLive({
  firmwareFromBoot,
}: {
  firmwareFromBoot: string | null;
}) {
  const read = useContext(Ctx);
  return <TechnicalReadPills read={read} firmwareFromBoot={firmwareFromBoot} />;
}

export function TechnicalReadDetailLive() {
  const read = useContext(Ctx);
  return <TechnicalReadDetail read={read} />;
}
