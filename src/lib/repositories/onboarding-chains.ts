/**
 * Onboarding chains — single-transaction creation of the full physical
 * hierarchy that a charger needs to exist:
 *
 *   Org → Property → Site → SiteAsset → ChargingStation → EVSE → Connector
 *                                                          ↘ OcppIdentity
 *
 * Used by the /onboard test-workflow page so an operator can stand up
 * a complete entity tree from one form. Per-tier CRUD pages will arrive
 * with Sprint 2 milestones 2.3–2.6, but this single endpoint already
 * covers the data plane that those pages will exercise individually.
 *
 * Password handling mirrors the Sprint 1.5 dev/provision-identity
 * pattern: a 32-byte random secret is hashed (SHA-256) into
 * `ocpp_identities.auth_secret_hash`; the plaintext is returned ONCE
 * in the response and never logged. Re-provision to rotate.
 */
import { prisma } from "@/lib/prisma";
import { sha256Hex } from "@/lib/ocpp/internal-auth";
import { recordAuditAction } from "@/lib/repositories/audit-actions";
import type { OnboardingChainInput } from "@/lib/repositories/_inputs/onboarding-chains";

export interface OnboardingChainResult {
  orgId: string;
  orgSlug: string;
  propertyId: string;
  siteId: string;
  chargingStationId: string;
  evseId: string;
  connectorId: string;
  ocppIdentityId: string;
  identityString: string;
  /** One-time plaintext OCPP Basic-Auth password. Never returned again. */
  ocppPassword: string;
}

function generatePassword(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return hex;
}

function buildOrgAddresses(input: OnboardingChainInput): unknown {
  const street = input.orgAddressStreet;
  const city = input.orgAddressCity;
  const postalCode = input.orgAddressPostalCode;
  if (!street && !city && !postalCode) return {};
  return {
    primary: {
      street,
      city,
      postal_code: postalCode,
      country: input.orgCountryCode,
    },
  };
}

function buildOrgContacts(input: OnboardingChainInput): unknown {
  const name = input.orgContactName;
  const email = input.orgContactEmail;
  const phone = input.orgContactPhone;
  if (!name && !email && !phone) return {};
  return {
    primary: { name, email, phone },
  };
}

function buildPropertyAddress(input: OnboardingChainInput): unknown {
  const street = input.propertyStreet;
  const city = input.propertyCity;
  const postalCode = input.propertyPostalCode;
  if (!street && !city && !postalCode) return {};
  return {
    street,
    city,
    postal_code: postalCode,
    country: input.orgCountryCode,
  };
}

export async function createOnboardingChain(
  input: OnboardingChainInput,
  actorUserId: string | null,
): Promise<OnboardingChainResult> {
  const password = generatePassword();
  const authSecretHash = await sha256Hex(password);

  const result = await prisma().$transaction(async (tx) => {
    // 1. Organization
    const org = await tx.organization.create({
      data: {
        slug: input.orgSlug,
        displayName: input.orgDisplayName,
        countryCode: input.orgCountryCode,
        kennitala: input.orgKennitala,
        legalName: input.orgLegalName,
        legalForm: input.orgLegalForm,
        vskNr: input.orgVskNr,
        leiCode: input.orgLeiCode,
        defaultCurrency: input.orgDefaultCurrency,
        regulatorLicenceNo: input.orgRegulatorLicenceNo,
        notes: input.orgNotes,
        roles: input.orgRoles,
        addresses: buildOrgAddresses(input) as object,
        contacts: buildOrgContacts(input) as object,
      },
      select: { id: true, slug: true },
    });

    // 2. Property
    const property = await tx.property.create({
      data: {
        orgId: org.id,
        displayName: input.propertyDisplayName,
        address: buildPropertyAddress(input) as object,
        latitude: input.propertyLatitude,
        longitude: input.propertyLongitude,
      },
      select: { id: true },
    });

    // 3. Site
    const site = await tx.site.create({
      data: {
        orgId: org.id,
        propertyId: property.id,
        displayName: input.siteDisplayName,
        timezone: input.siteTimezone,
        siteType: input.siteType,
        accessLevel: input.siteAccessLevel,
        powerClass: input.sitePowerClass,
      },
      select: { id: true },
    });

    // 4. SiteAsset (kind=charger) — backs the ChargingStation
    const siteAsset = await tx.siteAsset.create({
      data: {
        orgId: org.id,
        siteId: site.id,
        kind: "charger",
        displayName: input.identityString,
      },
      select: { id: true },
    });

    // 5. ChargingStation
    await tx.chargingStation.create({
      data: {
        siteAssetId: siteAsset.id,
        orgId: org.id,
        vendor: input.stationVendor,
        model: input.stationModel,
        serialNumber: input.stationSerialNumber,
        firmwareVersion: input.stationFirmwareVersion,
        installDate: input.stationInstallDate
          ? new Date(input.stationInstallDate)
          : undefined,
      },
    });

    // 6. EVSE
    const evse = await tx.eVSE.create({
      data: {
        orgId: org.id,
        chargingStationId: siteAsset.id,
        evseIndex: input.evseIndex,
        maxPowerKw: input.evseMaxPowerKw,
        phaseCount: input.evsePhaseCount,
      },
      select: { id: true },
    });

    // 7. Connector
    const connector = await tx.connector.create({
      data: {
        orgId: org.id,
        evseId: evse.id,
        connectorIndex: input.connectorIndex,
        type: input.connectorType,
        maxPowerKw: input.connectorMaxPowerKw,
      },
      select: { id: true },
    });

    // 8. OcppIdentity
    const identity = await tx.ocppIdentity.create({
      data: {
        orgId: org.id,
        chargingStationId: siteAsset.id,
        identityString: input.identityString,
        authSecretHash,
        ocppVersion: input.ocppVersion,
        assetClass: input.assetClass,
      },
      select: { id: true },
    });

    return {
      orgId: org.id,
      orgSlug: org.slug,
      propertyId: property.id,
      siteId: site.id,
      chargingStationId: siteAsset.id,
      evseId: evse.id,
      connectorId: connector.id,
      ocppIdentityId: identity.id,
    };
  });

  await recordAuditAction({
    orgId: result.orgId,
    actorUserId,
    actorKind: "user",
    action: "onboarding.chain.create",
    targetType: "organization",
    targetId: result.orgId,
    metadata: {
      siteId: result.siteId,
      chargingStationId: result.chargingStationId,
      ocppIdentityId: result.ocppIdentityId,
      identityString: input.identityString,
    },
  });

  return {
    ...result,
    identityString: input.identityString,
    ocppPassword: password,
  };
}
