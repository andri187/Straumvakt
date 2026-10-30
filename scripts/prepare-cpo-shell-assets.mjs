// Run after OpenNext build. Remove excluded files only from generated output;
// retained source designs in public/ are never modified.
// The kept public files are the exact list the edge worker serves.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PUBLIC_ASSET_PATHS } from '../workers/cpo-shell-edge.mjs';

const publicAssets = new Set(PUBLIC_ASSET_PATHS.map((asset) => asset.slice(1)));

// Removes everything under `root` except the exact public files and the
// hashed _next/static output, then fails if a required public file is absent.
export function pruneGeneratedAssets(root) {
  if (!fs.existsSync(root) || fs.realpathSync(root) !== root) throw new Error('Expected generated assets directory');
  let removed = 0;
  function prune(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      const relative = path.relative(root, file).replaceAll('\\', '/');
      if (relative.startsWith('../') || entry.isSymbolicLink()) throw new Error('Unexpected generated asset path');
      if (entry.isDirectory()) prune(file);
      else if (!relative.startsWith('_next/static/') && !publicAssets.has(relative)) {
        fs.unlinkSync(file);
        removed++;
      }
    }
  }
  prune(root);
  const missing = [...publicAssets].filter((asset) => !fs.existsSync(path.join(root, asset)));
  if (missing.length) throw new Error(`Generated assets are missing required files: ${missing.join(', ')}`);
  return { removed, kept: publicAssets.size };
}

// Always runs when invoked as a command; only the test runner imports it as a module.
if (!process.env.VITEST) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.open-next', 'assets');
  const { removed, kept } = pruneGeneratedAssets(root);
  console.log(`Removed ${removed} excluded generated assets; kept ${kept} public files; source designs preserved.`);
}
