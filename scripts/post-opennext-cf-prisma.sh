#!/usr/bin/env bash
set -euo pipefail
SRC="node_modules/straumvakt-prisma-cf-client/internal"
DEST=".open-next/server-functions/default/node_modules/straumvakt-prisma-cf-client/internal"
[ -d "$DEST" ] || { echo "$DEST missing — did opennext build run?" >&2; exit 1; }
cp "$SRC"/query_compiler_fast_bg.wasm "$DEST"/
echo "[post-opennext] copied query_compiler_fast_bg.wasm into $DEST"
