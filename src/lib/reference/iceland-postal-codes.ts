// Iceland postal-code → city + sveitarfélag (Hagstofa code) lookup.
//
// Source: Íslandspóstur postnumeralisting + Hagstofa Íslands
// sveitarfélagskoðar 2026. The postal-code prefix maps unambiguously
// to a single city for residential codes. Some codes are P.O.-box
// only ("Pósthólf") and reuse the geographic city's municipality;
// they're omitted here unless they resolve cleanly.
//
// Coverage: capital region (101–276) + larger towns. Add more on
// demand — looking up a code that's not in the table just leaves
// the city/municipality fields blank for the operator to fill.

export interface IcelandPostalEntry {
  /** Sveitarfélag 4-digit Hagstofa code, e.g. "0000" Reykjavík. */
  municipalityCode: string;
  /** Sveitarfélag display name, e.g. "Reykjavík" / "Kópavogur". */
  municipalityName: string;
  /** Postal-area city label, e.g. "Reykjavík" / "Kópavogur" / "Garðabær". */
  city: string;
}

const POSTAL_CODES: Record<string, IcelandPostalEntry> = {
  // Reykjavík (0000)
  "101": { municipalityCode: "0000", municipalityName: "Reykjavík", city: "Reykjavík" },
  "102": { municipalityCode: "0000", municipalityName: "Reykjavík", city: "Reykjavík" },
  "103": { municipalityCode: "0000", municipalityName: "Reykjavík", city: "Reykjavík" },
  "104": { municipalityCode: "0000", municipalityName: "Reykjavík", city: "Reykjavík" },
  "105": { municipalityCode: "0000", municipalityName: "Reykjavík", city: "Reykjavík" },
  "107": { municipalityCode: "0000", municipalityName: "Reykjavík", city: "Reykjavík" },
  "108": { municipalityCode: "0000", municipalityName: "Reykjavík", city: "Reykjavík" },
  "109": { municipalityCode: "0000", municipalityName: "Reykjavík", city: "Reykjavík" },
  "110": { municipalityCode: "0000", municipalityName: "Reykjavík", city: "Reykjavík" },
  "111": { municipalityCode: "0000", municipalityName: "Reykjavík", city: "Reykjavík" },
  "112": { municipalityCode: "0000", municipalityName: "Reykjavík", city: "Reykjavík" },
  "113": { municipalityCode: "0000", municipalityName: "Reykjavík", city: "Reykjavík" },
  "116": { municipalityCode: "0000", municipalityName: "Reykjavík", city: "Reykjavík" },

  // Seltjarnarnes
  "170": { municipalityCode: "1100", municipalityName: "Seltjarnarnes", city: "Seltjarnarnes" },
  "172": { municipalityCode: "1100", municipalityName: "Seltjarnarnes", city: "Seltjarnarnes" },

  // Kópavogur
  "200": { municipalityCode: "1000", municipalityName: "Kópavogur", city: "Kópavogur" },
  "201": { municipalityCode: "1000", municipalityName: "Kópavogur", city: "Kópavogur" },
  "202": { municipalityCode: "1000", municipalityName: "Kópavogur", city: "Kópavogur" },
  "203": { municipalityCode: "1000", municipalityName: "Kópavogur", city: "Kópavogur" },

  // Garðabær
  "210": { municipalityCode: "1300", municipalityName: "Garðabær", city: "Garðabær" },
  "212": { municipalityCode: "1300", municipalityName: "Garðabær", city: "Garðabær" },

  // Hafnarfjörður
  "220": { municipalityCode: "1400", municipalityName: "Hafnarfjörður", city: "Hafnarfjörður" },
  "221": { municipalityCode: "1400", municipalityName: "Hafnarfjörður", city: "Hafnarfjörður" },
  "222": { municipalityCode: "1400", municipalityName: "Hafnarfjörður", city: "Hafnarfjörður" },

  // Álftanes (now Garðabær)
  "225": { municipalityCode: "1300", municipalityName: "Garðabær", city: "Álftanes" },

  // Reykjanesbær / Suðurnes
  "230": { municipalityCode: "2000", municipalityName: "Reykjanesbær", city: "Reykjanesbær" },
  "232": { municipalityCode: "2000", municipalityName: "Reykjanesbær", city: "Reykjanesbær" },
  "233": { municipalityCode: "2504", municipalityName: "Suðurnesjabær", city: "Sandgerði" },
  "235": { municipalityCode: "2510", municipalityName: "Vogar", city: "Vogar" },
  "240": { municipalityCode: "2300", municipalityName: "Grindavíkurbær", city: "Grindavík" },
  "245": { municipalityCode: "2504", municipalityName: "Suðurnesjabær", city: "Garður" },

  // Mosfellsbær
  "270": { municipalityCode: "1604", municipalityName: "Mosfellsbær", city: "Mosfellsbær" },
  "271": { municipalityCode: "1604", municipalityName: "Mosfellsbær", city: "Mosfellsbær" },
  "276": { municipalityCode: "1606", municipalityName: "Kjósarhreppur", city: "Kjós" },

  // Akranes / Vesturland
  "300": { municipalityCode: "3000", municipalityName: "Akraneskaupstaður", city: "Akranes" },
  "301": { municipalityCode: "3000", municipalityName: "Akraneskaupstaður", city: "Akranes" },
  "310": { municipalityCode: "3501", municipalityName: "Borgarbyggð", city: "Borgarnes" },
  "311": { municipalityCode: "3501", municipalityName: "Borgarbyggð", city: "Borgarnes" },
  "320": { municipalityCode: "3506", municipalityName: "Skorradalshreppur", city: "Reykholt" },
  "340": { municipalityCode: "3811", municipalityName: "Dalabyggð", city: "Stykkishólmur" },
  "350": { municipalityCode: "3713", municipalityName: "Grundarfjarðarbær", city: "Grundarfjörður" },
  "355": { municipalityCode: "3714", municipalityName: "Helgafellssveit", city: "Ólafsvík" },
  "356": { municipalityCode: "3711", municipalityName: "Snæfellsbær", city: "Snæfellsbær" },
  "360": { municipalityCode: "3811", municipalityName: "Dalabyggð", city: "Búðardalur" },
  "370": { municipalityCode: "3811", municipalityName: "Dalabyggð", city: "Búðardalur" },
  "371": { municipalityCode: "3811", municipalityName: "Dalabyggð", city: "Búðardalur" },

  // Vestfirðir
  "400": { municipalityCode: "4100", municipalityName: "Ísafjarðarbær", city: "Ísafjörður" },
  "401": { municipalityCode: "4100", municipalityName: "Ísafjarðarbær", city: "Ísafjörður" },
  "410": { municipalityCode: "4100", municipalityName: "Ísafjarðarbær", city: "Hnífsdalur" },
  "415": { municipalityCode: "4200", municipalityName: "Bolungarvíkurkaupstaður", city: "Bolungarvík" },
  "420": { municipalityCode: "4501", municipalityName: "Súðavíkurhreppur", city: "Súðavík" },
  "425": { municipalityCode: "4502", municipalityName: "Árneshreppur", city: "Norðurfjörður" },
  "450": { municipalityCode: "4604", municipalityName: "Tálknafjarðarhreppur", city: "Patreksfjörður" },
  "460": { municipalityCode: "4607", municipalityName: "Vesturbyggð", city: "Tálknafjörður" },
  "465": { municipalityCode: "4607", municipalityName: "Vesturbyggð", city: "Bíldudalur" },
  "470": { municipalityCode: "4901", municipalityName: "Strandabyggð", city: "Þingeyri" },
  "471": { municipalityCode: "4901", municipalityName: "Strandabyggð", city: "Flateyri" },
  "510": { municipalityCode: "5200", municipalityName: "Húnabyggð", city: "Hólmavík" },

  // Norðurland vestra
  "530": { municipalityCode: "5604", municipalityName: "Húnaþing vestra", city: "Hvammstangi" },
  "540": { municipalityCode: "5612", municipalityName: "Húnabyggð", city: "Blönduós" },
  "550": { municipalityCode: "5612", municipalityName: "Húnabyggð", city: "Skagaströnd" },
  "560": { municipalityCode: "5706", municipalityName: "Skagafjörður", city: "Varmahlíð" },
  "565": { municipalityCode: "5706", municipalityName: "Skagafjörður", city: "Hofsós" },
  "570": { municipalityCode: "5706", municipalityName: "Skagafjörður", city: "Fljót" },
  "580": { municipalityCode: "5706", municipalityName: "Skagafjörður", city: "Sauðárkrókur" },

  // Akureyri / Norðurland eystra
  "600": { municipalityCode: "6000", municipalityName: "Akureyrarbær", city: "Akureyri" },
  "601": { municipalityCode: "6000", municipalityName: "Akureyrarbær", city: "Akureyri" },
  "602": { municipalityCode: "6000", municipalityName: "Akureyrarbær", city: "Akureyri" },
  "603": { municipalityCode: "6000", municipalityName: "Akureyrarbær", city: "Akureyri" },
  "610": { municipalityCode: "6100", municipalityName: "Norðurþing", city: "Grenivík" },
  "611": { municipalityCode: "6100", municipalityName: "Norðurþing", city: "Grímsey" },
  "620": { municipalityCode: "6515", municipalityName: "Dalvíkurbyggð", city: "Dalvík" },
  "621": { municipalityCode: "6515", municipalityName: "Dalvíkurbyggð", city: "Dalvík" },
  "625": { municipalityCode: "6513", municipalityName: "Hörgársveit", city: "Ólafsfjörður" },
  "630": { municipalityCode: "6250", municipalityName: "Fjallabyggð", city: "Hrísey" },
  "640": { municipalityCode: "6100", municipalityName: "Norðurþing", city: "Húsavík" },
  "641": { municipalityCode: "6100", municipalityName: "Norðurþing", city: "Húsavík" },
  "645": { municipalityCode: "6100", municipalityName: "Norðurþing", city: "Mývatn" },
  "650": { municipalityCode: "6604", municipalityName: "Skútustaðahreppur", city: "Laugar" },
  "660": { municipalityCode: "6709", municipalityName: "Þingeyjarsveit", city: "Reykjahlíð" },
  "670": { municipalityCode: "6709", municipalityName: "Þingeyjarsveit", city: "Kópasker" },
  "671": { municipalityCode: "6709", municipalityName: "Þingeyjarsveit", city: "Raufarhöfn" },
  "675": { municipalityCode: "6709", municipalityName: "Þingeyjarsveit", city: "Þórshöfn" },
  "680": { municipalityCode: "6709", municipalityName: "Þingeyjarsveit", city: "Þórshöfn" },
  "685": { municipalityCode: "6250", municipalityName: "Fjallabyggð", city: "Bakkafjörður" },

  // Austurland
  "690": { municipalityCode: "7300", municipalityName: "Múlaþing", city: "Vopnafjörður" },
  "700": { municipalityCode: "7300", municipalityName: "Múlaþing", city: "Egilsstaðir" },
  "701": { municipalityCode: "7300", municipalityName: "Múlaþing", city: "Egilsstaðir" },
  "710": { municipalityCode: "7300", municipalityName: "Múlaþing", city: "Seyðisfjörður" },
  "715": { municipalityCode: "7300", municipalityName: "Múlaþing", city: "Mjóifjörður" },
  "720": { municipalityCode: "7300", municipalityName: "Múlaþing", city: "Borgarfjörður" },
  "730": { municipalityCode: "7502", municipalityName: "Fjarðabyggð", city: "Reyðarfjörður" },
  "735": { municipalityCode: "7502", municipalityName: "Fjarðabyggð", city: "Eskifjörður" },
  "740": { municipalityCode: "7502", municipalityName: "Fjarðabyggð", city: "Neskaupstaður" },
  "750": { municipalityCode: "7502", municipalityName: "Fjarðabyggð", city: "Fáskrúðsfjörður" },
  "755": { municipalityCode: "7502", municipalityName: "Fjarðabyggð", city: "Stöðvarfjörður" },
  "760": { municipalityCode: "7502", municipalityName: "Fjarðabyggð", city: "Breiðdalsvík" },
  "765": { municipalityCode: "7300", municipalityName: "Múlaþing", city: "Djúpivogur" },
  "780": { municipalityCode: "7708", municipalityName: "Sveitarfélagið Hornafjörður", city: "Höfn" },
  "781": { municipalityCode: "7708", municipalityName: "Sveitarfélagið Hornafjörður", city: "Höfn" },

  // Suðurland / Suðurnes
  "800": { municipalityCode: "8200", municipalityName: "Sveitarfélagið Árborg", city: "Selfoss" },
  "801": { municipalityCode: "8200", municipalityName: "Sveitarfélagið Árborg", city: "Selfoss" },
  "802": { municipalityCode: "8200", municipalityName: "Sveitarfélagið Árborg", city: "Selfoss" },
  "810": { municipalityCode: "8000", municipalityName: "Hveragerðisbær", city: "Hveragerði" },
  "815": { municipalityCode: "8000", municipalityName: "Hveragerðisbær", city: "Þorlákshöfn" },
  "816": { municipalityCode: "8000", municipalityName: "Hveragerðisbær", city: "Ölfus" },
  "820": { municipalityCode: "8200", municipalityName: "Sveitarfélagið Árborg", city: "Eyrarbakki" },
  "825": { municipalityCode: "8200", municipalityName: "Sveitarfélagið Árborg", city: "Stokkseyri" },
  "840": { municipalityCode: "8508", municipalityName: "Bláskógabyggð", city: "Laugarvatn" },
  "845": { municipalityCode: "8508", municipalityName: "Bláskógabyggð", city: "Flúðir" },
  "850": { municipalityCode: "8613", municipalityName: "Skeiða- og Gnúpverjahreppur", city: "Hella" },
  "851": { municipalityCode: "8613", municipalityName: "Skeiða- og Gnúpverjahreppur", city: "Hella" },
  "860": { municipalityCode: "8613", municipalityName: "Skeiða- og Gnúpverjahreppur", city: "Hvolsvöllur" },
  "861": { municipalityCode: "8613", municipalityName: "Skeiða- og Gnúpverjahreppur", city: "Hvolsvöllur" },
  "870": { municipalityCode: "8716", municipalityName: "Mýrdalshreppur", city: "Vík" },
  "871": { municipalityCode: "8716", municipalityName: "Mýrdalshreppur", city: "Vík" },
  "880": { municipalityCode: "8721", municipalityName: "Skaftárhreppur", city: "Kirkjubæjarklaustur" },
  "900": { municipalityCode: "8000", municipalityName: "Vestmannaeyjabær", city: "Vestmannaeyjar" },
  "902": { municipalityCode: "8000", municipalityName: "Vestmannaeyjabær", city: "Vestmannaeyjar" },
};

/**
 * Look up a 3-digit Iceland postal code. Returns null when not in
 * the table — caller should fall through to letting the operator
 * type the city + sveitarfélag manually.
 */
export function lookupPostalCode(raw: string): IcelandPostalEntry | null {
  const code = raw.trim();
  if (!/^\d{3}$/.test(code)) return null;
  return POSTAL_CODES[code] ?? null;
}
