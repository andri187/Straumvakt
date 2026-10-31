import { describe, expect, it } from "vitest";
import {
  DEFAULT_LIFETIME_SECONDS,
  MAX_COOKIE_VALUE_LENGTH,
  MAX_LIFETIME_SECONDS,
  VENDOR_COOKIE_PATH,
  ConnectionError,
  clearConnectionCookie,
  connectionCookie,
  connectionCookieName,
  openConnection,
  readCookie,
  remainingWaitSeconds,
  sealConnection,
  waitCookie,
  waitCookieName,
  type ConnectionBinding,
} from "./vendor-connection";

const SECRET = "test-only-signing-secret-0123456789abcdef";
const BINDING: ConnectionBinding = { vendor: "easee", orgId: "11111111-1111-4111-8111-111111111111", shellSessionToken: "payload-a.signature-a" };
const TOKEN = "easee-access-token-never-visible";
const NOW = 1_800_000_000_000;

const seal = (over: Partial<{ accessToken: string; vendorExpiresInSeconds: number | null }> = {}, binding = BINDING, secret = SECRET, now = NOW) =>
  sealConnection({ accessToken: TOKEN, vendorExpiresInSeconds: 3600, ...over }, binding, secret, now);

describe("sealing a vendor connection", () => {
  it("round-trips the token for exactly the same binding, and the cookie value does not contain it", async () => {
    const sealed = await seal();
    expect(sealed.value).not.toContain(TOKEN);
    expect(sealed.value).not.toContain(Buffer.from(TOKEN).toString("base64").replace(/=+$/, ""));
    const opened = await openConnection(sealed.value, BINDING, SECRET, NOW + 1000);
    expect(opened).toEqual({ ok: true, accessToken: TOKEN, expiresAt: sealed.expiresAt });
  });

  it("caps the lifetime at 15 minutes however long the vendor's token lasts, and uses 10 minutes when the vendor did not say", async () => {
    const long = await seal({ vendorExpiresInSeconds: 86_400 });
    expect(long.maxAgeSeconds).toBeLessThanOrEqual(MAX_LIFETIME_SECONDS);
    expect(long.expiresAt - NOW).toBeLessThanOrEqual(MAX_LIFETIME_SECONDS * 1000);
    const short = await seal({ vendorExpiresInSeconds: 120 });
    expect(short.expiresAt - NOW).toBeLessThanOrEqual(120_000);
    const unstated = await seal({ vendorExpiresInSeconds: null });
    expect(unstated.expiresAt - NOW).toBeLessThanOrEqual(DEFAULT_LIFETIME_SECONDS * 1000);
    expect(unstated.expiresAt - NOW).toBeGreaterThan((DEFAULT_LIFETIME_SECONDS - 2) * 1000);
  });

  it("produces a different value each time (fresh IV) but opens both", async () => {
    const a = await seal();
    const b = await seal();
    expect(a.value).not.toBe(b.value);
    expect((await openConnection(a.value, BINDING, SECRET, NOW)).ok).toBe(true);
    expect((await openConnection(b.value, BINDING, SECRET, NOW)).ok).toBe(true);
  });

  it("refuses a token that is about to expire, and one too large for a cookie, and stores nothing in either case", async () => {
    await expect(seal({ vendorExpiresInSeconds: 5 })).rejects.toMatchObject({ code: "too_short" });
    await expect(seal({ accessToken: "x".repeat(4000) })).rejects.toBeInstanceOf(ConnectionError);
    await expect(seal({ accessToken: "x".repeat(4000) })).rejects.toMatchObject({ code: "too_large" });
    // A realistic token fits comfortably; the limit is on the whole value, never silently truncated.
    const fits = await seal({ accessToken: "y".repeat(1500) });
    expect(fits.value.length).toBeLessThanOrEqual(MAX_COOKIE_VALUE_LENGTH);
    expect((await openConnection(fits.value, BINDING, SECRET, NOW)).ok).toBe(true);
  });

  it("refuses an invalid vendor name and a missing secret", async () => {
    await expect(seal({}, { ...BINDING, vendor: "Not A Vendor" })).rejects.toMatchObject({ code: "bad_vendor" });
    await expect(seal({}, BINDING, "")).rejects.toMatchObject({ code: "no_secret" });
  });
});

