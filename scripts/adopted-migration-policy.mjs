// One explicitly adopted historical backfill. No general exception for UPDATE.
// CPO URL migration 0008 derives two NEW lookup columns from retained identity and installation rows;
// original identity, periods, sessions and terms are untouched. Anything else remains prohibited.
const BACKFILL_0008 = `UPDATE "assets"."device_identities" AS di
SET "cpo_org_id" = i."org_id",
    "charge_point_id" = substr(di."identity_string", length(i."installation_key") + 2)
FROM "properties"."installations" AS i
WHERE di."cpo_org_id" IS NULL
  AND i."installation_key" IS NOT NULL
  AND left(di."identity_string", length(i."installation_key") + 1) = i."installation_key" || '/'
  AND length(di."identity_string") > length(i."installation_key") + 1;`.replace(/\s+/g, ' ');

export function hasUnapprovedDataStatement(tag, source) {
  let text = source.replace(/\s+/g, ' ').trim();
  if (tag === '0008_installation_drafts_and_cpo_identity') text = text.replace(BACKFILL_0008, '');
  return /\b(DELETE\s+FROM|TRUNCATE|INSERT\s+INTO|UPDATE\s+")/i.test(text);
}
