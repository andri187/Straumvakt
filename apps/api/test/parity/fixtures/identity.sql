-- Identity fixtures for the parity harness. TEST BRANCH ONLY
-- (br-withered-hat-abtc5gzi, project spring-leaf-73019190).
--
-- WHY THIS EXISTS
-- ---------------
-- The parity harness compares Prisma and Drizzle against whatever rows the
-- branch happens to hold. The branch held three users, one membership and
-- two id_tokens, which meant most of it passed without touching the cases
-- that actually differ between the two:
--
--   • a user with status='deleted'      the listUsers filter
--   • a credential row with NULL hash   hasCredentials must be false
--   • a user with no credential row     the LEFT JOIN, not an INNER one
--   • virtual_rfid created LAST         the partition that overrides
--                                       created_at ordering
--   • two users in one org, and one
--     user in two orgs                  both membership list directions
--   • mixed-case and Icelandic emails   citext ordering
--
-- Every one of those loops ran zero times. A green harness over an empty
-- table is not evidence.
--
-- Idempotent: fixed UUIDs, ON CONFLICT DO UPDATE. Re-running is a no-op.
-- Everything is prefixed parity- / @parity.test so it is obvious in a table
-- listing that these are not real rows.
--
-- Legacy rows in this database are disposable (operator, 2026-08-05), so
-- these sit alongside whatever is already there rather than replacing it.

BEGIN;

-- ── organisations ────────────────────────────────────────────────────────

INSERT INTO tenancy.organizations (id, display_name, country_code, status, roles, created_at, updated_at)
VALUES
  ('11111111-0000-4000-8000-000000000001', 'Parity Host ehf.',  'IS', 'active', ARRAY['site_host']::tenancy."OrganizationRole"[], '2026-01-01T00:00:00Z', now()),
  ('11111111-0000-4000-8000-000000000002', 'Parity Retailer hf.', 'IS', 'active', ARRAY['retailer','cpo']::tenancy."OrganizationRole"[], '2026-01-02T00:00:00Z', now())
ON CONFLICT (id) DO UPDATE
  SET display_name = EXCLUDED.display_name,
      roles        = EXCLUDED.roles,
      updated_at   = now();

-- ── users ────────────────────────────────────────────────────────────────
--
-- Emails chosen so citext ordering is exercised: an uppercase leading
-- character and an Icelandic Þ, which sort differently under C and under
-- is_IS. Whatever the collation does, both ORMs must do the same thing.

INSERT INTO identity.users (id, email, display_name, status, audience, locale, timezone, address, metadata, created_at, updated_at)
VALUES
  -- plain active user, will get a credential row with a real hash
  ('22222222-0000-4000-8000-000000000001', 'anna@parity.test',        'Anna Parity',    'active',    'operator', 'is', 'Atlantic/Reykjavik', '{}', '{}', '2026-01-10T00:00:00Z', now()),
  -- credential row exists but the hash is NULL — hasCredentials must be false
  ('22222222-0000-4000-8000-000000000002', 'Bjorn@parity.test',       'Björn Parity',   'active',    'operator', 'is', 'Atlantic/Reykjavik', '{}', '{}', '2026-01-11T00:00:00Z', now()),
  -- no credential row at all — the LEFT JOIN case
  ('22222222-0000-4000-8000-000000000003', 'thora@parity.test',       'Þóra Parity',    'active',    'driver',   'is', 'Atlantic/Reykjavik', '{}', '{}', '2026-01-12T00:00:00Z', now()),
  -- deleted — must be absent from listUsers() and present with includeDeleted
  ('22222222-0000-4000-8000-000000000004', 'deleted@parity.test',     'Deleted Parity', 'deleted',   'operator', 'is', 'Atlantic/Reykjavik', '{}', '{}', '2026-01-13T00:00:00Z', now()),
  -- suspended — the middle of the enum's declaration order
  ('22222222-0000-4000-8000-000000000005', 'suspended@parity.test',   NULL,             'suspended', 'driver',   'en', 'Atlantic/Reykjavik', '{}', '{}', '2026-01-14T00:00:00Z', now())
