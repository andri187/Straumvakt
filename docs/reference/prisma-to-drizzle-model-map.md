# Prisma model → Drizzle table

Generated 2026-08-07 for the Prisma removal. Every model accessor used in
`apps/api/src` and the Drizzle export that replaces it.

Two traps this table exists to prevent:

- **The names diverge.** `costFactor` is `billing.cost_factors` but
  `agreementCostFactor` is `agreements.cost_factors` — two tables with the
  same name in different schemas, exported as `billingCostFactors` and
  `agreementsCostFactors`. Same for `billing_lines`.
- **The pg schema is not the domain.** `circuit`, `installation`, `site` and
  `property` live in the `properties` pg schema but are exported from
  `db/assets`. `hardwareVendor` is `hardware.vendors`, exported from
  `db/catalog`.


## @straumvakt/shared/db/assets
    capabilityProfile           capabilityProfiles          assets.capability_profiles
    chargingStation             chargingStations            assets.charging_stations
    circuit                     circuits                    properties.circuits
    connector                   connectors                  assets.connectors
    controlRoutingPolicy        controlRoutingPolicies      assets.control_routing_policies
    eVSE                        evses                       assets.evses
    installation                installations               properties.installations
    property                    properties                  properties.properties
    site                        sites                       properties.sites
    siteAsset                   siteAssets                  properties.site_assets

## @straumvakt/shared/db/catalog
    hardwareVendor              vendors                     hardware.vendors

## @straumvakt/shared/db/charging
    chargeSession               sessions                    charging.sessions
    importedCdrRef              importedCdrRefs             charging.imported_cdr_refs
    liveSession                 liveSessions                charging.live_sessions
    liveSessionSample           liveSessionSamples          charging.live_session_samples
    meterValue                  meterValues                 charging.meter_values
    reservation                 reservations                charging.reservations
    tapIntent                   tapIntents                  charging.tap_intents

## @straumvakt/shared/db/commercial
    agreement                   agreements                  agreements.agreements
    agreementBillingLine        agreementsBillingLines      agreements.billing_lines
    agreementClause             agreementClauses            agreements.agreement_clauses
    agreementCostFactor         agreementsCostFactors       agreements.cost_factors
    billingLine                 billingBillingLines         billing.billing_lines
    billObject                  billObjects                 billing.bill_objects
    billObjectMember            billObjectMembers           billing.bill_object_members
    contract                    contracts                   billing.contracts
    costCenter                  costCenters                 billing.cost_centers
    costFactor                  billingCostFactors          billing.cost_factors
    driverContract              driverContracts             billing.driver_contracts
    driverGroup                 driverGroups                agreements.driver_groups
    driverGroupMembership       driverGroupMemberships      agreements.driver_group_memberships
    rateReference               rateReferences              agreements.rate_references
    sessionLedger               sessionLedger               reports.session_ledger
    tariffDefinition            tariffDefinitions           billing.tariff_definitions

## @straumvakt/shared/db/identity
    hostApplication             hostApplications            tenancy.host_applications
    idToken                     idTokens                    identity.id_tokens
    membership                  memberships                 tenancy.memberships
    organization                organizations               tenancy.organizations
    orgEmailDomain              orgEmailDomains             tenancy.org_email_domains
    platformGrant               platformGrants              identity.platform_grants
    user                        users                       identity.users
    userCredential              userCredentials             identity.user_credentials
    userToken                   userTokens                  identity.user_tokens
    userVendorRef               userVendorRefs              identity.user_vendor_refs

## @straumvakt/shared/db/platform
    auditAction                 actions                     audit.actions
    eventLogEntry               eventLog                    events.event_log
    idempotencyKey              idempotencyKeys             events.idempotency_keys
    protocolLogEntry            protocolLog                 events.protocol_log

## @straumvakt/shared/db/protocol
    externalCpmsRef             externalCpmsRefs            roaming.external_cpms_refs
    ocppIdentity                ocppIdentities              ocpp.ocpp_identities
    outboundCommand             outboundCommands            ocpp.outbound_commands
    pendingDiscovery            pendingDiscoveries          ocpp.pending_discoveries

## @straumvakt/shared/db/vendor
    vendorAssetRef              vendorAssetRefs             vendors.vendor_asset_refs
    vendorCredential            vendorCredentials           hardware.vendor_credentials
