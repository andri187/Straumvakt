"use client";

import { useState } from "react";
import "./landing.css";
import { apiFetch } from "@/lib/api-client";
import { driverLogin } from "@/app/driver/driver-auth";

type Tab = "audkenni" | "password";

export default function RootPage() {
  const [tab, setTab] = useState<Tab>("password");
  const [registerMessage, setRegisterMessage] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Front-page login for hosts + drivers. Try the host/admin (cookie) path
  // first; a 401 means "not a host/operator" — fall back to the driver
  // (bearer) path. Persona routing: operators land on /dashboard, host_admin
  // is redirected to /host by the (app) layout, drivers go to /driver.
  // (Straumvakt staff use the Admin button — same endpoint, env-secret creds.)
  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch("/api/admin/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (res.ok) {
        window.location.href = "/dashboard";
        return;
      }
      if (res.status === 401) {
        try {
          await driverLogin(email.trim(), password);
          window.location.href = "/driver";
          return;
        } catch {
          setError("Wrong email or password.");
          setLoading(false);
          return;
        }
      }
      setError("Login failed.");
      setLoading(false);
    } catch {
      setError("Could not reach the login service.");
      setLoading(false);
    }
  }

  return (
    <main className="straumvakt-landing" aria-label="Straumvakt">
      {/* Admin button = Straumvakt staff (env-secret credentials). Hosts and
          drivers log in via the form below. */}
      <a className="admin-link" href="/login" aria-label="Admin login">
        Admin
      </a>
      <section className="lockup" aria-label="Straumvakt">
        <picture>
          <source srcSet="/landing/straumvakt-car.avif" type="image/avif" />
          <source srcSet="/landing/straumvakt-car.webp" type="image/webp" />
          <img className="mark" src="/landing/straumvakt-car.png" alt="" />
        </picture>
        <h1>Straumvakt</h1>
        <p className="tagline">Umsjón. Yfirsýn. Rekstur.</p>
        <section className="auth" aria-label="Login">
          <div className="tabs" role="tablist" aria-label="Login method">
            <button
              type="button"
              role="tab"
              aria-selected={tab === "password"}
              aria-controls="password-login"
              className={`tab ${tab === "password" ? "active" : ""}`}
              onClick={() => setTab("password")}
            >
              Innskráning
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "audkenni"}
              aria-controls="audkenni-login"
              className={`tab ${tab === "audkenni" ? "active" : ""}`}
              onClick={() => setTab("audkenni")}
            >
              Auðkenni
            </button>
          </div>

          <form
            id="password-login"
            className={`panel ${tab === "password" ? "active" : ""}`}
            aria-label="Email and password login"
            onSubmit={handleLogin}
          >
            <label>
              <span>Netfang</span>
              <input
                type="text"
                name="username"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label>
              <span>Lykilorð</span>
              <input
                type="password"
                name="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            {error ? (
              <p
                className="register-message"
                role="alert"
                style={{ color: "#ff6b6b" }}
              >
                {error}
              </p>
            ) : null}
            <button className="button primary" type="submit" disabled={loading}>
              {loading ? "Skrái inn…" : "Skrá inn"}
            </button>
          </form>

          <form
            id="audkenni-login"
            className={`panel ${tab === "audkenni" ? "active" : ""}`}
            aria-label="Auðkenni mobile phone login"
            onSubmit={(e) => e.preventDefault()}
          >
            <label>
              <span>Símanúmer</span>
              <input
                type="tel"
                name="phone"
                autoComplete="tel"
                placeholder="+354"
              />
            </label>
            <button className="button primary" type="submit">
              Skrá inn með Auðkenni
            </button>
          </form>

          <button
            className="register-link"
            type="button"
            aria-controls="register-message"
            onClick={() =>
              setRegisterMessage(
                "Hafðu samband við hýsilinn þinn eða Straumvakt til að fá aðgang.",
              )
            }
          >
            Nýskráning
          </button>
          <p
            id="register-message"
            className="register-message"
            role="status"
            aria-live="polite"
          >
            {registerMessage}
          </p>
        </section>
      </section>
    </main>
  );
}