ON CONFLICT (id) DO UPDATE
  SET email        = EXCLUDED.email,
      display_name = EXCLUDED.display_name,
      status       = EXCLUDED.status,
      audience     = EXCLUDED.audience,
      updated_at   = now();

-- ── credentials ──────────────────────────────────────────────────────────

INSERT INTO identity.user_credentials (user_id, password_hash, created_at)
VALUES
  ('22222222-0000-4000-8000-000000000001', 'parity$notarealhash', '2026-01-10T00:00:00Z'),
  -- the row that exists with nothing in it
  ('22222222-0000-4000-8000-000000000002', NULL,                  '2026-01-11T00:00:00Z')
ON CONFLICT (user_id) DO UPDATE
  SET password_hash = EXCLUDED.password_hash;

-- ── memberships ──────────────────────────────────────────────────────────
--
-- Anna and Björn share org 1, so listOrgMemberships has more than one row to
-- order. Anna is also in org 2, so listUserMemberships does too.

INSERT INTO tenancy.memberships (org_id, user_id, role, status, created_at)
VALUES
  ('11111111-0000-4000-8000-000000000001', '22222222-0000-4000-8000-000000000001', 'admin',  'active', '2026-02-01T00:00:00Z'),
  ('11111111-0000-4000-8000-000000000001', '22222222-0000-4000-8000-000000000002', 'viewer', 'active', '2026-02-02T00:00:00Z'),
  ('11111111-0000-4000-8000-000000000002', '22222222-0000-4000-8000-000000000001', 'owner',  'active', '2026-02-03T00:00:00Z'),
  ('11111111-0000-4000-8000-000000000001', '22222222-0000-4000-8000-000000000003', 'driver', 'active', '2026-02-04T00:00:00Z')
ON CONFLICT (org_id, user_id) DO UPDATE
  SET role = EXCLUDED.role;

-- ── id tokens ────────────────────────────────────────────────────────────
--
-- The ordering case: Anna's virtual_rfid is created AFTER both her cards, so
-- ordering by created_at alone puts it last. listIdTokensForUser partitions
-- it to the front regardless, and that is the behaviour being compared.

INSERT INTO identity.id_tokens (id, user_id, kind, value, label, status, created_at, updated_at)
VALUES
  ('33333333-0000-4000-8000-000000000001', '22222222-0000-4000-8000-000000000001', 'rfid',         'PARITY01', 'First card',  'active',  '2026-03-01T00:00:00Z', now()),
  ('33333333-0000-4000-8000-000000000002', '22222222-0000-4000-8000-000000000001', 'rfid',         'PARITY02', 'Second card', 'revoked', '2026-03-02T00:00:00Z', now()),
  ('33333333-0000-4000-8000-000000000003', '22222222-0000-4000-8000-000000000001', 'virtual_rfid', 'PARITYV1', 'App',         'active',  '2026-03-03T00:00:00Z', now()),
  -- Björn has one card and no vRFID — the other side of the partition
  ('33333333-0000-4000-8000-000000000004', '22222222-0000-4000-8000-000000000002', 'rfid',         'PARITY03', NULL,          'active',  '2026-03-04T00:00:00Z', now())
  -- Þóra has none at all, which is what the backfill scans for
ON CONFLICT (id) DO UPDATE
  SET value      = EXCLUDED.value,
      label      = EXCLUDED.label,
      status     = EXCLUDED.status,
      updated_at = now();

COMMIT;

-- ── people.family_groups / vehicles, identity.vendor_user_groups ─────────
--
-- Added 2026-08-06 for the second batch of ported repositories. All three
-- tables were EMPTY on the branch, which would have made the parity
-- comparisons for family-groups, vehicles and vendor-user-groups pass
-- without executing anything.
--
-- Member counts deliberately differ (2, 1, 0) because the risky part of
-- those ports is Prisma's `_count: { select: { members: true } }` becoming a
-- correlated subquery. A single group with one member cannot tell a correct
-- subquery from a constant.

BEGIN;

