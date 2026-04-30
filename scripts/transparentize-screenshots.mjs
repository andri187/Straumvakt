// Replaces the light-grey backdrop on Pixel-9 mock screenshots with
// transparent pixels so the phone appears to float on the page.
//
// Algorithm: sample the top-left corner colour as the backdrop key,
// then for every pixel compute a chroma-key alpha as 1 - (distance to
// key / threshold). Distance under the inner threshold → fully
// transparent. Distance above the outer threshold → fully opaque.
// In between → partial alpha so the soft drop-shadow at the bottom
// of the phone fades naturally instead of getting hard-edged.
//
// Backups go into the same dir with a .bak.png suffix so the
// original is recoverable.

import { readdirSync, copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

const SRC_DIR = "public/app-screenshots";
const INNER = 12; // colour distance (sum of |dR|+|dG|+|dB|) below this → fully transparent
const OUTER = 48; // above this → fully opaque

function colourDistance(r, g, b, kr, kg, kb) {
  return Math.abs(r - kr) + Math.abs(g - kg) + Math.abs(b - kb);
}

async function transparentize(file) {
  const path = join(SRC_DIR, file);
  const backup = path.replace(/\.png$/, ".bak.png");
  if (!existsSync(backup)) copyFileSync(path, backup);

  // Read from the backup so re-running is idempotent.
  const { data, info } = await sharp(backup)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height, channels } = info;
  // Sample backdrop colour at top-left.
  const kr = data[0];
  const kg = data[1];
  const kb = data[2];

  const out = Buffer.from(data);
  for (let i = 0; i < out.length; i += channels) {
    const dist = colourDistance(out[i], out[i + 1], out[i + 2], kr, kg, kb);
    let alpha;
    if (dist <= INNER) alpha = 0;
    else if (dist >= OUTER) alpha = out[i + 3];
    else {
      const t = (dist - INNER) / (OUTER - INNER);
      alpha = Math.round(out[i + 3] * t);
    }
    out[i + 3] = alpha;
  }

  await sharp(out, { raw: { width, height, channels } }).png().toFile(path);
  console.log(`  ${file} — backdrop key rgb(${kr},${kg},${kb}) → transparent`);
}

const files = readdirSync(SRC_DIR).filter((f) => f.endsWith(".png") && !f.endsWith(".bak.png"));
console.log(`processing ${files.length} screenshots in ${SRC_DIR}/`);
for (const f of files) await transparentize(f);
console.log("done.");
