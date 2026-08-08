"use client";

import type {
  OrgContact,
  OrgContactRole,
} from "@straumvakt/shared/domain/orgs";

const CONTACT_ROLES: OrgContactRole[] = [
  "main",
  "billing",
  "technical",
  "support",
  "emergency",
  "other",
];

const CONTACT_ROLE_LABELS: Record<OrgContactRole, string> = {
  main: "Main",
  billing: "Billing",
  technical: "Technical",
  support: "Support",
  emergency: "Emergency",
  other: "Other",
};

export interface MainContactState {
  // Either a userId (linked agent) OR a raw contact (pre-User).
  // Both can be empty, in which case the org has no main contact.
  mode: "user" | "raw" | "none";
  userId: string;
  rawName: string;
  rawEmail: string;
  rawPhone: string;
}

export interface MemberOption {
  userId: string;
  displayName: string | null;
  email: string;
}

/**
 * Main contact picker. Three modes:
 *   - "none"  — org has no main contact yet.
 *   - "user"  — linked to an existing User (must have a Membership in
 *               this org). Persists via mainContactUserId FK.
 *   - "raw"   — free-form name/email/phone. Persists as a contact
 *               row with role="main" until invite flow promotes it
 *               to a User.
 */
export function MainContactPicker({
  state,
  onChange,
  members,
}: {
  state: MainContactState;
  onChange: (next: MainContactState) => void;
  members: MemberOption[];
}) {
  return (
    <fieldset className="rounded border border-bg-border/60 p-3">
      <legend className="px-1 text-[10px] font-semibold uppercase tracking-brand text-ink-400">
        Main contact
      </legend>

      <div className="mb-2 flex flex-wrap gap-3 text-[11px] text-ink-300">
        <Radio
          label="None yet"
          checked={state.mode === "none"}
          onChange={() => onChange({ ...state, mode: "none" })}
        />
        <Radio
          label={`Pick existing member${members.length === 0 ? " (no members yet)" : ""}`}
          checked={state.mode === "user"}
          onChange={() => onChange({ ...state, mode: "user" })}
          disabled={members.length === 0}
        />
        <Radio
          label="Enter contact info"
          checked={state.mode === "raw"}
          onChange={() => onChange({ ...state, mode: "raw" })}
        />
      </div>

      {state.mode === "user" && (
        <select
          value={state.userId}
          onChange={(e) => onChange({ ...state, userId: e.target.value })}
          className="w-full rounded-md border border-bg-border bg-bg-base/50 px-3 py-2 text-sm text-ink-50 focus:border-sv-sky focus:outline-none"
        >
          <option value="">— select a member —</option>
          {members.map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.displayName ? `${m.displayName} (${m.email})` : m.email}
            </option>
          ))}
        </select>
      )}

      {state.mode === "raw" && (
        <div className="grid gap-2 sm:grid-cols-3">
          <Input
            label="Name"
            value={state.rawName}
            onChange={(v) => onChange({ ...state, rawName: v })}
            placeholder="Boggi"
          />
          <Input
            label="Email"
            value={state.rawEmail}
            onChange={(v) => onChange({ ...state, rawEmail: v })}
            placeholder="boggi@festi.is"
          />
          <Input
            label="Phone"
            value={state.rawPhone}
            onChange={(v) => onChange({ ...state, rawPhone: v })}
            placeholder="+354 ..."
          />
        </div>
      )}

      {state.mode === "raw" && (
        <p className="mt-2 text-[10px] text-ink-500">
          Stored as a contact row with role=main. Once invite flow ships
          (Sprint 5), a "Promote to user" action will turn this into an
          invited Agent and link via the FK.
        </p>
      )}
    </fieldset>
  );
}

/**
 * Repeater for additional contacts (everything that isn't the main).
 * Persists alongside the main contact in the same JSONB array; when
 * saving, the parent form merges main + additional into one list.
 */
