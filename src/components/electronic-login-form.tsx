"use client";

import { FormEvent, useState } from "react";
import { useLanguage } from "@/components/language-provider";

export function ElectronicLoginForm() {
  const { language } = useLanguage();
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  function normalizePhone(value: string): string {
    return value.replace(/[^0-9+]/g, "");
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(
      language === "is"
        ? "Beiðni skráð. Rafræn innskráning með símanúmeri verður virk í næsta áfanga."
        : "Request recorded. Electronic sign-in by phone number will be enabled in Sprint 3 (Auðkenni).",
    );
  }

  return (
    <form className="mt-6 space-y-3" onSubmit={onSubmit}>
      <div>
        <label
          htmlFor="phone"
          className="mb-1 block text-sm font-medium text-ink-200"
        >
          {language === "is"
            ? "Símanúmer fyrir rafræna innskráningu"
            : "Phone number for electronic sign-in"}
        </label>
        <input
          id="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          value={phone}
          onChange={(e) => setPhone(normalizePhone(e.target.value))}
          placeholder="+354 6xx xxxx"
          className="w-full rounded-md border border-bg-border bg-bg-inset px-3 py-2 text-sm text-ink-50 outline-none placeholder:text-ink-400 focus:border-brand-500/50"
          required
        />
      </div>

      <button
        type="submit"
        className="w-full rounded-md bg-brand-500 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-400"
      >
        {language === "is"
          ? "Innskrá með rafrænum skilríkjum"
          : "Sign in with electronic ID"}
      </button>

      {message ? (
        <p className="rounded-md border border-bg-border bg-bg-inset px-3 py-2 text-xs text-ink-300">
          {message}
        </p>
      ) : null}
    </form>
  );
}
