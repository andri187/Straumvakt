-- Replace the hand-typed grid-party seed with one generated from
-- docs/reference/iceland-energy-parties.json — the curated market
-- reference that already backs /reference/electricity/* and
-- /reference/rental-service.
--
-- 20260804000500 seeded 12 organisations from recall: no kennitala (left
-- NULL because the values were unverified), invented display names, and
-- an incomplete DSO list. All of that was sitting in the reference file,
-- with legal names, legal forms, registered addresses, contacts, branding
-- and tariff tables. Removed here and replaced properly.
--
-- Deduplicated by kennitala. 21 reference entries collapse to 18 legal
-- entities: 'ov-sales' and 'ov-dso' are one company (Orkubú Vestfjarða,
-- kt 6608770299) and its consolidates_with field says so — it emerges as
-- {retailer,dso,cpo}, the composable-roles case in real data.
--
-- Also corrects 20260804001500, which gave 'N1 ehf' the retailer role on
-- the reasoning that N1 acquired Íslensk orkumiðlun. They are two legal
-- entities: N1 (charging) kt 4110033370 and N1 Rafmagn kt 4712161190. The
-- retail arm is its own company and gets its own row.
--
-- Upsert on kennitala, union of roles, existing values preserved — so the
-- real N1 customer org keeps everything it has and only gains what the
-- reference adds.
--
-- NOT MAPPED: three reference roles have no OrganizationRole equivalent —
-- 'producer', 'aggregator', and 'home_charging' (charger rental, the
-- CHRGRF cost factor, and N1's and ON's actual business). Those parties
-- are seeded without them. Adding the enum values is a schema change and
-- is left for the scope's S1.

DELETE FROM "tenancy"."organizations"
 WHERE id::text LIKE '0e5d%-0000-4000-8000-%'
   AND kennitala IS NULL;

UPDATE "tenancy"."organizations"
   SET roles = array_remove(roles, 'retailer'::"tenancy"."OrganizationRole"), updated_at = now()
 WHERE kennitala = '4110033370';

INSERT INTO "tenancy"."organizations" (id, display_name, legal_name, legal_form, kennitala, country_code, default_currency, status, roles, postal_address, branding, regulator_licence_no, created_at, updated_at)
VALUES (gen_random_uuid(), 'Rafveita Reyðarfjarðar', 'Rafveita Reyðarfjarðar (Fjarðabyggð)', 'municipal', '4102722459', 'IS', 'ISK', 'active', '{dso}', '{"street":"Hafnargata 2","postalCode":"730","city":"Reyðarfjörður","countryCode":"IS"}'::jsonb, '{"rail_class":"dso","contacts":{"phone_main":"470 9000","email_main":"fjardabyggd@fjardabyggd.is","website":"https://www.fjardabyggd.is"}}'::jsonb, NULL, now(), now())
ON CONFLICT (kennitala) DO UPDATE SET
  legal_name = EXCLUDED.legal_name,
  legal_form = COALESCE("tenancy"."organizations".legal_form, EXCLUDED.legal_form),
  roles = ARRAY(SELECT DISTINCT unnest("tenancy"."organizations".roles || EXCLUDED.roles)),
  postal_address = COALESCE("tenancy"."organizations".postal_address, EXCLUDED.postal_address),
  branding = CASE WHEN "tenancy"."organizations".branding = '{}'::jsonb THEN EXCLUDED.branding ELSE "tenancy"."organizations".branding END,
  regulator_licence_no = COALESCE("tenancy"."organizations".regulator_licence_no, EXCLUDED.regulator_licence_no),
  updated_at = now();

INSERT INTO "tenancy"."organizations" (id, display_name, legal_name, legal_form, kennitala, country_code, default_currency, status, roles, postal_address, branding, regulator_licence_no, created_at, updated_at)
VALUES (gen_random_uuid(), 'N1 (charging)', 'N1 ehf.', 'ehf', '4110033370', 'IS', 'ISK', 'active', '{cpo}', '{"street":"Dalvegur 10–14","postalCode":"201","city":"Kópavogur","countryCode":"IS"}'::jsonb, '{"rail_class":"cpo","logo_url":"logos/n1.png","contacts":{"phone_main":"440 1000","email_main":"n1@n1.is","website":"https://n1.is"}}'::jsonb, NULL, now(), now())
ON CONFLICT (kennitala) DO UPDATE SET
  legal_name = EXCLUDED.legal_name,
  legal_form = COALESCE("tenancy"."organizations".legal_form, EXCLUDED.legal_form),
  roles = ARRAY(SELECT DISTINCT unnest("tenancy"."organizations".roles || EXCLUDED.roles)),
  postal_address = COALESCE("tenancy"."organizations".postal_address, EXCLUDED.postal_address),
  branding = CASE WHEN "tenancy"."organizations".branding = '{}'::jsonb THEN EXCLUDED.branding ELSE "tenancy"."organizations".branding END,
  regulator_licence_no = COALESCE("tenancy"."organizations".regulator_licence_no, EXCLUDED.regulator_licence_no),
  updated_at = now();

INSERT INTO "tenancy"."organizations" (id, display_name, legal_name, legal_form, kennitala, country_code, default_currency, status, roles, postal_address, branding, regulator_licence_no, created_at, updated_at)
VALUES (gen_random_uuid(), 'Orka heimilanna', 'Orka heimilanna ehf.', 'ehf', '4202182060', 'IS', 'ISK', 'active', '{retailer}', '{"street":"Mánagata 11","postalCode":"105","city":"Reykjavík","countryCode":"IS"}'::jsonb, '{"rail_class":"retailer","logo_url":"logos/orka-heimilanna.png","contacts":{"phone_main":"546 0033","email_main":"orkaheimilanna@orkaheimilanna.is","website":"https://orkaheimilanna.is"}}'::jsonb, NULL, now(), now())
ON CONFLICT (kennitala) DO UPDATE SET
  legal_name = EXCLUDED.legal_name,
  legal_form = COALESCE("tenancy"."organizations".legal_form, EXCLUDED.legal_form),
  roles = ARRAY(SELECT DISTINCT unnest("tenancy"."organizations".roles || EXCLUDED.roles)),
  postal_address = COALESCE("tenancy"."organizations".postal_address, EXCLUDED.postal_address),
  branding = CASE WHEN "tenancy"."organizations".branding = '{}'::jsonb THEN EXCLUDED.branding ELSE "tenancy"."organizations".branding END,
  regulator_licence_no = COALESCE("tenancy"."organizations".regulator_licence_no, EXCLUDED.regulator_licence_no),
  updated_at = now();

INSERT INTO "tenancy"."organizations" (id, display_name, legal_name, legal_form, kennitala, country_code, default_currency, status, roles, postal_address, branding, regulator_licence_no, created_at, updated_at)
VALUES (gen_random_uuid(), 'ON', 'Orka náttúrunnar ohf.', 'ohf', '5212130190', 'IS', 'ISK', 'active', '{retailer,cpo}', '{"street":"Bæjarháls 1","postalCode":"110","city":"Reykjavík","countryCode":"IS"}'::jsonb, '{"rail_class":"retailer","logo_url":"logos/on.png","contacts":{"phone_main":"591 2700","email_main":"on@on.is","website":"https://www.on.is"}}'::jsonb, NULL, now(), now())
ON CONFLICT (kennitala) DO UPDATE SET
  legal_name = EXCLUDED.legal_name,
  legal_form = COALESCE("tenancy"."organizations".legal_form, EXCLUDED.legal_form),
  roles = ARRAY(SELECT DISTINCT unnest("tenancy"."organizations".roles || EXCLUDED.roles)),
  postal_address = COALESCE("tenancy"."organizations".postal_address, EXCLUDED.postal_address),
  branding = CASE WHEN "tenancy"."organizations".branding = '{}'::jsonb THEN EXCLUDED.branding ELSE "tenancy"."organizations".branding END,
  regulator_licence_no = COALESCE("tenancy"."organizations".regulator_licence_no, EXCLUDED.regulator_licence_no),
  updated_at = now();

INSERT INTO "tenancy"."organizations" (id, display_name, legal_name, legal_form, kennitala, country_code, default_currency, status, roles, postal_address, branding, regulator_licence_no, created_at, updated_at)
VALUES (gen_random_uuid(), 'Orkusalan', 'Orkusalan ehf.', 'ehf', '5603061130', 'IS', 'ISK', 'active', '{retailer,cpo}', '{"street":"Dvergshöfði 2","postalCode":"110","city":"Reykjavík","countryCode":"IS"}'::jsonb, '{"rail_class":"retailer","logo_url":"logos/orkusalan.png","contacts":{"phone_main":"422 1000","email_main":"orkusalan@orkusalan.is","website":"https://www.orkusalan.is"}}'::jsonb, NULL, now(), now())
ON CONFLICT (kennitala) DO UPDATE SET
  legal_name = EXCLUDED.legal_name,
  legal_form = COALESCE("tenancy"."organizations".legal_form, EXCLUDED.legal_form),
  roles = ARRAY(SELECT DISTINCT unnest("tenancy"."organizations".roles || EXCLUDED.roles)),
  postal_address = COALESCE("tenancy"."organizations".postal_address, EXCLUDED.postal_address),
  branding = CASE WHEN "tenancy"."organizations".branding = '{}'::jsonb THEN EXCLUDED.branding ELSE "tenancy"."organizations".branding END,
  regulator_licence_no = COALESCE("tenancy"."organizations".regulator_licence_no, EXCLUDED.regulator_licence_no),
  updated_at = now();

INSERT INTO "tenancy"."organizations" (id, display_name, legal_name, legal_form, kennitala, country_code, default_currency, status, roles, postal_address, branding, regulator_licence_no, created_at, updated_at)
VALUES (gen_random_uuid(), 'HS Orka', 'HS Orka hf.', 'hf', '6804750169', 'IS', 'ISK', 'active', '{retailer}', '{"street":"Orkubraut 3, Svartsengi","postalCode":"241","city":"Grindavík","countryCode":"IS"}'::jsonb, '{"rail_class":"retailer","logo_url":"logos/hsorka.png","contacts":{"phone_main":"520 9300","email_main":"hsorka@hsorka.is","website":"https://www.hsorka.is"}}'::jsonb, NULL, now(), now())
ON CONFLICT (kennitala) DO UPDATE SET
  legal_name = EXCLUDED.legal_name,
  legal_form = COALESCE("tenancy"."organizations".legal_form, EXCLUDED.legal_form),
  roles = ARRAY(SELECT DISTINCT unnest("tenancy"."organizations".roles || EXCLUDED.roles)),
  postal_address = COALESCE("tenancy"."organizations".postal_address, EXCLUDED.postal_address),
  branding = CASE WHEN "tenancy"."organizations".branding = '{}'::jsonb THEN EXCLUDED.branding ELSE "tenancy"."organizations".branding END,
  regulator_licence_no = COALESCE("tenancy"."organizations".regulator_licence_no, EXCLUDED.regulator_licence_no),
  updated_at = now();

INSERT INTO "tenancy"."organizations" (id, display_name, legal_name, legal_form, kennitala, country_code, default_currency, status, roles, postal_address, branding, regulator_licence_no, created_at, updated_at)
VALUES (gen_random_uuid(), 'Straumlind', 'Straumlind ehf.', 'ehf', '4809200150', 'IS', 'ISK', 'active', '{retailer}', '{"street":"Bjargargata 1","postalCode":"102","city":"Reykjavík","countryCode":"IS"}'::jsonb, '{"rail_class":"retailer","logo_url":"logos/straumlind.png","contacts":{"phone_main":null,"email_main":"info@straumlind.is","website":"https://straumlind.is"}}'::jsonb, NULL, now(), now())
ON CONFLICT (kennitala) DO UPDATE SET
  legal_name = EXCLUDED.legal_name,
  legal_form = COALESCE("tenancy"."organizations".legal_form, EXCLUDED.legal_form),
  roles = ARRAY(SELECT DISTINCT unnest("tenancy"."organizations".roles || EXCLUDED.roles)),
  postal_address = COALESCE("tenancy"."organizations".postal_address, EXCLUDED.postal_address),
  branding = CASE WHEN "tenancy"."organizations".branding = '{}'::jsonb THEN EXCLUDED.branding ELSE "tenancy"."organizations".branding END,
  regulator_licence_no = COALESCE("tenancy"."organizations".regulator_licence_no, EXCLUDED.regulator_licence_no),
  updated_at = now();

INSERT INTO "tenancy"."organizations" (id, display_name, legal_name, legal_form, kennitala, country_code, default_currency, status, roles, postal_address, branding, regulator_licence_no, created_at, updated_at)
VALUES (gen_random_uuid(), 'N1 Rafmagn', 'N1 Rafmagn ehf.', 'ehf', '4712161190', 'IS', 'ISK', 'active', '{retailer}', '{"street":"Dalvegur 10–14","postalCode":"201","city":"Kópavogur","countryCode":"IS"}'::jsonb, '{"rail_class":"retailer","logo_url":"logos/n1.png","contacts":{"phone_main":"440 1000","email_main":"rafmagn@n1.is","website":"https://rafmagn.n1.is"}}'::jsonb, NULL, now(), now())
ON CONFLICT (kennitala) DO UPDATE SET
  legal_name = EXCLUDED.legal_name,
  legal_form = COALESCE("tenancy"."organizations".legal_form, EXCLUDED.legal_form),
  roles = ARRAY(SELECT DISTINCT unnest("tenancy"."organizations".roles || EXCLUDED.roles)),
  postal_address = COALESCE("tenancy"."organizations".postal_address, EXCLUDED.postal_address),
  branding = CASE WHEN "tenancy"."organizations".branding = '{}'::jsonb THEN EXCLUDED.branding ELSE "tenancy"."organizations".branding END,
  regulator_licence_no = COALESCE("tenancy"."organizations".regulator_licence_no, EXCLUDED.regulator_licence_no),
  updated_at = now();

INSERT INTO "tenancy"."organizations" (id, display_name, legal_name, legal_form, kennitala, country_code, default_currency, status, roles, postal_address, branding, regulator_licence_no, created_at, updated_at)
VALUES (gen_random_uuid(), 'Orkubú Vestfjarða (sales)', 'Orkubú Vestfjarða ohf.', 'ohf', '6608770299', 'IS', 'ISK', 'active', '{retailer,dso,cpo}', '{"street":"Stakkanes 1","postalCode":"400","city":"Ísafjörður","countryCode":"IS"}'::jsonb, '{"rail_class":"multi","logo_url":"logos/ov.png","contacts":{"phone_main":"450 3211","email_main":"orkubu@ov.is","website":"https://www.ov.is"}}'::jsonb, NULL, now(), now())
ON CONFLICT (kennitala) DO UPDATE SET
  legal_name = EXCLUDED.legal_name,
  legal_form = COALESCE("tenancy"."organizations".legal_form, EXCLUDED.legal_form),
  roles = ARRAY(SELECT DISTINCT unnest("tenancy"."organizations".roles || EXCLUDED.roles)),
  postal_address = COALESCE("tenancy"."organizations".postal_address, EXCLUDED.postal_address),
  branding = CASE WHEN "tenancy"."organizations".branding = '{}'::jsonb THEN EXCLUDED.branding ELSE "tenancy"."organizations".branding END,
  regulator_licence_no = COALESCE("tenancy"."organizations".regulator_licence_no, EXCLUDED.regulator_licence_no),
  updated_at = now();

INSERT INTO "tenancy"."organizations" (id, display_name, legal_name, legal_form, kennitala, country_code, default_currency, status, roles, postal_address, branding, regulator_licence_no, created_at, updated_at)
VALUES (gen_random_uuid(), 'Fallorka', 'Fallorka ehf.', 'ehf', '6003024180', 'IS', 'ISK', 'active', '{}', '{"street":"Rangárvöllum","postalCode":"603","city":"Akureyri","countryCode":"IS"}'::jsonb, '{"rail_class":"retailer","contacts":{"phone_main":"460 1300","email_main":"fallorka@fallorka.is","website":"https://www.fallorka.is"}}'::jsonb, NULL, now(), now())
ON CONFLICT (kennitala) DO UPDATE SET
  legal_name = EXCLUDED.legal_name,
  legal_form = COALESCE("tenancy"."organizations".legal_form, EXCLUDED.legal_form),
  roles = ARRAY(SELECT DISTINCT unnest("tenancy"."organizations".roles || EXCLUDED.roles)),
  postal_address = COALESCE("tenancy"."organizations".postal_address, EXCLUDED.postal_address),
  branding = CASE WHEN "tenancy"."organizations".branding = '{}'::jsonb THEN EXCLUDED.branding ELSE "tenancy"."organizations".branding END,
  regulator_licence_no = COALESCE("tenancy"."organizations".regulator_licence_no, EXCLUDED.regulator_licence_no),
  updated_at = now();

INSERT INTO "tenancy"."organizations" (id, display_name, legal_name, legal_form, kennitala, country_code, default_currency, status, roles, postal_address, branding, regulator_licence_no, created_at, updated_at)
VALUES (gen_random_uuid(), 'Ísorka', 'Ísorka ehf.', 'ehf', '4508081560', 'IS', 'ISK', 'active', '{cpo}', '{"street":"Sævarhöfði 2","postalCode":"110","city":"Reykjavík","countryCode":"IS"}'::jsonb, '{"rail_class":"cpo","contacts":{"phone_main":"568 7666","email_main":"isorka@isorka.is","website":"https://isorka.is"}}'::jsonb, NULL, now(), now())
ON CONFLICT (kennitala) DO UPDATE SET
  legal_name = EXCLUDED.legal_name,
  legal_form = COALESCE("tenancy"."organizations".legal_form, EXCLUDED.legal_form),
  roles = ARRAY(SELECT DISTINCT unnest("tenancy"."organizations".roles || EXCLUDED.roles)),
  postal_address = COALESCE("tenancy"."organizations".postal_address, EXCLUDED.postal_address),
  branding = CASE WHEN "tenancy"."organizations".branding = '{}'::jsonb THEN EXCLUDED.branding ELSE "tenancy"."organizations".branding END,
  regulator_licence_no = COALESCE("tenancy"."organizations".regulator_licence_no, EXCLUDED.regulator_licence_no),
  updated_at = now();

INSERT INTO "tenancy"."organizations" (id, display_name, legal_name, legal_form, kennitala, country_code, default_currency, status, roles, postal_address, branding, regulator_licence_no, created_at, updated_at)
VALUES (gen_random_uuid(), 'Bílorka (e1)', 'Íslensk Bílorka ehf.', 'ehf', '7012770239', 'IS', 'ISK', 'active', '{cpo}', '{"street":null,"postalCode":null,"city":"Reykjavík","countryCode":"IS"}'::jsonb, '{"rail_class":"cpo","contacts":{"phone_main":"515 7800","email_main":"info@bilorka.is","website":"https://bilorka.is"}}'::jsonb, NULL, now(), now())
ON CONFLICT (kennitala) DO UPDATE SET
  legal_name = EXCLUDED.legal_name,
  legal_form = COALESCE("tenancy"."organizations".legal_form, EXCLUDED.legal_form),
  roles = ARRAY(SELECT DISTINCT unnest("tenancy"."organizations".roles || EXCLUDED.roles)),
  postal_address = COALESCE("tenancy"."organizations".postal_address, EXCLUDED.postal_address),
  branding = CASE WHEN "tenancy"."organizations".branding = '{}'::jsonb THEN EXCLUDED.branding ELSE "tenancy"."organizations".branding END,
  regulator_licence_no = COALESCE("tenancy"."organizations".regulator_licence_no, EXCLUDED.regulator_licence_no),
  updated_at = now();

INSERT INTO "tenancy"."organizations" (id, display_name, legal_name, legal_form, kennitala, country_code, default_currency, status, roles, postal_address, branding, regulator_licence_no, created_at, updated_at)
VALUES (gen_random_uuid(), 'Olís (charging)', 'Olíuverzlun Íslands hf.', 'hf', '5002692649', 'IS', 'ISK', 'active', '{cpo}', '{"street":"Skútuvogur 5","postalCode":"104","city":"Reykjavík","countryCode":"IS"}'::jsonb, '{"rail_class":"cpo","contacts":{"phone_main":"515 1000","email_main":"olis@olis.is","website":"https://www.olis.is"}}'::jsonb, NULL, now(), now())
ON CONFLICT (kennitala) DO UPDATE SET
  legal_name = EXCLUDED.legal_name,
  legal_form = COALESCE("tenancy"."organizations".legal_form, EXCLUDED.legal_form),
  roles = ARRAY(SELECT DISTINCT unnest("tenancy"."organizations".roles || EXCLUDED.roles)),
  postal_address = COALESCE("tenancy"."organizations".postal_address, EXCLUDED.postal_address),
  branding = CASE WHEN "tenancy"."organizations".branding = '{}'::jsonb THEN EXCLUDED.branding ELSE "tenancy"."organizations".branding END,
  regulator_licence_no = COALESCE("tenancy"."organizations".regulator_licence_no, EXCLUDED.regulator_licence_no),
  updated_at = now();

INSERT INTO "tenancy"."organizations" (id, display_name, legal_name, legal_form, kennitala, country_code, default_currency, status, roles, postal_address, branding, regulator_licence_no, created_at, updated_at)
VALUES (gen_random_uuid(), 'Amper', 'Amper Orka ehf.', 'ehf', '4711230210', 'IS', 'ISK', 'active', '{}', '{"street":"Borgartún 25","postalCode":"105","city":"Reykjavík","countryCode":"IS"}'::jsonb, '{"rail_class":"cpo","contacts":{"phone_main":"546 4200","email_main":"amper@amper.is","website":"https://www.amper.is"}}'::jsonb, NULL, now(), now())
ON CONFLICT (kennitala) DO UPDATE SET
  legal_name = EXCLUDED.legal_name,
  legal_form = COALESCE("tenancy"."organizations".legal_form, EXCLUDED.legal_form),
  roles = ARRAY(SELECT DISTINCT unnest("tenancy"."organizations".roles || EXCLUDED.roles)),
  postal_address = COALESCE("tenancy"."organizations".postal_address, EXCLUDED.postal_address),
  branding = CASE WHEN "tenancy"."organizations".branding = '{}'::jsonb THEN EXCLUDED.branding ELSE "tenancy"."organizations".branding END,
  regulator_licence_no = COALESCE("tenancy"."organizations".regulator_licence_no, EXCLUDED.regulator_licence_no),
  updated_at = now();

INSERT INTO "tenancy"."organizations" (id, display_name, legal_name, legal_form, kennitala, country_code, default_currency, status, roles, postal_address, branding, regulator_licence_no, created_at, updated_at)
VALUES (gen_random_uuid(), 'Veitur', 'Veitur ohf.', 'ohf', '5012131870', 'IS', 'ISK', 'active', '{dso}', '{"street":"Bæjarháls 1","postalCode":"110","city":"Reykjavík","countryCode":"IS"}'::jsonb, '{"rail_class":"dso","contacts":{"phone_main":"516 6000","email_main":"veitur@veitur.is","website":"https://www.veitur.is"}}'::jsonb, NULL, now(), now())
ON CONFLICT (kennitala) DO UPDATE SET
  legal_name = EXCLUDED.legal_name,
  legal_form = COALESCE("tenancy"."organizations".legal_form, EXCLUDED.legal_form),
  roles = ARRAY(SELECT DISTINCT unnest("tenancy"."organizations".roles || EXCLUDED.roles)),
  postal_address = COALESCE("tenancy"."organizations".postal_address, EXCLUDED.postal_address),
  branding = CASE WHEN "tenancy"."organizations".branding = '{}'::jsonb THEN EXCLUDED.branding ELSE "tenancy"."organizations".branding END,
  regulator_licence_no = COALESCE("tenancy"."organizations".regulator_licence_no, EXCLUDED.regulator_licence_no),
  updated_at = now();

INSERT INTO "tenancy"."organizations" (id, display_name, legal_name, legal_form, kennitala, country_code, default_currency, status, roles, postal_address, branding, regulator_licence_no, created_at, updated_at)
VALUES (gen_random_uuid(), 'RARIK', 'RARIK ohf.', 'ohf', '5202692669', 'IS', 'ISK', 'active', '{dso}', '{"street":"Dvergshöfði 2","postalCode":"110","city":"Reykjavík","countryCode":"IS"}'::jsonb, '{"rail_class":"dso","contacts":{"phone_main":"528 9000","email_main":"rarik@rarik.is","website":"https://www.rarik.is"}}'::jsonb, NULL, now(), now())
ON CONFLICT (kennitala) DO UPDATE SET
  legal_name = EXCLUDED.legal_name,
  legal_form = COALESCE("tenancy"."organizations".legal_form, EXCLUDED.legal_form),
  roles = ARRAY(SELECT DISTINCT unnest("tenancy"."organizations".roles || EXCLUDED.roles)),
  postal_address = COALESCE("tenancy"."organizations".postal_address, EXCLUDED.postal_address),
  branding = CASE WHEN "tenancy"."organizations".branding = '{}'::jsonb THEN EXCLUDED.branding ELSE "tenancy"."organizations".branding END,
  regulator_licence_no = COALESCE("tenancy"."organizations".regulator_licence_no, EXCLUDED.regulator_licence_no),
  updated_at = now();

INSERT INTO "tenancy"."organizations" (id, display_name, legal_name, legal_form, kennitala, country_code, default_currency, status, roles, postal_address, branding, regulator_licence_no, created_at, updated_at)
VALUES (gen_random_uuid(), 'HS Veitur', 'HS Veitur hf.', 'hf', '4312080590', 'IS', 'ISK', 'active', '{dso}', '{"street":"Brekkustígur 36","postalCode":"260","city":"Reykjanesbær","countryCode":"IS"}'::jsonb, '{"rail_class":"dso","contacts":{"phone_main":"422 5200","email_main":"hsveitur@hsveitur.is","website":"https://www.hsveitur.is"}}'::jsonb, NULL, now(), now())
ON CONFLICT (kennitala) DO UPDATE SET
  legal_name = EXCLUDED.legal_name,
  legal_form = COALESCE("tenancy"."organizations".legal_form, EXCLUDED.legal_form),
  roles = ARRAY(SELECT DISTINCT unnest("tenancy"."organizations".roles || EXCLUDED.roles)),
  postal_address = COALESCE("tenancy"."organizations".postal_address, EXCLUDED.postal_address),
  branding = CASE WHEN "tenancy"."organizations".branding = '{}'::jsonb THEN EXCLUDED.branding ELSE "tenancy"."organizations".branding END,
  regulator_licence_no = COALESCE("tenancy"."organizations".regulator_licence_no, EXCLUDED.regulator_licence_no),
  updated_at = now();

INSERT INTO "tenancy"."organizations" (id, display_name, legal_name, legal_form, kennitala, country_code, default_currency, status, roles, postal_address, branding, regulator_licence_no, created_at, updated_at)
VALUES (gen_random_uuid(), 'Norðurorka', 'Norðurorka hf.', 'hf', '5509780169', 'IS', 'ISK', 'active', '{dso}', '{"street":"Rangárvellir 5","postalCode":"603","city":"Akureyri","countryCode":"IS"}'::jsonb, '{"rail_class":"multi","contacts":{"phone_main":"460 1300","email_main":"nordurorka@no.is","website":"https://www.no.is"}}'::jsonb, NULL, now(), now())
ON CONFLICT (kennitala) DO UPDATE SET
  legal_name = EXCLUDED.legal_name,
  legal_form = COALESCE("tenancy"."organizations".legal_form, EXCLUDED.legal_form),
  roles = ARRAY(SELECT DISTINCT unnest("tenancy"."organizations".roles || EXCLUDED.roles)),
  postal_address = COALESCE("tenancy"."organizations".postal_address, EXCLUDED.postal_address),
  branding = CASE WHEN "tenancy"."organizations".branding = '{}'::jsonb THEN EXCLUDED.branding ELSE "tenancy"."organizations".branding END,
  regulator_licence_no = COALESCE("tenancy"."organizations".regulator_licence_no, EXCLUDED.regulator_licence_no),
  updated_at = now();