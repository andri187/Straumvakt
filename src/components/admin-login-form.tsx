"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { useLanguage } from "@/components/language-provider";
import { apiFetch } from "@/lib/api-client";

export function AdminLoginForm({ compact = false }: { compact?: boolean }) {
  const { language } = useLanguage();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await apiFetch("/api/admin/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const raw = await res.text();
      let data: { error?: string } = {};
      try {
        data = raw ? (JSON.parse(raw) as { error?: string }) : {};
      } catch {
        data = {
          error:
            raw ||
            (language === "is"
              ? "Óvænt svar frá innskráningu"
              : "Unexpected login response"),
        };
      }
      if (!res.ok) {
        setError(
          data.error ??
            (language === "is" ? "Innskráning mistókst" : "Login failed"),
        );
        return;
      }
      router.push("/dashboard");
      router.refresh();
    } catch {
      setError(
        language === "is"
          ? "Náði ekki sambandi við innskráningarþjónustu."
          : "Could not reach the login service.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <form
      className={compact ? "space-y-3" : "mt-6 space-y-4"}
      onSubmit={onSubmit}
    >
      <div>
        <label
          htmlFor="email"
          className="mb-1 block text-xs font-medium text-ink-200"
        >
          {language === "is" ? "Stjórnandanotandi" : "Admin user"}
        </label>
        <input
          id="email"
          type="text"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-md border border-bg-border bg-bg-inset px-3 py-2 text-sm text-ink-50 outline-none ring-0 placeholder:text-ink-400 focus:border-brand-500/50"
          placeholder="admin"
          required
        />
      </div>
      <div>
        <label
          htmlFor="password"
          className="mb-1 block text-xs font-medium text-ink-200"
        >
          {language === "is" ? "Lykilorð stjórnanda" : "Admin password"}
        </label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-md border border-bg-border bg-bg-inset px-3 py-2 text-sm text-ink-50 outline-none ring-0 placeholder:text-ink-400 focus:border-brand-500/50"
          placeholder={
            language === "is" ? "Sláðu inn lykilorð" : "Enter password"
          }
          required
        />
      </div>
      {error ? (
        <p className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-md bg-brand-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-400 disabled:cursor-not-allowed disabled:opacity-70"
      >
        {loading
          ? language === "is"
            ? "Skrái inn..."
            : "Signing in..."
          : language === "is"
            ? "Skrá inn sem stjórnandi"
            : "Sign in as admin"}
      </button>
    </form>
  );
}
