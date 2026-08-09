"use client";

import { useState } from "react";

const POLICIES = [
  {
    id: "automatic",
    label: "Automatic",
    detail: "A valid installation code and passphrase grants access.",
  },
  {
    id: "approval_required",
    label: "Approval required",
    detail: "A valid credential creates a request for an administrator.",
  },
  {
    id: "invite_only",
    label: "Invite only",
    detail: "Drivers join only from an invitation.",
  },
  {
    id: "closed",
    label: "Closed",
    detail: "No new driver access is accepted.",
  },
] as const;

export function AccessPolicyPreview() {
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <fieldset>
      <legend className="org-card-h">
        Driver access policy <span className="sub">No policy recorded</span>
      </legend>
      <p className="org-policy-note">
        Compare the available policies. A selection is not saved by this
        preview.
      </p>
      <div className="org-policy-grid">
        {POLICIES.map((policy) => (
          <label
            key={policy.id}
            className={`org-policy-option ${selected === policy.id ? "selected" : ""}`}
          >
            <input
              type="radio"
              name="access-policy-preview"
              value={policy.id}
              checked={selected === policy.id}
              onChange={() => setSelected(policy.id)}
            />
            <span>
              <strong>{policy.label}</strong>
              <span>{policy.detail}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
