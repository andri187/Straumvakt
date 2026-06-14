"use client";

// Premium-feature preview gate — STAGING/DEV ONLY.
//
// A top-bar "Premium" toggle lets us demo features that will sit behind a
// paid entitlement (the real entitlement system is P-later). When ON, every
// <PremiumGate> / premium-aware widget shows; when OFF (the default), they
// hide. There is NO entitlement check yet, so premium features are simply
// hidden everywhere until the toggle is flipped.
//
// Environment gate: NEXT_PUBLIC_* aren't reliably inlined by the Cloudflare
// build runner (see api-client.ts), so we detect env by hostname — an
// ALLOWLIST of non-production hosts. Default = hidden, so the prod worker (or
// any unknown host) never shows the toggle and never previews premium.
//
// ⚠️ straumvakt.org currently serves the STAGING worker (going-public Option
// B). When straumvakt.org cuts over to the PROD worker (hlada), REMOVE
// "straumvakt.org" + "www.straumvakt.org" from this set so the Premium
// preview can never reach production.

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

const NON_PROD_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "hlada-staging.straumvakt.workers.dev",
  "straumvakt.org",
  "www.straumvakt.org",
]);

export function isPremiumPreviewEnv(): boolean {
  if (typeof window === "undefined") return false;
  return NON_PROD_HOSTS.has(window.location.hostname);
}

const STORAGE_KEY = "sv_premium_preview";

type PremiumState = {
  /** Is the staging/dev preview toggle available on this host at all? */
  available: boolean;
  /** Are premium features currently shown? (Always false on production.) */
  enabled: boolean;
  setEnabled: (v: boolean) => void;
};

const Ctx = createContext<PremiumState>({
  available: false,
  enabled: false,
  setEnabled: () => {},
});

export function PremiumProvider({ children }: { children: ReactNode }) {
  const [available, setAvailable] = useState(false);
  const [enabled, setEnabledState] = useState(false);

  useEffect(() => {
    const avail = isPremiumPreviewEnv();
    setAvailable(avail);
    if (avail) {
      try {
        setEnabledState(window.localStorage.getItem(STORAGE_KEY) === "1");
      } catch {
        /* localStorage unavailable — stay off */
      }
    }
  }, []);

  const setEnabled = (v: boolean) => {
    setEnabledState(v);
    try {
      window.localStorage.setItem(STORAGE_KEY, v ? "1" : "0");
    } catch {
      /* ignore */
    }
  };

  // enabled can only ever be true where the preview is available — so a
  // stale localStorage flag can't leak premium onto production.
  const value: PremiumState = { available, enabled: available && enabled, setEnabled };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePremium(): PremiumState {
  return useContext(Ctx);
}

/** Renders children only while a premium preview is active; nothing otherwise. */
export function PremiumGate({ children }: { children: ReactNode }) {
  const { enabled } = usePremium();
  return enabled ? <>{children}</> : null;
}

/** Top-bar toggle. Renders nothing on production (available === false). */
export function PremiumToggle() {
  const { available, enabled, setEnabled } = usePremium();
  if (!available) return null;
  return (
    <button
      type="button"
      onClick={() => setEnabled(!enabled)}
      title={
        enabled
          ? "Premium-eiginleikar sýnilegir (staging)"
          : "Sýna premium-eiginleika (staging)"
      }
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 10px",
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 700,
        cursor: "pointer",
        border: "1px solid " + (enabled ? "rgba(43,211,201,.6)" : "var(--border)"),
        background: enabled
          ? "linear-gradient(135deg,rgba(62,233,167,.18),rgba(43,182,232,.18))"
          : "transparent",
        color: enabled ? "var(--teal)" : "var(--muted)",
      }}
    >
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: 99,
          background: enabled ? "var(--green)" : "var(--muted)",
        }}
      />
      Premium
    </button>
  );
}
