// The invoice rail vocabulary.
//
// Format-agnostic by construction: nothing in here knows whether the document
// will be rendered as a PDF, mapped to PEPPOL BIS Billing 3.0 / TS-236, or
// handed to a bank claim rail. That is the point — see
// docs/notes/2026-08-18-invoice-delivery-decision.md §5, which separates the
// reversible half of the delivery decision (the format) from the permanent
// half (numbering and header semantics, both of which live here).

export * from "./document";
export * from "./number";
export * from "./delivery";
export * from "./dunning";
export * from "./reconciliation";
export * from "./header";
export * from "./kennitala";
