"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-client";
import { lookupPostalCode } from "@/lib/reference/iceland-postal-codes";

type Audience = "operator" | "driver" | "service";

export function CreateUserForm() {
  const router = useRouter();

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
      const body = {
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
        body: JSON.stringify(body),
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
      router.push("/people/users");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
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
