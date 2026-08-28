"use client";

import { useEffect, useRef, useState } from "react";
import type { StateObservation } from "@/lib/zaptec";

const MAX_SAMPLES = 60; // ~5 min at 5s interval

export type PolledState = {
  current: Map<number, StateObservation>;
  // history per StateId: array of (ts, numericValue) pairs, newest at end
  series: Map<number, Array<{ t: number; v: number }>>;
  lastUpdate: number;
  error: string | null;
};

function numericValue(s: StateObservation | undefined): number | null {
  if (!s?.ValueAsString) return null;
  const n = Number(s.ValueAsString);
  return Number.isFinite(n) ? n : null;
}

export function usePolledState(
  chargerId: string,
  initial: StateObservation[],
  intervalMs = 5000,
): PolledState {
  const [state, setState] = useState<PolledState>(() => {
    const current = new Map<number, StateObservation>();
    for (const s of initial) current.set(s.StateId, s);
    const series = new Map<number, Array<{ t: number; v: number }>>();
    const now = Date.now();
    for (const s of initial) {
      const n = numericValue(s);
      if (n != null) series.set(s.StateId, [{ t: now, v: n }]);
    }
    return { current, series, lastUpdate: now, error: null };
  });

  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;

    async function tick() {
      try {
        const res = await fetch(`/api/zaptec/chargers/${chargerId}/state`, {
          cache: "no-store",
        });
        if (!aliveRef.current) return;
        if (!res.ok) {
          setState((prev) => ({ ...prev, error: `HTTP ${res.status}` }));
          return;
        }
        const { state: next } = (await res.json()) as {
          state: StateObservation[];
        };
        if (!aliveRef.current) return;

        const now = Date.now();
        setState((prev) => {
          const current = new Map(prev.current);
          const series = new Map(prev.series);
          for (const s of next) {
            current.set(s.StateId, s);
            const n = numericValue(s);
            if (n != null) {
              const list = series.get(s.StateId) ?? [];
              list.push({ t: now, v: n });
              while (list.length > MAX_SAMPLES) list.shift();
              series.set(s.StateId, list);
            }
          }
          return { current, series, lastUpdate: now, error: null };
        });
      } catch (e) {
        if (!aliveRef.current) return;
        setState((prev) => ({
          ...prev,
          error: e instanceof Error ? e.message : String(e),
        }));
      }
    }

    const h = setInterval(tick, intervalMs);
    return () => {
      aliveRef.current = false;
      clearInterval(h);
    };
  }, [chargerId, intervalMs]);

  return state;
}
