"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-client";
import { lookupPostalCode } from "@/lib/reference/iceland-postal-codes";
import type { IdTokenSummary, UserSummary } from "@straumvakt/shared/domain/users";

type Audience = "operator" | "driver" | "service";

export function CreateUserForm() {
  const router = useRouter();
  // Result state — when set, the form is replaced with a confirmation
  // screen showing the auto-minted RFID UID. The operator copies it
  // (or programs a card with it) before continuing.
  const [created, setCreated] = useState<
    { user: UserSummary; primaryToken: IdTokenSummary } | null
  >(null);
  const [copyState, setCopyState] = useState<"idle" | "copied">("idle");

  // Identity
  const [email, setEmail] = useState("");
  const [audience, setAudience] = useState<Audience>("operator");
  const [displayName, setDisplayName] = useState("");
  const [kennitala, setKennitala] = useState("");

  // Name parts
  const [firstName, setFirstName] = useState("");
  const [middleName, setMiddleName] = useState("");
  const [lastName, setLastName] = useState("");

  // Contact
  const [phone, setPhone] = useState("");
  const [locale, setLocale] = useState("is");
  const [timezone, setTimezone] = useState("Atlantic/Reykjavik");

  // Personal
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [photoUrl, setPhotoUrl] = useState("");

  // Address
  const [addrStreet, setAddrStreet] = useState("");
  const [addrPostal, setAddrPostal] = useState("");
  const [addrCity, setAddrCity] = useState("");
  const [addrCountry, setAddrCountry] = useState("IS");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Auto-fill city from Iceland postal code (matches the org form
  // behaviour). Operator can override after auto-fill.
  function setPostal(value: string) {
    setAddrPostal(value);
    const looked = lookupPostalCode(value);
    if (looked) setAddrCity(looked.city);
  }

  // displayName auto-fill from name parts. Operator types
  // "First Last", that becomes the displayName unless they've
  // typed something different.
  function nameTouched() {
    if (displayName.length > 0) return;
    const parts = [firstName, middleName, lastName].filter(Boolean);
    if (parts.length > 0) setDisplayName(parts.join(" "));
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const address =
        addrStreet || addrPostal || addrCity
          ? {
              street: addrStreet || undefined,
              postalCode: addrPostal || undefined,
              city: addrCity || undefined,
              countryCode: addrCountry || undefined,
            }
          : undefined;
      const submitBody = {
        email,
        audience,
        displayName: displayName || undefined,
        firstName: firstName || undefined,
        middleName: middleName || undefined,
        lastName: lastName || undefined,
        kennitala: kennitala || undefined,
        phone: phone || undefined,
        locale,
        timezone,
        dateOfBirth: dateOfBirth || undefined,
        photoUrl: photoUrl || undefined,
        address,
      };
      const res = await apiFetch("/api/admin/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(submitBody),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => null)) as
          | {
              error?: string;
              issues?: { path: (string | number)[]; message: string }[];
            }
          | null;
        const msg =
          b?.issues
            ?.map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; ") ||
          b?.error ||
          `HTTP ${res.status}`;
        throw new Error(msg);
      }
      const body = (await res.json()) as {
        user: UserSummary;
        primaryToken?: IdTokenSummary;
      };
      // primaryToken is added by the Sprint 3 closure-item-1 deploy. If
      // an older API deploy returns just { user }, fall back to the
      // pre-closure behaviour (redirect to list) so the form doesn't
      // crash trying to render a missing token.
      if (body.primaryToken) {
        setCreated({ user: body.user, primaryToken: body.primaryToken });
        router.refresh();
      } else {
        router.push("/people/users");
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  // Post-submit confirmation: render the auto-minted RFID UID in a
  // panel and let the operator continue. RFID UIDs are not secrets
  // (any NFC reader can read them off the physical card) so we show
  // the value plainly — no one-time-display ceremony.
  if (created) {
    return (
      <CreatedPanel
        created={created}
        copyState={copyState}
        onCopy={async () => {
          try {
            await navigator.clipboard.writeText(created.primaryToken.value);
            setCopyState("copied");
            setTimeout(() => setCopyState("idle"), 1500);
          } catch {
            // Clipboard blocked (older browser / non-secure ctx).
            // Operator can select-and-copy the visible value.
            setCopyState("idle");
          }
        }}
      />
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {/* Identity — email is the unique join key, audience drives
          downstream UX (web portal vs mobile app). */}
      <fieldset className="rounded border border-bg-border/60 p-3">
        <legend className="px-1 text-[10px] font-semibold uppercase tracking-brand text-ink-400">
          Identity
        </legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Email"
            required
            value={email}
            onChange={setEmail}
            placeholder="anna@festi.is"
            mono
          />
          <label className="block">
            <span className="block text-[11px] font-semibold uppercase tracking-brand text-ink-400">
              Audience
            </span>
            <select
              value={audience}
              onChange={(e) =>
                setAudience(e.target.value as Audience)
              }
              className="mt-1 w-full rounded-md border border-bg-border bg-bg-base/50 px-3 py-2 text-sm text-ink-50 focus:border-sv-sky focus:outline-none"
            >
              <option value="operator">
                Operator — web portal user (org agent)
              </option>
              <option value="driver">
                Driver — mobile app / RFID consumer
              </option>
              <option value="service">
                Service — API-key principal (future)
              </option>
            </select>
          </label>
          <Field
            label="Display name"
            value={displayName}
            onChange={setDisplayName}
            placeholder="Anna Jónsdóttir"
            hint="Auto-filled from name parts below; override here if needed"
          />
          <Field
            label="Kennitala"
            value={kennitala}
            onChange={setKennitala}
            placeholder="010187-3129"
            mono
            hint="DDMMYY-XXXX (Þjóðskrá)"
          />
        </div>
      </fieldset>

      {/* Name parts — drive proper "Last, First Middle" rendering
          + power any future kennitala-driven address lookup. */}
      <fieldset className="rounded border border-bg-border/60 p-3">
        <legend className="px-1 text-[10px] font-semibold uppercase tracking-brand text-ink-400">
          Name parts
        </legend>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field
            label="First name"
            value={firstName}
            onChange={setFirstName}
            onBlur={nameTouched}
            placeholder="Anna"
          />
          <Field
            label="Middle name"
            value={middleName}
            onChange={setMiddleName}
            onBlur={nameTouched}
          />
          <Field
            label="Last name"
            value={lastName}
            onChange={setLastName}
            onBlur={nameTouched}
            placeholder="Jónsdóttir"
          />
        </div>
      </fieldset>

      {/* Contact + locale. */}
      <fieldset className="rounded border border-bg-border/60 p-3">
        <legend className="px-1 text-[10px] font-semibold uppercase tracking-brand text-ink-400">
          Contact
        </legend>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field
            label="Phone"
            value={phone}
            onChange={setPhone}
            placeholder="+354 555 0123"
            mono
          />
          <Field
            label="Locale"
            value={locale}
            onChange={(v) => setLocale(v.toLowerCase().slice(0, 5))}
            placeholder="is"
            mono
            hint="UI language (is | en)"
          />
          <Field
            label="Timezone"
            value={timezone}
            onChange={setTimezone}
            placeholder="Atlantic/Reykjavik"
            mono
          />
        </div>
      </fieldset>

      {/* Personal — DOB + photo. Optional; useful for fleet
          contracts (DOB) and driver apps (photo). */}
      <fieldset className="rounded border border-bg-border/60 p-3">
        <legend className="px-1 text-[10px] font-semibold uppercase tracking-brand text-ink-400">
          Personal
        </legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="block text-[11px] font-semibold uppercase tracking-brand text-ink-400">
              Date of birth
            </span>
            <input
              type="date"
              value={dateOfBirth}
              onChange={(e) => setDateOfBirth(e.target.value)}
              className="mt-1 w-full rounded-md border border-bg-border bg-bg-base/50 px-3 py-2 text-sm text-ink-50 focus:border-sv-sky focus:outline-none"
            />
            <span className="mt-0.5 block text-[10px] text-ink-500">
              Often derivable from kennitala; provide if known
            </span>
          </label>
          <Field
            label="Photo URL"
            value={photoUrl}
            onChange={setPhotoUrl}
            placeholder="https://…"
            mono
          />
        </div>
      </fieldset>

      {/* Address — Iceland postal-code → city auto-fill. */}
      <fieldset className="rounded border border-bg-border/60 p-3">
        <legend className="px-1 text-[10px] font-semibold uppercase tracking-brand text-ink-400">
          Address
        </legend>
        <div className="space-y-2">
          <Field
            label="Street"
            value={addrStreet}
            onChange={setAddrStreet}
            placeholder="Dalvegi 10"
          />
          <div className="grid gap-2 sm:grid-cols-[100px_1fr_100px]">
            <Field
              label="Postal"
              value={addrPostal}
              onChange={setPostal}
              mono
              placeholder="201"
            />
            <Field
              label="City"
              value={addrCity}
              onChange={setAddrCity}
              placeholder="Kópavogur"
            />
            <Field
              label="Country"
              value={addrCountry}
              onChange={(v) =>
                setAddrCountry(v.toUpperCase().slice(0, 2))
              }
              mono
              placeholder="IS"
            />
          </div>
        </div>
      </fieldset>

      {error && (
        <div className="rounded border border-rose-700/40 bg-rose-950/30 p-2 text-xs text-rose-200">
          {error}
        </div>
      )}

      <p className="text-[11px] text-ink-500">
        Verification (email / phone) and consent (ToS, privacy,
        marketing) timestamps are set by the signup flow when it
        lands. Tokens, vehicles, and vendor identities can be
        attached after the user is created.
      </p>

      <button
        type="submit"
        disabled={submitting || email.length === 0}
        className="rounded-md bg-sv-green/20 px-4 py-2 text-sm font-medium text-sv-green ring-1 ring-sv-green/30 transition-colors hover:bg-sv-green/30 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {submitting ? "Creating…" : "Create user"}
      </button>
    </form>
  );
}

function Field({
  label,
  required,
  hint,
  value,
  onChange,
  onBlur,
  placeholder,
  mono,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  mono?: boolean;
}) {
  return (
    <label className="block">
      <span className="block text-[11px] font-semibold uppercase tracking-brand text-ink-400">
        {label}
        {required && <span className="ml-0.5 text-rose-400">*</span>}
      </span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        placeholder={placeholder}
        className={
          "mt-1 w-full rounded-md border border-bg-border bg-bg-base/50 px-3 py-2 text-sm text-ink-50 focus:border-sv-sky focus:outline-none " +
          (mono ? "font-mono" : "")
        }
      />
      {hint && (
        <span className="mt-0.5 block text-[10px] text-ink-500">{hint}</span>
      )}
    </label>
  );
}

function CreatedPanel({
  created,
  copyState,
  onCopy,
}: {
  created: { user: UserSummary; primaryToken: IdTokenSummary };
  copyState: "idle" | "copied";
  onCopy: () => void;
}) {
  const { user, primaryToken } = created;
  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-5 shadow-card">
        <div className="flex items-baseline gap-2">
          <span className="rounded bg-emerald-500/30 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-brand text-emerald-100">
            created
          </span>
          <h2 className="text-sm font-semibold text-ink-50">
            {user.displayName ?? user.email}
          </h2>
        </div>
        <p className="mt-1 text-xs text-ink-300">
          User <span className="font-mono">{user.email}</span> is on file.
          Straumvakt minted the primary RFID UID below — program a physical
          card with this value, or use it as a virtual idTag for testing.
          Additional tokens can be added from the user detail page.
        </p>

        <div className="mt-4 rounded-md border border-emerald-500/30 bg-bg-base/40 p-4">
          <p className="text-[10px] font-semibold uppercase tracking-brand text-emerald-200">
            Primary RFID UID
          </p>
          <div className="mt-2 flex items-center gap-3">
            <code className="flex-1 select-all rounded bg-bg-base/60 px-3 py-2 font-mono text-base text-emerald-100 ring-1 ring-emerald-500/30">
              {primaryToken.value}
            </code>
            <button
              type="button"
              onClick={onCopy}
              className="rounded-md bg-emerald-500/20 px-3 py-2 text-xs font-medium text-emerald-100 ring-1 ring-emerald-500/40 hover:bg-emerald-500/30"
            >
              {copyState === "copied" ? "Copied!" : "Copy"}
            </button>
          </div>
          <p className="mt-2 text-[10px] text-ink-500">
            Label: <span className="text-ink-300">{primaryToken.label ?? "—"}</span>{" "}
            · Status:{" "}
            <span className="text-emerald-300">{primaryToken.status}</span>
            {" · "}
            kind: <span className="text-ink-300">{primaryToken.kind}</span>
          </p>
        </div>

        <p className="mt-3 text-[11px] text-ink-400">
          Not a secret — RFID UIDs are physically readable from any NFC
          card. Visible at any time on the user detail page below.
        </p>
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={
            `/people/users/${user.id}` as Parameters<typeof Link>[0]["href"]
          }
          className="rounded-md bg-sv-sky/20 px-3 py-2 text-xs font-medium text-sv-sky ring-1 ring-sv-sky/30 hover:bg-sv-sky/30"
        >
          Go to user detail →
        </Link>
        <Link
          href="/people/users"
          className="rounded-md border border-bg-border px-3 py-2 text-xs text-ink-300 hover:bg-bg-base/50"
        >
          Back to user list
        </Link>
        <Link
          href="/people/users/new"
          className="rounded-md border border-bg-border px-3 py-2 text-xs text-ink-300 hover:bg-bg-base/50"
        >
          Create another
        </Link>
      </div>
    </div>
  );
}
