-- Seed Iceland's grid parties as organisations with roles.
--
-- These are reference data, not customers: a fixed set fixed by geography
-- and regulation. A property connects to exactly one DSO, and which one
-- determines the distribution tariff — so this is a foreign key target,
-- not a string on a form.
--
-- Modelled as organisations rather than a separate table because roles are
-- composable and the same company appears in several. Orkubú Vestfjarða is
-- both a DSO and a retailer. ON and N1 retail electricity while also being
-- potential charging customers. A separate grid-parties table would make
-- those companies exist twice and need keeping in sync forever.
--
-- kennitala is left NULL throughout — deliberately. The column is @unique
-- and these values were not verified against Fyrirtækjaskrá; a wrong one is
-- worse than a missing one. Fill them from the registry when convenient.
--
-- Fixed UUIDs so every branch (test, staging, production) gets identical
-- ids, and re-running is a no-op.

INSERT INTO "tenancy"."organizations" (id, display_name, country_code, status, roles, created_at, updated_at) VALUES
  -- ── Distribution system operators (dreifiveitur) ──────────────────
  ('0e5d0001-0000-4000-8000-00000000d501', 'RARIK ohf.',              'IS', 'active', '{dso}',          now(), now()),
  ('0e5d0002-0000-4000-8000-00000000d502', 'Norðurorka hf.',          'IS', 'active', '{dso}',          now(), now()),
  ('0e5d0003-0000-4000-8000-00000000d503', 'HS Veitur hf.',           'IS', 'active', '{dso}',          now(), now()),
  ('0e5d0004-0000-4000-8000-00000000d504', 'Orkubú Vestfjarða ohf.',  'IS', 'active', '{dso,retailer}', now(), now()),

  -- ── Transmission (flutningskerfi) ─────────────────────────────────
  ('0e5d0010-0000-4000-8000-00000000d510', 'Landsnet hf.',            'IS', 'active', '{tso}',          now(), now()),

  -- ── Regulator ─────────────────────────────────────────────────────
  ('0e5d0020-0000-4000-8000-00000000d520', 'Orkustofnun',             'IS', 'active', '{regulator}',    now(), now()),

  -- ── Electricity retailers (sölufyrirtæki raforku) ─────────────────
  -- More volatile than the DSOs: a competitive market, so expect this
  -- list to need maintenance in a way the DSO list will not.
  ('0e5d0030-0000-4000-8000-00000000d530', 'Orka náttúrunnar (ON)',   'IS', 'active', '{retailer}',     now(), now()),
  ('0e5d0031-0000-4000-8000-00000000d531', 'Orkusalan ehf.',          'IS', 'active', '{retailer}',     now(), now()),
  ('0e5d0032-0000-4000-8000-00000000d532', 'HS Orka hf.',             'IS', 'active', '{retailer}',     now(), now()),
  ('0e5d0033-0000-4000-8000-00000000d533', 'Íslensk orkumiðlun ehf.', 'IS', 'active', '{retailer}',     now(), now()),
  ('0e5d0034-0000-4000-8000-00000000d534', 'Straumlind ehf.',         'IS', 'active', '{retailer}',     now(), now()),
  ('0e5d0035-0000-4000-8000-00000000d535', 'Fallorka ehf.',           'IS', 'active', '{retailer}',     now(), now())
ON CONFLICT (id) DO NOTHING;

-- Veitur already existed with an empty roles array — it was kept during the
-- 2026-08-03 org cleanup precisely because it is the DSO in the tariff
-- chain, but nothing recorded that. Only set the role if still unset, so
-- this cannot overwrite a deliberate later edit.
UPDATE "tenancy"."organizations"
   SET roles = '{dso}', updated_at = now()
 WHERE display_name = 'Veitur ohf'
   AND (roles IS NULL OR roles = '{}');

-- NOT DONE HERE, deliberately: the 'Straumvakt' org carries nine roles
-- including dso, tso, regulator and retailer. Under ADR 0031 Straumvakt is
-- an agent and never a party to the energy transaction, so most of those
-- are wrong — but which ones are correct depends on decisions not yet made
-- (whether it is an emsp; whether it may act as payment_processor, which is
-- a PSD2 licensing question and explicitly unproven). Left for the operator.
