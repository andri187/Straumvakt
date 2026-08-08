// Email-domain rules tab for an org (ADR 0022, 2026-05-31 addendum).
//
// Operator-facing list of OrgEmailDomain rows with add / edit / delete.
// The rules control what happens when a newly-registered driver's email
// domain matches: auto_join places them straight into the default
// DriverGroup; request_approval creates an operator inbox item;
// disabled is a no-op (rule kept but paused).

import { apiFetchServer } from "@/lib/api-client-server";
import { EmailDomainsPanel } from "./email-domains-panel";

export const dynamic = "force-dynamic";
export const metadata = { title: "Organization · Email domain rules" };

export type EmailDomainRow = {
  id: string;
  orgId: string;
  domain: string;
  policy: "auto_join" | "request_approval" | "disabled";
  defaultDriverGroupId: string | null;
  defaultDriverGroupDisplayName: string | null;
  createdAt: string;
  updatedAt: string;
};

type DriverGroupOption = {
  id: string;
  displayName: string;
};

export default async function OrgEmailDomainsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // Fetch email-domain rules and available DriverGroups in parallel.
  // DriverGroups come from the agreements route added in Sprint 9.
  const [domainsRes, groupsRes] = await Promise.all([
    apiFetchServer(`/api/admin/orgs/${id}/email-domains`),
    apiFetchServer(`/api/admin/orgs/${id}/driver-groups`),
  ]);

  const { domains } = domainsRes.ok
    ? ((await domainsRes.json()) as { domains: EmailDomainRow[] })
    : { domains: [] };

  // DriverGroups endpoint might not exist yet on older deployments — degrade
  // gracefully rather than crashing the page.
  const driverGroups: DriverGroupOption[] = groupsRes.ok
    ? ((await groupsRes.json()) as { driverGroups: DriverGroupOption[] })
        .driverGroups ?? []
    : [];

  return (
    <EmailDomainsPanel
      orgId={id}
      initialDomains={domains}
      driverGroups={driverGroups}
    />
  );
}
