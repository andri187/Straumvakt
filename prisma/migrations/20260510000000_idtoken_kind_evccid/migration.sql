-- Sprint 9 / 2026-05-10 — Add 'evccid' to identity.IdTokenKind.
--
-- A "VID RFID" token whose value IS an EV's EVCCID / EV-PLC-MAC,
-- captured via the Autocharge link-layer pipeline (ADR 0021). The
-- car itself is the credential — no operator-issued card.
--
-- Additive only (Rule 4): adds an enum value, no renames or drops.

ALTER TYPE "identity"."IdTokenKind" ADD VALUE IF NOT EXISTS 'evccid';
