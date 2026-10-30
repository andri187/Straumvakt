// Login and logout handlers for the CPO test shell.
//
// Plain Request/Response functions (no next/headers) so they can be tested
// directly. The route files under src/app/api/shell/ are one-line wrappers.

import {
  SHELL_HOME,
  SHELL_SIGN_IN,
} from "@/lib/cpo-shell-policy";
import {
  createShellSession,
  readShellConfig,
  shellClearCookieHeader,
  shellCookieHeader,
  verifyShellCredentials,
  type ShellEnv,
} from "@/lib/cpo-shell-session";

const MAX_BODY_BYTES = 4096;

/**
 * The shell is same-origin only. Browsers attach Origin to every POST, so a
 * cross-site form (which sends the cookie-less login or a logout) is
 * refused even though it needs no CORS preflight. Fallbacks, in order:
 * Sec-Fetch-Site, then Referer; a request carrying none of the three is not
 * a browser request and cannot be forged into a victim's session.
 */
export function isSameOriginRequest(request: Request): boolean {
  const requestOrigin = new URL(request.url).origin;
  const origin = request.headers.get("origin");
  if (origin !== null) return origin === requestOrigin;

  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite !== null) {
    return fetchSite === "same-origin" || fetchSite === "none";
  }

  const referer = request.headers.get("referer");
  if (referer !== null) {
    try {
      return new URL(referer).origin === requestOrigin;
    } catch {
      return false;
    }
  }
  return true;
}

function json(body: unknown, status: number, extra?: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      ...extra,
    },
  });
}

function redirect(requestUrl: string, path: string, setCookie?: string) {
  const headers = new Headers({
    location: new URL(path, requestUrl).toString(),
    "cache-control": "no-store",
  });
  if (setCookie) headers.append("set-cookie", setCookie);
  return new Response(null, { status: 303, headers });
}

async function readCredentials(
  request: Request,
): Promise<{ username: unknown; password: unknown; isForm: boolean } | null> {
  const type = request.headers.get("content-type")?.toLowerCase() ?? "";
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) return null;

  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return null;

  try {
    if (type.includes("application/x-www-form-urlencoded")) {
      const params = new URLSearchParams(text);
      return {
        username: params.get("username"),
        password: params.get("password"),
        isForm: true,
      };
    }
    if (type.includes("application/json")) {
      const parsed = JSON.parse(text) as Record<string, unknown> | null;
      return {
        username: parsed?.username,
        password: parsed?.password,
        isForm: false,
      };
    }
  } catch {
    return null;
  }
  return null;
}

export async function handleShellLogin(
  request: Request,
  env?: ShellEnv,
): Promise<Response> {
  if (request.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405, { allow: "POST" });
  }
  if (!isSameOriginRequest(request)) {
    return json({ error: "forbidden_origin" }, 403);
  }

  const credentials = await readCredentials(request);
  const isForm = credentials?.isForm ?? true;
  const fail = (code: "invalid" | "unavailable", status: number) =>
    isForm
      ? redirect(request.url, `${SHELL_SIGN_IN}?error=${code}`)
      : json({ error: code }, status);

  const config = readShellConfig(env);
  if (!config) return fail("unavailable", 503);
  if (!credentials) return fail("invalid", 400);

  const ok = await verifyShellCredentials(
    credentials.username,
    credentials.password,
    config,
  );
  if (!ok) return fail("invalid", 401);

  const token = await createShellSession(config);
  const cookie = shellCookieHeader(token, request.url);
  return isForm
    ? redirect(request.url, SHELL_HOME, cookie)
    : json({ ok: true }, 200, { "set-cookie": cookie });
}

export async function handleShellLogout(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405, { allow: "POST" });
  }
  if (!isSameOriginRequest(request)) {
    return json({ error: "forbidden_origin" }, 403);
  }
  return redirect(
    request.url,
    SHELL_SIGN_IN,
    shellClearCookieHeader(request.url),
  );
}
