"use client";

import { useState } from "react";
import "./landing.css";

type Tab = "audkenni" | "password";

export default function RootPage() {
  const [tab, setTab] = useState<Tab>("audkenni");
  const [registerMessage, setRegisterMessage] = useState("");

  return (
    <main className="straumvakt-landing" aria-label="Straumvakt">
      {/* Option B live: straumvakt.org's app calls api.straumvakt.org (CORS +
          .straumvakt.org cookie), so login works on the brand domain itself. */}
      <a className="driver-link" href="/driver/login" aria-label="Driver login">
        Ökumaður
      </a>
      <a className="admin-link" href="/login" aria-label="Admin login">
        Admin
      </a>
      <section className="lockup" aria-label="Straumvakt">
        <picture>
          <source srcSet="/landing/straumvakt-car.avif" type="image/avif" />
          <source srcSet="/landing/straumvakt-car.webp" type="image/webp" />
          <img
            className="mark"
            src="/landing/straumvakt-car.png"
            alt=""
          />
        </picture>
        <h1>Straumvakt</h1>
        <p className="tagline">Umsjón. Yfirsýn. Rekstur.</p>
        <section className="auth" aria-label="Login">
          <div className="tabs" role="tablist" aria-label="Login method">
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
            <button
              type="button"
              role="tab"
              aria-selected={tab === "password"}
              aria-controls="password-login"
              className={`tab ${tab === "password" ? "active" : ""}`}
              onClick={() => setTab("password")}
            >
              User login
            </button>
          </div>

          <form
            id="audkenni-login"
            className={`panel ${tab === "audkenni" ? "active" : ""}`}
            aria-label="Auðkenni mobile phone login"
            onSubmit={(e) => e.preventDefault()}
          >
            <label>
              <span>Mobile phone</span>
              <input
                type="tel"
                name="phone"
                autoComplete="tel"
                placeholder="+354"
              />
            </label>
            <button className="button primary" type="submit">
              Login with Auðkenni
            </button>
          </form>

          <form
            id="password-login"
            className={`panel ${tab === "password" ? "active" : ""}`}
            aria-label="Username and password login"
            onSubmit={(e) => e.preventDefault()}
          >
            <label>
              <span>Username</span>
              <input type="text" name="username" autoComplete="username" />
            </label>
            <label>
              <span>Password</span>
              <input
                type="password"
                name="password"
                autoComplete="current-password"
              />
            </label>
            <button className="button primary" type="submit">
              Login
            </button>
          </form>

          <button
            className="register-link"
            type="button"
            aria-controls="register-message"
            onClick={() =>
              setRegisterMessage(
                "Registration is coming soon. Please contact your Straumvakt administrator for access.",
              )
            }
          >
            Register
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
