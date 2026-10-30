// Homepage and sign-in for the CPO test workspace: the original car-artwork
// composition, with the obsolete authentication code replaced by a plain form
// posted to the server. The username and password are checked on the server
// only; nothing is compared, stored or remembered in the browser.

import type { Metadata } from "next";
import { SHELL_LOGIN_API } from "@/lib/cpo-shell-policy";
import "../landing.css";
import "./signin.css";

export const metadata: Metadata = { title: "Innskráning" };
export const dynamic = "force-dynamic";

const MESSAGES: Record<string, { is: string; en: string }> = {
  invalid: {
    is: "Rangt notandanafn eða lykilorð.",
    en: "Wrong username or password.",
  },
  unavailable: {
    is: "Innskráning er ekki í boði núna. Reyndu aftur síðar.",
    en: "Sign-in is not available right now. Please try again later.",
  },
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[] }>;
}) {
  const { error } = await searchParams;
  const code = Array.isArray(error) ? error[0] : error;
  const message = code ? MESSAGES[code] : undefined;

  return (
    <main className="straumvakt-landing" aria-label="Straumvakt">
      <section className="lockup" aria-label="Straumvakt">
        <picture>
          <source srcSet="/landing/straumvakt-car.avif" type="image/avif" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className="mark"
            src="/landing/straumvakt-car.webp"
            alt=""
            width={1312}
            height={578}
            fetchPriority="high"
          />
        </picture>
        <h1>Straumvakt</h1>
        <p className="tagline">Umsjón. Yfirsýn. Rekstur.</p>

        <section className="auth" aria-label="Innskráning">
          <div className="tabs" role="tablist" aria-label="Leið til innskráningar">
            <button
              type="button"
              role="tab"
              id="tab-password"
              aria-selected="true"
              aria-controls="password-login"
              className="tab active"
            >
              Innskráning
            </button>
            <button
              type="button"
              role="tab"
              id="tab-audkenni"
              aria-selected="false"
              aria-disabled="true"
              aria-describedby="unavailable-note"
              disabled
              className="tab"
            >
              Auðkenni
            </button>
          </div>

          <form
            id="password-login"
            className="panel active"
            method="post"
            action={SHELL_LOGIN_API}
            aria-labelledby="tab-password"
          >
            <label>
              <span>
                Notandanafn <em>Username</em>
              </span>
              <input
                type="text"
                name="username"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                required
                autoFocus={Boolean(message)}
                aria-invalid={message ? true : undefined}
                aria-describedby={message ? "login-error" : undefined}
              />
            </label>
            <label>
              <span>
                Lykilorð <em>Password</em>
              </span>
              <input
                type="password"
                name="password"
                autoComplete="current-password"
                required
                aria-invalid={message ? true : undefined}
                aria-describedby={message ? "login-error" : undefined}
              />
            </label>
            {message ? (
              <p id="login-error" className="register-message login-error" role="alert">
                {message.is}
                <span lang="en">{message.en}</span>
              </p>
            ) : null}
            <button className="button primary" type="submit">
              Skrá inn
            </button>
          </form>

          <p id="unavailable-note" className="register-message" lang="is">
            Auðkenni og nýskráning eru ekki í boði enn.
            <span lang="en">Electronic ID and registration are not available yet.</span>
          </p>
        </section>
      </section>
    </main>
  );
}
