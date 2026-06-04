import { ConceptViewer } from "./concept-viewer";

export const metadata = { title: "Design concepts" };

// Full-bleed: the viewer owns the whole content area (top nav bar +
// full-height iframe). Admin-gated by the (app) layout.
export default function ConceptsPage() {
  return <ConceptViewer />;
}
