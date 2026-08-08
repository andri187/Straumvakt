"use client";

import { useState } from "react";
import { AdminLoginForm } from "@/components/admin-login-form";
import { ElectronicLoginForm } from "@/components/electronic-login-form";
import { useLanguage } from "@/components/language-provider";

export function LoginAuthSwitcher() {
  const { language } = useLanguage();
  // Default to email + password — the unified login that routes admin, host
  // and driver to their own view. Electronic (eID) stays as the alt toggle.
  const [adminMode, setAdminMode] = useState(true);

  return (
    <>
      <button
        type="button"
        onClick={() => setAdminMode((v) => !v)}
        className="absolute right-4 top-4 z-10 rounded-md border border-bg-border px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide text-ink-300 hover:bg-bg-raised hover:text-ink-50"
        aria-pressed={adminMode}
      >
        {adminMode
          ? language === "is"
            ? "Rafræn"
            : "Electronic"
          : language === "is"
            ? "Stjórnandi"
            : "Admin"}
      </button>

      <p className="mt-1 text-sm text-ink-300">
        {adminMode
          ? language === "is"
            ? "Skráðu þig inn með netfangi og lykilorði."
            : "Sign in with your email and password."
          : language === "is"
            ? "Skráðu símanúmer og staðfestu með íslenskum rafrænum skilríkjum."
            : "Enter a phone number and confirm with Icelandic electronic ID."}
      </p>

      {adminMode ? <AdminLoginForm /> : <ElectronicLoginForm />}

      <p className="mt-8 text-center text-xs text-ink-400">
        {adminMode
          ? language === "is"
            ? "Innskráning með rafrænum skilríkjum er aðgengileg efst til hægri."
            : "Electronic-ID sign-in is available in the top-right corner."
          : language === "is"
            ? "Innskráning með netfangi og lykilorði er aðgengileg efst til hægri."
            : "Email + password sign-in is available in the top-right corner."}
      </p>
    </>
  );
}
