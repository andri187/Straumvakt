import { describe, expect, it } from "vitest";
import { MIN_PASSWORD_LENGTH, effectiveAllowanceAmps } from "./model";
import { EDITOR_MIN_PASSWORD, allowanceText, deviceTypeChoice, deviceTypeValue, isDirty, isGuardedClick, parseAmps, passwordAction, passwordPendingForDraft, passwordProblem, zeroIfBlank } from "./editor-model";

describe("unknown capacity is not a measured zero", () => {
  it("shows an empty rating anywhere on the path as not specified, never as 0 A", () => {
    expect(allowanceText([null])).toBe("Capacity not specified");
    expect(allowanceText([32, null, 63])).toBe("Capacity not specified");
    expect(allowanceText([63, 32, 40])).toBe("32 A");
  });

  it("keeps a deliberately entered zero distinct from an empty field", () => {
    expect(parseAmps("")).toEqual({ value: null, bad: false });
    expect(parseAmps("0")).toEqual({ value: 0, bad: false });
    expect(allowanceText([63, 0])).toBe("0 A");
    expect(allowanceText([parseAmps("").value])).not.toBe(allowanceText([parseAmps("0").value]));
  });

  it("rejects anything that is not a whole number of amps", () => {
    for (const bad of ["abc", "1.5", "-3", "12345", "3 2"]) expect(parseAmps(bad).bad).toBe(true);
    expect(parseAmps(" 16 ")).toEqual({ value: 16, bad: false });
  });

  it("leaves the underlying conservative rule alone: unknown still permits no current", () => {
    expect(effectiveAllowanceAmps([32, null])).toEqual({ amps: 0, basis: "unknown" });
    expect(effectiveAllowanceAmps([32, 0])).toEqual({ amps: 0, basis: "entered" });
  });
});

describe("the one password field", () => {
  it("on a NEW installation, empty is an explicit no-password and text sets one", () => {
    expect(passwordAction({ isNew: true, value: "", removing: false })).toEqual({ action: "none" });
    expect(passwordAction({ isNew: true, value: "correct horse battery", removing: false })).toEqual({ action: "set", value: "correct horse battery" });
  });

  it("on an EXISTING installation, empty keeps the stored setting; only the explicit removal switches it off", () => {
    expect(passwordAction({ isNew: false, value: "", removing: false })).toEqual({ action: "keep" });
    expect(passwordAction({ isNew: false, value: "", removing: true })).toEqual({ action: "none" });
    expect(passwordAction({ isNew: false, value: "a brand new password", removing: false })).toEqual({ action: "set", value: "a brand new password" });
  });

  it("text always wins over a pending removal, so a replacement is never turned into removal", () => {
    expect(passwordAction({ isNew: false, value: "a brand new password", removing: true })).toEqual({ action: "set", value: "a brand new password" });
  });

  it("enforces the same minimum as the server, and only when something was typed", () => {
    expect(EDITOR_MIN_PASSWORD).toBe(MIN_PASSWORD_LENGTH);
    expect(passwordProblem({ value: "", pending: false })).toBeNull();
    expect(passwordProblem({ value: "short", pending: false })).toMatch(/12/);
    expect(passwordProblem({ value: "x".repeat(12), pending: false })).toBeNull();
  });

  it("a resumed draft that had a password makes the operator re-enter it instead of quietly meaning none", () => {
    expect(passwordProblem({ value: "", pending: true })).toMatch(/Enter it again/);
    expect(passwordProblem({ value: "x".repeat(12), pending: true })).toBeNull();
  });

  it("a draft keeps only the fact that a password was typed or is still owed, never the value", () => {
    expect(passwordPendingForDraft({ value: "", pending: false })).toBe(false);
    expect(passwordPendingForDraft({ value: "typed password!", pending: false })).toBe(true);
    expect(passwordPendingForDraft({ value: "", pending: true })).toBe(true);
    expect(typeof passwordPendingForDraft({ value: "typed password!", pending: false })).toBe("boolean");
  });
});

describe("unsaved work", () => {
  it("is any difference from the last saved state, or any typed password", () => {
    expect(isDirty({ baseline: "a", current: "a", passwordTyped: false })).toBe(false);
    expect(isDirty({ baseline: "a", current: "b", passwordTyped: false })).toBe(true);
    expect(isDirty({ baseline: "a", current: "a", passwordTyped: true })).toBe(true);
  });
});

describe("which clicks the leave guard stops", () => {
  const here = { origin: "https://x.test", pathname: "/cpo/installations", search: "?new=1" };
  const click = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, defaultPrevented: false };
  const link = (href: string, over: Partial<{ target: string; download: boolean }> = {}) => ({ target: "", download: false, href, ...over });

  it("stops a same-site link to another page, such as All installations", () => {
    expect(isGuardedClick(click, link("/cpo/installations"), here)).toBe(true);
    expect(isGuardedClick(click, link("https://x.test/cpo/settings"), here)).toBe(true);
  });

  it("leaves alone the page itself, other sites, new-tab opens and downloads", () => {
    expect(isGuardedClick(click, link("/cpo/installations?new=1"), here)).toBe(false);
    expect(isGuardedClick(click, link("https://elsewhere.test/"), here)).toBe(false);
    expect(isGuardedClick({ ...click, ctrlKey: true }, link("/cpo/settings"), here)).toBe(false);
    expect(isGuardedClick({ ...click, button: 1 }, link("/cpo/settings"), here)).toBe(false);
    expect(isGuardedClick(click, link("/cpo/settings", { target: "_blank" }), here)).toBe(false);
    expect(isGuardedClick(click, link("/file.csv", { download: true }), here)).toBe(false);
    expect(isGuardedClick({ ...click, defaultPrevented: true }, link("/cpo/settings"), here)).toBe(false);
  });
});

describe('main protective device type', () => {
  it('round-trips the broad categories and leaves "not specified" as nothing', () => {
    for (const v of ['', 'Circuit breaker', 'Fuse', 'Other']) {
      const c = deviceTypeChoice(v);
      expect(deviceTypeValue(c.kind, c.custom)).toBe(v);
    }
    expect(deviceTypeChoice('')).toEqual({ kind: '', custom: '' });
    expect(deviceTypeChoice('Circuit breaker').kind).toBe('breaker');
    expect(deviceTypeChoice('Fuse').kind).toBe('fuse');
  });

  it('keeps existing custom text word for word, whatever its case, under Other', () => {
    for (const v of ['main breaker', 'circuit breaker', 'NH fuse 100A', 'Fuse (gG)']) {
      const c = deviceTypeChoice(v);
      expect(c.kind).toBe('other');
      expect(deviceTypeValue(c.kind, c.custom)).toBe(v);
    }
  });

  it('stores a typed description for Other, and the word Other when none is typed', () => {
    expect(deviceTypeValue('other', '  Isolator switch ')).toBe('Isolator switch');
    expect(deviceTypeValue('other', '')).toBe('Other');
    expect(deviceTypeValue('breaker', 'ignored')).toBe('Circuit breaker');
  });
});

describe('new rating fields start at 0', () => {
  it('puts a cleared NEW field back to 0, but never touches a field that did not start as the default', () => {
    expect(zeroIfBlank('', true)).toBe('0');
    expect(zeroIfBlank('  ', true)).toBe('0');
    expect(zeroIfBlank('16', true)).toBe('16');
    expect(zeroIfBlank('0', true)).toBe('0');
    expect(zeroIfBlank('', false)).toBe('');
    expect(zeroIfBlank('25', false)).toBe('25');
  });
});