export function AdditionalContactsList({
  contacts,
  onChange,
}: {
  contacts: OrgContact[];
  onChange: (next: OrgContact[]) => void;
}) {
  function update(idx: number, patch: Partial<OrgContact>) {
    const next = contacts.map((c, i) => (i === idx ? { ...c, ...patch } : c));
    onChange(next);
  }
  function remove(idx: number) {
    onChange(contacts.filter((_, i) => i !== idx));
  }
  function add() {
    onChange([
      ...contacts,
      { role: "billing", name: "", email: null, phone: null, notes: null },
    ]);
  }

  return (
    <fieldset className="rounded border border-bg-border/60 p-3">
      <legend className="px-1 text-[10px] font-semibold uppercase tracking-brand text-ink-400">
        Additional contacts
      </legend>

      {contacts.length === 0 ? (
        <p className="text-[11px] italic text-ink-500">
          None. Add billing / technical / support contacts as needed.
        </p>
      ) : (
        <ul className="space-y-2">
          {contacts.map((c, i) => (
            <li
              key={i}
              className="rounded border border-bg-border/40 bg-bg-base/30 p-2"
            >
              <div className="grid gap-2 sm:grid-cols-[120px_1fr_1fr_1fr_auto] sm:items-end">
                <RoleSelect
                  value={c.role}
                  onChange={(role) => update(i, { role })}
                />
                <Input
                  label="Name"
                  value={c.name}
                  onChange={(v) => update(i, { name: v })}
                />
                <Input
                  label="Email"
                  value={c.email ?? ""}
                  onChange={(v) =>
                    update(i, { email: v.length > 0 ? v : null })
                  }
                />
                <Input
                  label="Phone"
                  value={c.phone ?? ""}
                  onChange={(v) =>
                    update(i, { phone: v.length > 0 ? v : null })
                  }
                />
                <button
                  type="button"
                  onClick={() => remove(i)}
                  aria-label="Remove contact"
                  className="self-center rounded bg-rose-500/10 px-2 py-1 text-[10px] text-rose-300 hover:bg-rose-500/20"
                >
                  Remove
                </button>
              </div>
              {(c.notes != null || c.role === "other") && (
                <Input
                  label="Notes"
                  value={c.notes ?? ""}
                  onChange={(v) =>
                    update(i, { notes: v.length > 0 ? v : null })
                  }
                  className="mt-2"
                />
              )}
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        onClick={add}
        className="mt-2 rounded border border-bg-border bg-bg-base/40 px-3 py-1 text-[11px] text-ink-300 hover:bg-bg-raised hover:text-ink-100"
      >
        + Add contact
      </button>
    </fieldset>
  );
}

function Radio({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
}) {
  return (
    <label
      className={
        "inline-flex cursor-pointer items-center gap-1.5 " +
        (disabled ? "cursor-not-allowed opacity-40" : "")
      }
    >
      <input
        type="radio"
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        className="h-3 w-3"
      />
      {label}
    </label>
  );
}

function Input({
  label,
  value,
  onChange,
  placeholder,
  className,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <label className={"block " + (className ?? "")}>
      <span className="block text-[10px] font-semibold uppercase tracking-brand text-ink-500">
        {label}
      </span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-0.5 w-full rounded-md border border-bg-border bg-bg-base/50 px-2 py-1 text-xs text-ink-50 focus:border-sv-sky focus:outline-none"
      />
    </label>
  );
}

function RoleSelect({
  value,
  onChange,
}: {
  value: OrgContactRole;
  onChange: (next: OrgContactRole) => void;
}) {
  return (
    <label className="block">
      <span className="block text-[10px] font-semibold uppercase tracking-brand text-ink-500">
        Role
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as OrgContactRole)}
        className="mt-0.5 w-full rounded-md border border-bg-border bg-bg-base/50 px-2 py-1 text-xs text-ink-50 focus:border-sv-sky focus:outline-none"
      >
        {CONTACT_ROLES.filter((r) => r !== "main").map((r) => (
          <option key={r} value={r}>
            {CONTACT_ROLE_LABELS[r]}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * Build the final contacts array on submit. Main-contact-as-raw
 * gets folded in as a contact row with role="main"; main-contact-as-
 * user is captured by mainContactUserId and not re-stored here.
 */
export function buildContactsForSubmit(
  main: MainContactState,
  additional: OrgContact[],
): { contacts: OrgContact[]; mainContactUserId: string | null } {
  const mainEntry: OrgContact[] =
    main.mode === "raw" && main.rawName.trim().length > 0
      ? [
          {
            role: "main",
            name: main.rawName.trim(),
            email: main.rawEmail.trim().length > 0 ? main.rawEmail.trim() : null,
            phone: main.rawPhone.trim().length > 0 ? main.rawPhone.trim() : null,
            notes: null,
          },
        ]
      : [];
  return {
    contacts: [...mainEntry, ...additional],
    mainContactUserId: main.mode === "user" && main.userId.length > 0 ? main.userId : null,
  };
}

/** Pick out the main entry from a stored contacts array. */
export function splitContacts(contacts: OrgContact[]): {
  main: OrgContact | null;
  additional: OrgContact[];
} {
  const main = contacts.find((c) => c.role === "main") ?? null;
  const additional = contacts.filter((c) => c.role !== "main");
  return { main, additional };
}
