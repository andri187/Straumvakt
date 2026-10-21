// Address search over the demo records — pure, offline, Icelandic-aware.
//
// Search has to work the way an Icelandic user actually types. People type
// "gardatorg" for Garðatorg and "thverholt" for Þverholt, because the
// keyboard is in the way or because they are on a phone. Folding the
// accented forms to their bare equivalents is not a nicety here; without it
// the demo appears broken to anyone typing quickly.
//
// This is a linear scan over a few dozen rows. That is the correct algorithm
// for this size, and the production replacement is a Postgres query against
// imported Staðfangaskrá — not a cleverer version of this.

import { DEMO_ADDRESSES, formatAddress, type HmsAddressRecord } from "./address-fixtures";

/**
 * Fold Icelandic characters to a plain-ASCII search key.
 *
 * þ→th and æ→ae are transliterations rather than accent-stripping, which is
 * why this is an explicit table instead of a normalize("NFD") call: NFD would
 * turn þ and æ into themselves and quietly fail to match "thverholt".
 */
const FOLD_MAP: Readonly<Record<string, string>> = {
  á: "a", à: "a", â: "a", ä: "a", å: "a",
  ð: "d",
  é: "e", è: "e", ê: "e", ë: "e",
  í: "i", ì: "i", î: "i", ï: "i",
  ó: "o", ò: "o", ô: "o", ö: "o", ø: "o",
  ú: "u", ù: "u", û: "u", ü: "u",
  ý: "y", ÿ: "y",
  þ: "th",
  æ: "ae",
  ç: "c",
  ñ: "n",
};

export function foldIcelandic(input: string): string {
  let out = "";
  for (const char of input.toLowerCase()) {
    out += FOLD_MAP[char] ?? char;
  }
  return out;
}

/** Collapse to a comparable key: folded, non-alphanumerics to single spaces. */
export function searchKey(input: string): string {
  return foldIcelandic(input)
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export interface AddressSearchResult {
  record: HmsAddressRecord;
  display: string;
  /** Higher is better. Exposed so the ordering is testable, not magic. */
  score: number;
}

export const DEFAULT_SEARCH_LIMIT = 8;
/** Below this, a query is too short to rank usefully. */
export const MIN_QUERY_LENGTH = 2;

/**
 * Score one record against a query.
 *
 * Deliberately simple and total: every term must appear somewhere in the
 * record, and the score rewards matching the street name from its start.
 * Returns 0 when the record does not match at all.
 */
export function scoreRecord(record: HmsAddressRecord, query: string): number {
  const terms = searchKey(query).split(" ").filter(Boolean);
  if (terms.length === 0) return 0;

  const street = searchKey(record.heitiNf);
  const house = searchKey(`${record.husnr}${record.bokstafur ?? ""}`);
  const place = searchKey(record.sveitarfelag);
  const post = record.postnr;
  const haystack = `${street} ${house} ${post} ${place}`;

  let score = 0;
  for (const term of terms) {
    if (!haystack.includes(term)) return 0; // every term must match
    if (street === term) score += 100;
    else if (street.startsWith(term)) score += 60;
    else if (street.includes(term)) score += 25;

    if (house === term) score += 40;
    if (post === term) score += 30;
    if (place.startsWith(term)) score += 20;
    else if (place.includes(term)) score += 10;
  }
  return score;
}

/**
 * Search the demo address set.
 *
 * Ties break on the display string so the ordering is stable — an unstable
 * result list makes the screen feel broken when a user retypes the same
 * query.
 */
export function searchAddresses(
  query: string,
  records: readonly HmsAddressRecord[] = DEMO_ADDRESSES,
  limit = DEFAULT_SEARCH_LIMIT,
): AddressSearchResult[] {
  const cleaned = searchKey(query);
  if (cleaned.length < MIN_QUERY_LENGTH) return [];

  return records
    .map((record) => ({
      record,
      display: formatAddress(record),
      score: scoreRecord(record, query),
    }))
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score || a.display.localeCompare(b.display, "is"))
    .slice(0, limit);
}
