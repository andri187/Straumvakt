import { ApplyForm } from "./apply-form";
import "./apply.css";

export const metadata = {
  title: "Apply · Straumvakt",
  description:
    "Bring EV charging to your building or company with Straumvakt. Tell us about your network and we'll be in touch.",
};

// Public route (straumvakt.org/apply). Lives OUTSIDE the admin (app)
// shell — no sidebar, no admin session. Allow-listed in middleware.ts
// via isPublicApplyPath. Renders the going-public RFQ funnel.
export default function ApplyPage() {
  return (
    <main className="straumvakt-apply" aria-label="Apply to Straumvakt">
      <a className="admin-link" href="/login" aria-label="Admin login">
        Admin
      </a>
      <div className="shell">
        <header className="intro">
          <p className="eyebrow">Straumvakt for hosts</p>
          <h1>Bring charging to your building</h1>
          <p>
            Straumvakt runs EV charging for húsfélög and companies across
            Iceland — access control, billing on your behalf, and a clear
            overview of every connector. Tell us about your network and a
            team member will get back to you.
          </p>
        </header>
        <ApplyForm />
      </div>
    </main>
  );
}
