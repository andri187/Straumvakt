import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { hasUnapprovedDataStatement } from './adopted-migration-policy.mjs';

const tag = '0008_installation_drafts_and_cpo_identity';
const original = readFileSync(`apps/api/drizzle/${tag}.sql`, 'utf8');
describe('specific adopted identity backfill exception', () => {
  it('accepts only the adopted backfill under its original migration identity', () => {
    expect(hasUnapprovedDataStatement(tag, original)).toBe(false);
    expect(hasUnapprovedDataStatement('0011_other', original)).toBe(true);
  });
  it('rejects a broader predicate, altered source/target, duplicate backfill or additional data mutation', () => {
    for (const changed of [
      original.replace('di."cpo_org_id" IS NULL', 'true'),
      original.replace('i."org_id"', 'i."id"'),
      original.replace('SET "cpo_org_id"', 'SET "identity_string"'),
      original + original,
      original + '\nUPDATE "assets"."devices" SET "id" = null;',
      original + '\nDELETE FROM "assets"."devices";',
      original + '\nTRUNCATE "assets"."devices";',
    ]) expect(hasUnapprovedDataStatement(tag, changed)).toBe(true);
  });
});
