// Line-ending-tolerant text replacement, for the Drizzle port.
//
// Most files in this repo are CRLF on disk (Windows, no .gitattributes
// normalising the working tree). A replacement written in a JS template
// literal is LF, so `String.replace` silently matches nothing and the edit
// looks like it applied. That has now cost three rounds of confusion, so:
// normalise to LF, replace, restore the file's original ending, and THROW if
// a replacement did not match rather than writing an unchanged file.

import fs from "node:fs";

export function editFile(pathname, replacements, { optional = [] } = {}) {
  const raw = fs.readFileSync(pathname, "utf8");
  const crlf = raw.includes("\r\n");
  let s = raw.replace(/\r\n/g, "\n");

  for (const [from, to] of replacements) {
    const needle = from.replace(/\r\n/g, "\n");
    if (!s.includes(needle)) {
      throw new Error(
        `no match in ${pathname}:\n--- looking for ---\n${needle.slice(0, 300)}\n`,
      );
    }
    s = s.split(needle).join(to.replace(/\r\n/g, "\n"));
  }
  for (const [from, to] of optional) {
    const needle = from.replace(/\r\n/g, "\n");
    if (s.includes(needle)) s = s.split(needle).join(to.replace(/\r\n/g, "\n"));
  }

  fs.writeFileSync(pathname, crlf ? s.replace(/\n/g, "\r\n") : s);
}
