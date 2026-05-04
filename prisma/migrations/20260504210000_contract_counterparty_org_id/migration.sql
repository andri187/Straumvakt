-- Sprint 8.14 — bilateral contract counterparty link.
--
-- Adds nullable counterparty_org_id to billing.contracts so a single
-- row can represent the Straumvakt-↔-customer arrangement (instead
-- of two mirrored rows we created in 8.12). FK to organizations,
-- ON DELETE SET NULL so dropping a counterparty org doesn't cascade
-- the contract.

ALTER TABLE "billing"."contracts"
  ADD COLUMN "counterparty_org_id" UUID;

ALTER TABLE "billing"."contracts"
  ADD CONSTRAINT "contracts_counterparty_org_id_fkey"
  FOREIGN KEY ("counterparty_org_id") REFERENCES "tenancy"."organizations"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "contracts_counterparty_org_id_idx"
  ON "billing"."contracts"("counterparty_org_id");