describe("opening a vendor connection", () => {
  it("is not an opening at all without a value, and is expired after its time, even when untouched", async () => {
    expect(await openConnection(undefined, BINDING, SECRET, NOW)).toEqual({ ok: false, reason: "missing" });
    expect(await openConnection("", BINDING, SECRET, NOW)).toEqual({ ok: false, reason: "missing" });
    const sealed = await seal();
    expect(await openConnection(sealed.value, BINDING, SECRET, sealed.expiresAt)).toEqual({ ok: false, reason: "expired" });
    expect(await openConnection(sealed.value, BINDING, SECRET, sealed.expiresAt + 60_000)).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects another vendor, CPO, shell session or signing secret", async () => {
    const sealed = await seal();
    const open = (b: ConnectionBinding, secret = SECRET) => openConnection(sealed.value, b, secret, NOW + 1000);
    expect(await open({ ...BINDING, vendor: "zaptec" })).toEqual({ ok: false, reason: "rejected" });
    expect(await open({ ...BINDING, orgId: "22222222-2222-4222-8222-222222222222" })).toEqual({ ok: false, reason: "rejected" });
    // A re-login (or logout and login) produces a different shell session token: the old connection is dead.
    expect(await open({ ...BINDING, shellSessionToken: "payload-b.signature-b" })).toEqual({ ok: false, reason: "rejected" });
    expect(await open(BINDING, "a-different-signing-secret-0123456789abcdef")).toEqual({ ok: false, reason: "rejected" });
    expect((await open(BINDING)).ok).toBe(true);
  });

  it("rejects tampering with the ciphertext, the IV or the expiry, and damaged values", async () => {
    // A 5-minute connection, so that extending its expiry by two minutes stays inside the cap and only authentication stops it.
    const sealed = await seal({ vendorExpiresInSeconds: 300 });
    const [format, exp, iv, ct] = sealed.value.split(".");
    const flip = (s: string) => s.slice(0, 5) + (s[5] === "A" ? "B" : "A") + s.slice(6);
    const open = (value: string) => openConnection(value, BINDING, SECRET, NOW + 1000);
    expect(await open([format, exp, iv, flip(ct)].join("."))).toEqual({ ok: false, reason: "rejected" });
    expect(await open([format, exp, flip(iv), ct].join("."))).toEqual({ ok: false, reason: "rejected" });
    // Extending the expiry (still inside the cap) changes the authenticated data, so it cannot be done by editing the value.
    expect(await open([format, String(Number(exp) + 120), iv, ct].join("."))).toEqual({ ok: false, reason: "rejected" });
    // An expiry far beyond the cap was never produced by sealConnection.
    expect(await open([format, String(Number(exp) + 86_400), iv, ct].join("."))).toEqual({ ok: false, reason: "malformed" });
    expect(await open([format, exp, iv].join("."))).toEqual({ ok: false, reason: "malformed" });
    expect(await open(["2", exp, iv, ct].join("."))).toEqual({ ok: false, reason: "malformed" });
    expect(await open("not-a-connection")).toEqual({ ok: false, reason: "malformed" });
    expect(await open([format, exp, "!!!", "???"].join("."))).toEqual({ ok: false, reason: "rejected" });
  });
});

describe("cookies", () => {
  const URL_HTTPS = "https://shell.example.test/api/cpo/installations";

  it("is HttpOnly, SameSite=Strict and scoped to the one endpoint that reads it, Secure on HTTPS", async () => {
    const sealed = await seal();
    const https = connectionCookie("easee", sealed, URL_HTTPS);
    expect(https).toContain(`${connectionCookieName("easee")}=${sealed.value}`);
    expect(https).toContain(`Path=${VENDOR_COOKIE_PATH}`);
    expect(https).toContain("HttpOnly");
    expect(https).toContain("SameSite=Strict");
    expect(https).toContain("Secure");
    expect(https).not.toMatch(/Domain=/i);
    expect(https).toMatch(/Max-Age=\d+/);
    // Plain-HTTP loopback (local development) cannot carry Secure.
    expect(connectionCookie("easee", sealed, "http://127.0.0.1:3000/api/cpo/installations")).not.toContain("Secure");
  });

  it("clears with Max-Age=0 and an empty value", () => {
    const cleared = clearConnectionCookie("easee", URL_HTTPS);
    expect(cleared).toContain(`${connectionCookieName("easee")}=;`);
    expect(cleared).toContain("Max-Age=0");
    expect(cleared).toContain("HttpOnly");
  });

  it("reads one named cookie out of a header and nothing else", () => {
    const header = "a=1; straumvakt_vc_easee=abc.def; b=2";
    expect(readCookie(header, "straumvakt_vc_easee")).toBe("abc.def");
    expect(readCookie(header, "straumvakt_vc_zaptec")).toBeUndefined();
    expect(readCookie(null, "a")).toBeUndefined();
    expect(readCookie("garbage", "garbage")).toBeUndefined();
  });

  it("remembers a vendor's wait in the browser, per vendor, and ignores a spent or implausible one", () => {
    const set = waitCookie("easee", 90, URL_HTTPS, NOW);
    expect(set).toContain("Max-Age=90");
    expect(set).toContain("HttpOnly");
    const value = set.split(";")[0].split("=")[1];
    const header = `${waitCookieName("easee")}=${value}`;
    expect(remainingWaitSeconds(header, "easee", NOW + 30_000)).toBe(60);
    expect(remainingWaitSeconds(header, "zaptec", NOW + 30_000)).toBe(0);
    expect(remainingWaitSeconds(header, "easee", NOW + 90_000)).toBe(0);
    expect(remainingWaitSeconds(`${waitCookieName("easee")}=${NOW + 10 * 86_400_000}`, "easee", NOW)).toBe(0);
    expect(remainingWaitSeconds(`${waitCookieName("easee")}=soon`, "easee", NOW)).toBe(0);
    expect(remainingWaitSeconds(undefined, "easee", NOW)).toBe(0);
  });
});
