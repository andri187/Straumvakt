// ADR 0026 §6 — host application (RFQ) repository.
//
// Public /apply submissions persist here; the operator lists/works them
// in the /applications inbox and (later, ADR 0027) converts a "won" row
// into a host org. host_applications is a GLOBAL, pre-tenant surface —
// it has no org_id, so (unlike Rule 7 org-scoped repos) these functions
// take no orgId. Operator access is gated at the route by the
// platform.tenant.* permissions instead.

import type { PrismaClient, Prisma } from "../generated/prisma/client";
import type { Env } from "../bindings";
import { sendEmail } from "../lib/email";
import { renderHostApplicationSubmittedEmail } from "../lib/email-templates/host-application-submitted";
import type {
  HostApplicationSite,
  HostApplicationSiteType,
  HostApplicationStatus,
  HostApplicationSummary,
} from "@straumvakt/shared/domain/host-applications";

// Operator notification recipient. Constant for now; moves to env/config
// when the operator-inbox address is finalised. The send fails OPEN, so a
// missing RESEND_API_KEY (e.g. on a fresh staging) never blocks a submit.
const OPERATOR_NOTIFY_EMAIL = "umsoknir@straumvakt.org";

export interface CreateHostApplicationInput {
  companyName: string;
  contactName: string;
  contactEmail: string;
  contactPhone?: string;
  kennitala?: string;
  siteType: HostApplicationSiteType;
  sites: HostApplicationSite[];
  description?: string;
}

export interface CreateHostApplicationResult {
  application: HostApplicationSummary;
  email: { sent: boolean; reason?: string };
}

export interface ListHostApplicationsOptions {
  status?: HostApplicationStatus;
}

// Prisma row → UI summary. `sites` is JSONB; we wrote it as
// HostApplicationSite[] and read it back the same shape.
type HostApplicationRow = {
  id: string;
  companyName: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string | null;
  kennitala: string | null;
  siteType: HostApplicationSiteType;
  sites: Prisma.JsonValue;
  description: string | null;
  status: HostApplicationStatus;
  convertedOrgId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function toSummary(row: HostApplicationRow): HostApplicationSummary {
  return {
    id: row.id,
    companyName: row.companyName,
    contactName: row.contactName,
    contactEmail: row.contactEmail,
    contactPhone: row.contactPhone,
    kennitala: row.kennitala,
    siteType: row.siteType,
    sites: (row.sites as unknown as HostApplicationSite[]) ?? [],
    description: row.description,
    status: row.status,
    convertedOrgId: row.convertedOrgId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function createHostApplication(
  db: PrismaClient,
  env: Env,
  input: CreateHostApplicationInput,
): Promise<CreateHostApplicationResult> {
  const row = (await db.hostApplication.create({
    data: {
      companyName: input.companyName,
      contactName: input.contactName,
      contactEmail: input.contactEmail,
      contactPhone: input.contactPhone ?? null,
      kennitala: input.kennitala ?? null,
      siteType: input.siteType,
      sites: input.sites as unknown as Prisma.InputJsonValue,
      description: input.description ?? null,
      // status defaults to "new" at the DB level.
    },
  })) as HostApplicationRow;

  const totalEstimatedChargers = input.sites.reduce(
    (sum, s) => sum + s.estimatedChargers,
    0,
  );
  const totalEstimatedDrivers = input.sites.reduce(
    (sum, s) => sum + s.estimatedDrivers,
    0,
  );

  const content = renderHostApplicationSubmittedEmail({
    applicationId: row.id,
    companyName: input.companyName,
    contactName: input.contactName,
    contactEmail: input.contactEmail,
    contactPhone: input.contactPhone ?? null,
    siteType: input.siteType,
    siteCount: input.sites.length,
    totalEstimatedChargers,
    totalEstimatedDrivers,
    description: input.description ?? null,
  });

  const emailResult = await sendEmail(env, {
    to: OPERATOR_NOTIFY_EMAIL,
    subject: content.subject,
    html: content.html,
    text: content.text,
    replyTo: input.contactEmail,
    tags: [{ name: "category", value: "host_application" }],
  });

  return {
    application: toSummary(row),
    email: emailResult.ok
      ? { sent: true }
      : { sent: false, reason: emailResult.reason },
  };
}

export async function listHostApplications(
  db: PrismaClient,
  options: ListHostApplicationsOptions = {},
): Promise<HostApplicationSummary[]> {
  const rows = (await db.hostApplication.findMany({
    where: options.status ? { status: options.status } : undefined,
    orderBy: { createdAt: "desc" },
  })) as HostApplicationRow[];
  return rows.map(toSummary);
}

export async function getHostApplication(
  db: PrismaClient,
  id: string,
): Promise<HostApplicationSummary | null> {
  const row = (await db.hostApplication.findUnique({
    where: { id },
  })) as HostApplicationRow | null;
  return row ? toSummary(row) : null;
}

export async function updateHostApplicationStatus(
  db: PrismaClient,
  id: string,
  status: HostApplicationStatus,
): Promise<HostApplicationSummary | null> {
  const existing = await db.hostApplication.findUnique({ where: { id } });
  if (!existing) return null;
  const row = (await db.hostApplication.update({
    where: { id },
    data: { status },
  })) as HostApplicationRow;
  return toSummary(row);
}
