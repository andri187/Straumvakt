-- CreateEnum
CREATE TYPE "identity"."DriverInviteSecurity" AS ENUM ('none', 'password_key', 'allow_term');

-- CreateEnum
CREATE TYPE "tenancy"."OrganizationKind" AS ENUM ('multi_dwelling', 'company');

-- CreateEnum
CREATE TYPE "tenancy"."HostApplicationStatus" AS ENUM ('new', 'in_review', 'offered', 'won', 'lost');

-- CreateEnum
CREATE TYPE "billing"."BillObjectKind" AS ENUM ('apartment', 'unit', 'stall', 'company', 'department', 'cost_center', 'other');

-- CreateEnum
CREATE TYPE "billing"."BillObjectStatus" AS ENUM ('active', 'inactive');

-- AlterEnum
ALTER TYPE "identity"."UserTokenKind" ADD VALUE 'driver';

-- AlterEnum
ALTER TYPE "tenancy"."MembershipRole" ADD VALUE 'host_admin';

-- AlterTable
ALTER TABLE "identity"."user_tokens" ADD COLUMN     "bill_object_id" UUID,
ADD COLUMN     "driver_group_id" UUID,
ADD COLUMN     "max_redemptions" INTEGER,
ADD COLUMN     "password_key_hash" TEXT,
ADD COLUMN     "security" "identity"."DriverInviteSecurity" NOT NULL DEFAULT 'none';

-- AlterTable
ALTER TABLE "tenancy"."organizations" ADD COLUMN     "kind" "tenancy"."OrganizationKind";

-- CreateTable
CREATE TABLE "tenancy"."host_applications" (
    "id" UUID NOT NULL,
    "company_name" TEXT NOT NULL,
    "contact_name" TEXT NOT NULL,
    "contact_email" TEXT NOT NULL,
    "contact_phone" TEXT,
    "kennitala" TEXT,
    "site_type" "tenancy"."OrganizationKind" NOT NULL,
    "sites" JSONB NOT NULL DEFAULT '[]',
    "description" TEXT,
    "status" "tenancy"."HostApplicationStatus" NOT NULL DEFAULT 'new',
    "converted_org_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "host_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."bill_objects" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "installation_id" UUID,
    "kind" "billing"."BillObjectKind" NOT NULL,
    "label" TEXT NOT NULL,
    "parent_id" UUID,
    "owner_user_id" UUID,
    "owner_org_id" UUID,
    "status" "billing"."BillObjectStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "bill_objects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."bill_object_members" (
    "id" UUID NOT NULL,
    "bill_object_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "effective_from" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effective_to" TIMESTAMPTZ(6),

    CONSTRAINT "bill_object_members_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "host_applications_status_idx" ON "tenancy"."host_applications"("status");

-- CreateIndex
CREATE INDEX "bill_objects_org_id_installation_id_idx" ON "billing"."bill_objects"("org_id", "installation_id");

-- CreateIndex
CREATE INDEX "bill_objects_owner_user_id_idx" ON "billing"."bill_objects"("owner_user_id");

-- CreateIndex
CREATE INDEX "bill_objects_owner_org_id_idx" ON "billing"."bill_objects"("owner_org_id");

-- CreateIndex
CREATE INDEX "bill_object_members_user_id_effective_to_idx" ON "billing"."bill_object_members"("user_id", "effective_to");

-- CreateIndex
CREATE INDEX "bill_object_members_bill_object_id_idx" ON "billing"."bill_object_members"("bill_object_id");

-- AddForeignKey
ALTER TABLE "identity"."user_tokens" ADD CONSTRAINT "user_tokens_driver_group_id_fkey" FOREIGN KEY ("driver_group_id") REFERENCES "agreements"."driver_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identity"."user_tokens" ADD CONSTRAINT "user_tokens_bill_object_id_fkey" FOREIGN KEY ("bill_object_id") REFERENCES "billing"."bill_objects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenancy"."host_applications" ADD CONSTRAINT "host_applications_converted_org_id_fkey" FOREIGN KEY ("converted_org_id") REFERENCES "tenancy"."organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."bill_objects" ADD CONSTRAINT "bill_objects_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "tenancy"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."bill_objects" ADD CONSTRAINT "bill_objects_installation_id_fkey" FOREIGN KEY ("installation_id") REFERENCES "properties"."installations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."bill_objects" ADD CONSTRAINT "bill_objects_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "identity"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."bill_objects" ADD CONSTRAINT "bill_objects_owner_org_id_fkey" FOREIGN KEY ("owner_org_id") REFERENCES "tenancy"."organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."bill_objects" ADD CONSTRAINT "bill_objects_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "billing"."bill_objects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."bill_object_members" ADD CONSTRAINT "bill_object_members_bill_object_id_fkey" FOREIGN KEY ("bill_object_id") REFERENCES "billing"."bill_objects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."bill_object_members" ADD CONSTRAINT "bill_object_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ADR 0029 — a bill_object resolves to AT MOST one owner (ownerUserId / ownerOrgId).
-- App layer enforces exactly-one for billable (non-structural) objects.
ALTER TABLE "billing"."bill_objects" ADD CONSTRAINT "bill_objects_owner_at_most_one" CHECK (num_nonnulls("owner_user_id", "owner_org_id") <= 1);
