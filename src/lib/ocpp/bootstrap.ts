/**
 * Module-load bootstrap for the OCPP subsystem.
 *
 * Importing this module wires projection handlers into the events
 * repository dispatcher. Safe to import from multiple places —
 * registration is idempotent.
 *
 * The ingest route handler imports this once; tests that want real
 * projection dispatch also import it.
 */
import { registerAllProjections } from "./projections";

registerAllProjections();
