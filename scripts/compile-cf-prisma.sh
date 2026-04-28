#!/usr/bin/env bash
set -euo pipefail
DIR="node_modules/straumvakt-prisma-cf-client"
[ -d "$DIR" ] || { echo "$DIR missing — did prisma generate run?" >&2; exit 1; }

# Transpile TS -> JS in place. esbuild strips .js extensions from relative
# imports during TS transpile (assumes bundler resolution); we re-add them
# below so Node ESM (which requires explicit extensions) can resolve them.
npx esbuild \
  "$DIR"/*.ts \
  "$DIR"/internal/*.ts \
  "$DIR"/models/*.ts \
  --format=esm --platform=neutral --target=es2022 --loader:.ts=ts \
  --outdir="$DIR" --out-extension:.js=.js \
  --log-level=warning

# Re-add .js extensions to relative imports (esbuild stripped them).
# Pattern: from "./...path..."  or  from "../...path..."  (no extension)
find "$DIR" -name "*.js" -print0 | xargs -0 sed -i -E \
  -e "s|from \"(\.\.?/[A-Za-z0-9_/-]+)\"|from \"\1.js\"|g" \
  -e "s|import\(\"(\.\.?/[A-Za-z0-9_/-]+)\"\)|import(\"\1.js\")|g"

echo "[cf-prisma] compiled .ts -> .js + import paths fixed up in $DIR"