INSERT INTO people.family_groups (id, org_id, display_name, primary_user_id, created_at)
VALUES
  ('44444444-0000-4000-8000-000000000001', '11111111-0000-4000-8000-000000000001', 'Parity Family A', '22222222-0000-4000-8000-000000000001', '2026-04-01T00:00:00Z'),
  ('44444444-0000-4000-8000-000000000002', '11111111-0000-4000-8000-000000000001', 'Parity Family B', '22222222-0000-4000-8000-000000000002', '2026-04-02T00:00:00Z'),
  -- zero members: the case a JOIN-and-GROUP-BY would drop entirely
  ('44444444-0000-4000-8000-000000000003', '11111111-0000-4000-8000-000000000002', 'Parity Family C (empty)', '22222222-0000-4000-8000-000000000003', '2026-04-03T00:00:00Z')
ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name;

INSERT INTO people.family_memberships (family_group_id, user_id, member_kind, joined_at)
VALUES
  ('44444444-0000-4000-8000-000000000001', '22222222-0000-4000-8000-000000000001', 'primary',     '2026-04-01T00:00:00Z'),
  ('44444444-0000-4000-8000-000000000001', '22222222-0000-4000-8000-000000000003', 'family_user', '2026-04-01T01:00:00Z'),
  ('44444444-0000-4000-8000-000000000002', '22222222-0000-4000-8000-000000000002', 'primary',     '2026-04-02T00:00:00Z')
ON CONFLICT (family_group_id, user_id) DO UPDATE SET member_kind = EXCLUDED.member_kind;

INSERT INTO people.vehicles (id, user_id, make, model, year, license_plate, vin, battery_capacity_kwh, created_at, updated_at)
VALUES
  -- trailing zero on purpose: "77.40" must survive as a string, not become 77.4
  ('55555555-0000-4000-8000-000000000001', '22222222-0000-4000-8000-000000000003', 'Tesla',  'Model Y', 2024, 'AB123',  '5YJYGDEF0LF000001', 77.40, '2026-05-01T00:00:00Z', now()),
  ('55555555-0000-4000-8000-000000000002', '22222222-0000-4000-8000-000000000003', 'Nissan', 'Leaf',    NULL, NULL,     NULL,                NULL,  '2026-05-02T00:00:00Z', now())
ON CONFLICT (id) DO UPDATE SET make = EXCLUDED.make, battery_capacity_kwh = EXCLUDED.battery_capacity_kwh;

INSERT INTO identity.user_vendor_refs (id, user_id, vendor_slug, vendor_user_id, vendor_email, status, last_synced_at, created_at, updated_at)
VALUES
  ('66666666-0000-4000-8000-000000000001', '22222222-0000-4000-8000-000000000001', 'zaptec', 'parity-zaptec-user-1', 'anna@parity.test', 'active', '2026-06-01T00:00:00Z', '2026-06-01T00:00:00Z', now())
ON CONFLICT (id) DO UPDATE SET vendor_email = EXCLUDED.vendor_email;

-- Attaches to whichever installation exists; the branch mirrors staging and
-- has two. Skipped entirely if there are none, so the file stays runnable.
INSERT INTO identity.vendor_user_groups (id, vendor_slug, vendor_group_id, installation_id, name, last_synced_at, created_at, updated_at)
SELECT '77777777-0000-4000-8000-000000000001', 'zaptec', 'parity-zaptec-group-1', i.id, 'Parity Zaptec Group', '2026-06-01T00:00:00Z', '2026-06-01T00:00:00Z', now()
  FROM properties.installations i ORDER BY i.id LIMIT 1
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;

INSERT INTO identity.vendor_user_group_memberships (group_id, user_id, role, created_at)
SELECT '77777777-0000-4000-8000-000000000001', '22222222-0000-4000-8000-000000000001', 'member', '2026-06-01T00:00:00Z'
 WHERE EXISTS (SELECT 1 FROM identity.vendor_user_groups WHERE id = '77777777-0000-4000-8000-000000000001')
ON CONFLICT (group_id, user_id) DO UPDATE SET role = EXCLUDED.role;

COMMIT;
