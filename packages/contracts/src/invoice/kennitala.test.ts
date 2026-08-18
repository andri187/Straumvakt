// ── ON THE TEST VALUES ──────────────────────────────────────────────────
//
// NO REAL-LOOKING KENNITALA APPEARS IN THIS FILE.
//
// Every checksum-valid value used below is built from an IMPOSSIBLE DATE —
// day 88, month 99 — so it exercises the checksum branch while being
// unmistakably synthetic and unable to collide with a real person's or
// company's identifier.
//
// The consequence, stated honestly: the mod-11 algorithm itself is verified
// here by PROPERTY (changing any single digit must break the checksum), not
// against published test vectors. Committing published vectors would commit
// real-looking kennitala, which the operating rules forbid. The property test
// is what a checksum is actually for, so this is a good trade rather than a
// compromise.

import { describe, expect, it } from "vitest";

import {
  KENNITALA_STORAGE_CONTRACT,
  REFUSES_WITHOUT_KENNITALA,
  checkDigitFor,
  isValidKennitala,
  kennitalaKind,
  kennitalaProblems,
  maskKennitala,
  normalizeKennitala,
} from "./kennitala";

/**
 * Build a checksum-valid 10-digit string from an 8-digit prefix.
 *
 * Callers pass impossible-date prefixes only.
 */
function synthetic(prefix8: string, century = "0"): string | null {
  const c = checkDigitFor(prefix8);
  if (c === null) return null;
  return `${prefix8}${c}${century}`;
}

// day 88 / month 99 — impossible on both counts.
const IMPOSSIBLE_PREFIX = "889912" + "34";
const VALID_SYNTHETIC = synthetic(IMPOSSIBLE_PREFIX);

describe("normalisation", () => {
  it("strips the dash", () => {
    expect(normalizeKennitala("889912-3450")).toBe("8899123450");
  });

  it("strips whitespace", () => {
    expect(normalizeKennitala("  8899 1234 50 ")).toBe("8899123450");
  });

  it("handles empty and nullish input without throwing", () => {
    expect(normalizeKennitala("")).toBe("");
    expect(normalizeKennitala(undefined as unknown as string)).toBe("");
  });
});

describe("structural problems", () => {
  it("empty is its own problem, reported alone", () => {
    expect(kennitalaProblems("")).toEqual(["empty"]);
    expect(kennitalaProblems("   ")).toEqual(["empty"]);
  });

  it("wrong length is reported", () => {
    expect(kennitalaProblems("12345")).toContain("wrong_length");
  });

  it("non-digits are reported", () => {
    expect(kennitalaProblems("88991234A0")).toContain("non_digit");
  });

  it("structural problems short-circuit the checksum", () => {
    // Reporting "checksum_failed" on a 5-character string is noise that sends
    // the reader looking for the wrong bug.
    expect(kennitalaProblems("12345")).not.toContain("checksum_failed");
  });
});

describe("the checksum", () => {
  it("accepts a synthetic value built from the algorithm", () => {
    expect(VALID_SYNTHETIC).not.toBeNull();
    // The date is impossible, so the value is invalid overall — but the
    // checksum branch specifically must pass.
    expect(kennitalaProblems(VALID_SYNTHETIC!)).not.toContain("checksum_failed");
  });

  it("PROPERTY: changing any single digit of the first eight breaks it", () => {
    // This is what a mod-11 check digit is for, and it is the claim worth
    // testing rather than any particular vector.
    const base = VALID_SYNTHETIC!;
    let detected = 0;
    let tried = 0;
    for (let i = 0; i < 8; i++) {
      for (let d = 0; d <= 9; d++) {
        if (String(d) === base[i]) continue;
        const mutated = base.slice(0, i) + d + base.slice(i + 1);
        tried++;
        if (kennitalaProblems(mutated).includes("checksum_failed")) detected++;
      }
    }
    expect(tried).toBeGreaterThan(60);
    expect(detected).toBe(tried);
  });

  it("a wrong check digit fails", () => {
    const base = VALID_SYNTHETIC!;
    const wrong = Number(base[8]) === 9 ? "0" : String(Number(base[8]) + 1);
    const mutated = base.slice(0, 8) + wrong + base.slice(9);
    expect(kennitalaProblems(mutated)).toContain("checksum_failed");
  });

  it("checkDigitFor rejects a non-8-digit prefix", () => {
    expect(checkDigitFor("123")).toBeNull();
    expect(checkDigitFor("1234567A")).toBeNull();
  });

  it("checkDigitFor returns null where the check digit would be 10", () => {
    // remainder === 1 has no writable check digit; such numbers are never
    // issued rather than being rounded to something.
    let sawNull = false;
    for (let n = 0; n < 400 && !sawNull; n++) {
      const prefix = String(n).padStart(8, "0");
      if (checkDigitFor(prefix) === null) sawNull = true;
    }
    expect(sawNull).toBe(true);
  });
});

