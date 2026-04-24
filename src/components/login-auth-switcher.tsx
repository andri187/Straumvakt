"use client";

import { useState } from "react";
import { AdminLoginForm } from "@/components/admin-login-form";
import { ElectronicLoginForm } from "@/components/electronic-login-form";
import { useLanguage } from "@/components/language-provider";

export function LoginAuthSwitcher() {
  const { language } = useLanguage();
  const [adminMode, setAdminMode] = useState(false);

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
            ? "Skráðu þig inn sem stjórnandi með notandanafni og lykilorði."
            : "Sign in as an administrator with username and password."
          : language === "is"
            ? "Skráðu símanúmer og staðfestu með íslenskum rafrænum skilríkjum."
            : "Enter a phone number and confirm with Icelandic electronic ID."}
      </p>

      {adminMode ? <AdminLoginForm /> : <ElectronicLoginForm />}

      <p className="mt-8 text-center text-xs text-ink-400">
        {adminMode
          ? language === "is"
            ? "Smelltu á Rafræn efst til hægri til að fara aftur í símanúmers-innskráningu."
            : "Click Electronic in the top-right corner to return to phone-number sign-in."
          : language === "is"
            ? "Stjórnandainnskráning er aðgengileg með litla hnappnum efst til hægri."
            : "Admin sign-in is available from the small button in the top-right corner."}
      </p>
    </>
  );
}
