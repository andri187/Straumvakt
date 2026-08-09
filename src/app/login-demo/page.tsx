import { ArrowRight, Building2, ShieldCheck, UserRound, Zap } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { postLoginHref, postLoginPersonas } from "../app/post-login-data";
import "../app/post-login.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Local workspace entry" };

const icons = { admin: ShieldCheck, org: Building2, driver: UserRound };

export default function LoginDemoPage() {
  if (process.env.STRAUMVAKT_LOCAL_PRODUCT_PREVIEW !== "1") notFound();

  return (
    <main className="pl-login-root">
      <header className="pl-login-topbar">
        <Link className="pl-login-brand" href={"/login-demo" as Route}>
          <span><Zap size={20} /></span>
          <strong>Straumvakt</strong>
        </Link>
        <span className="pl-local-badge">Local visual demo</span>
      </header>

      <section className="pl-login-panel" aria-labelledby="demo-entry-title">
        <div className="pl-login-copy">
          <p>Workspace entry</p>
          <h1 id="demo-entry-title">Choose a demo role</h1>
          <span>No authentication occurs. Each option opens a local fixture workspace so the post-login product can be reviewed safely.</span>
        </div>

        <div className="pl-role-list" aria-label="Available demo roles">
          {postLoginPersonas.map((persona) => {
            const Icon = icons[persona.routeId];
            return (
              <Link key={persona.routeId} href={postLoginHref(persona) as Route}>
                <Icon size={21} />
                <span><strong>{persona.label}</strong><small>{persona.contextValue}</small></span>
                <ArrowRight size={18} />
              </Link>
            );
          })}
        </div>

        <div className="pl-login-fixture">
          <strong>Fixture identities</strong>
          <p>{postLoginPersonas.map((persona) => persona.account).join(" / ")}</p>
          <span>Reserved `.test` addresses only. No password is accepted or transmitted.</span>
        </div>
      </section>

      <footer className="pl-login-footer">
        <span>Post-login visual review</span>
        <Link href={"/visual?family=service" as Route}>Future Service concept</Link>
      </footer>
    </main>
  );
}