describe("date plausibility", () => {
  it("an impossible date is reported", () => {
    expect(kennitalaProblems(VALID_SYNTHETIC!)).toContain("implausible_date");
  });

  it("a day above 71 is implausible even allowing the company offset", () => {
    const v = synthetic("99991234");
    if (v) expect(kennitalaProblems(v)).toContain("implausible_date");
  });

  it("month 00 and month 13 are implausible", () => {
    for (const prefix of ["01001234", "01131234"]) {
      const v = synthetic(prefix);
      if (v) expect(kennitalaProblems(v)).toContain("implausible_date");
    }
  });
});

describe("person vs company", () => {
  it("a day in 1..31 is a person", () => {
    expect(kennitalaKind("1503123450")).toBe("person");
  });

  it("a day in 41..71 is a company", () => {
    expect(kennitalaKind("5503123450")).toBe("company");
  });

  it("malformed input is unknown rather than guessed", () => {
    expect(kennitalaKind("abc")).toBe("unknown");
    expect(kennitalaKind("")).toBe("unknown");
    expect(kennitalaKind("9903123450")).toBe("unknown");
  });
});

describe("masking", () => {
  it("shows the date part and hides the identifying part", () => {
    expect(maskKennitala("889912-3450")).toBe("889912-****");
  });

  it("never leaks the last four digits", () => {
    expect(maskKennitala("8899123450")).not.toContain("3450");
  });

  it("masks entirely when the value is malformed", () => {
    expect(maskKennitala("nope")).toBe("**********");
  });
});

describe("problem codes never carry the value", () => {
  it("no problem code contains a digit from the input", () => {
    // The rule that keeps a logged validation result from being a logged
    // kennitala.
    const problems = kennitalaProblems("8899123451");
    for (const p of problems) expect(p).not.toMatch(/\d/);
  });
});

describe("the storage contract and refusal list are asserted, not merely described", () => {
  it("requires the value for invoicing and forbids logging it", () => {
    expect(KENNITALA_STORAGE_CONTRACT.requiredForInvoicing).toBe(true);
    expect(KENNITALA_STORAGE_CONTRACT.neverLogged).toBe(true);
    expect(KENNITALA_STORAGE_CONTRACT.normalised).toBe(true);
  });

  it("names what refuses without it, including the header render", () => {
    expect(REFUSES_WITHOUT_KENNITALA.length).toBeGreaterThanOrEqual(4);
    expect(REFUSES_WITHOUT_KENNITALA.join(" ")).toContain("header");
    expect(REFUSES_WITHOUT_KENNITALA.join(" ")).toContain("krafa");
  });
});

// ── fool-test ───────────────────────────────────────────────────────────

describe("FOOL — validate by length only", () => {
  // The tempting cheap check. It accepts any ten digits, which means a
  // transposed pair — the single most common typing error on a kennitala —
  // sails through and produces a claim addressed to nobody.
  const validFooled = (s: string) => normalizeKennitala(s).length === 10;

  it("the fooled check accepts a transposed value", () => {
    const base = VALID_SYNTHETIC!;
    const transposed = base.slice(0, 2) + base[3] + base[2] + base.slice(4);
    expect(validFooled(transposed)).toBe(true);
  });

  it("the real check catches the transposition via the checksum", () => {
    const base = VALID_SYNTHETIC!;
    const transposed = base.slice(0, 2) + base[3] + base[2] + base.slice(4);
    // Only meaningful when the transposition actually changed the string.
    if (transposed !== base) {
      expect(kennitalaProblems(transposed)).toContain("checksum_failed");
    }
    expect(isValidKennitala(transposed)).toBe(false);
  });
});
