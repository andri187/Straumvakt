// Onboarding chain — single-transaction creation of the full physical
// hierarchy (Org → Property → Site → SiteAsset → ChargingStation → EVSE
// → Connector + OcppIdentity). Ported 1:1 from the monolith repository
// of the same name. The OCPP password is generated once, hashed into
// `auth_secret_hash`, and returned in plaintext exactly once — operator
// must copy it into the charger config or re-provision to rotate.

import type { PrismaClient } from "../generated/prisma/client";
import type { OnboardingChainInput } from "@straumvakt/shared/inputs/onboarding-chains";
import { sha256Hex } from "../lib/sha256";
import { recordAuditAction } from "../lib/audit";

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
  ocppPassword: string;
}

function generatePassword(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, "0");
  return hex;
}

function buildOrgAddresses(input: OnboardingChainInput): unknown {
  const street = input.orgAddressStreet;
  const city = input.orgAddressCity;
  const postalCode = input.orgAddressPostalCode;
  if (!street && !city && !postalCode) return {};
  return {
    primary: { street, city, postal_code: postalCode, country: input.orgCountryCode },
  };
}

function buildOrgContacts(input: OnboardingChainInput): unknown {
  const name = input.orgContactName;
  const email = input.orgContactEmail;
  const phone = input.orgContactPhone;
  if (!name && !email && !phone) return {};
  return { primary: { name, email, phone } };
}

function buildPropertyAddress(input: OnboardingChainInput): unknown {
  const street = input.propertyStreet;
  const city = input.propertyCity;
  const postalCode = input.propertyPostalCode;
  if (!street && !city && !postalCode) return {};
  return { street, city, postal_code: postalCode, country: input.orgCountryCode };
}

export async function createOnboardingChain(
  db: PrismaClient,
  input: OnboardingChainInput,
  actorUserId: string | null,
): Promise<OnboardingChainResult> {
  const password = generatePassword();
  const authSecretHash = await sha256Hex(password);

  // 9 sequential round trips (Org → Property → Site → SiteAsset →
  // ChargingStation → EVSE → Connector → OcppIdentity →
  // pendingDiscovery.deleteMany). Default 5s tx timeout cuts it close
  // over Hyperdrive; bump to 60s.
  const result = await db.$transaction(
    async (tx) => {
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

    const siteAsset = await tx.siteAsset.create({
      data: {
        orgId: org.id,
        siteId: site.id,
        kind: "charger",
        displayName: input.identityString,
      },
      select: { id: true },
    });

    await tx.chargingStation.create({
      data: {
        siteAssetId: siteAsset.id,
        orgId: org.id,
        vendor: input.stationVendor,
        model: input.stationModel,
        serialNumber: input.stationSerialNumber,
        firmwareVersion: input.stationFirmwareVersion,
        installDate: input.stationInstallDate ? new Date(input.stationInstallDate) : undefined,
      },
    });

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

    // Mirror chargers.createCharger — close the pending-discoveries
    // loop in the same tx if the operator's onboarding chain provisions
    // an identityString the gateway has been seeing.
    await tx.pendingDiscovery.deleteMany({
      where: { identityString: input.identityString },
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
    },
    { timeout: 60_000, maxWait: 30_000 },
  );

  await recordAuditAction(db, {
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

  return { ...result, identityString: input.identityString, ocppPassword: password };
}
