-- Additive recovery traversal state only. Prepared locally; NOT applied to Neon.
-- The first enabled selection creates id=1 inside its transaction.
CREATE TABLE "assets"."lifecycle_recovery_cursor" (
	"id" integer PRIMARY KEY NOT NULL,
	"after_device_id" uuid,
	CONSTRAINT "lifecycle_recovery_cursor_singleton" CHECK ("assets"."lifecycle_recovery_cursor"."id" = 1)
);
