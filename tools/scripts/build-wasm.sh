#!/usr/bin/env bash
set -euo pipefail

# Ensure rustup toolchain is first in PATH for wasm-pack
export PATH="$HOME/.cargo/bin:$PATH"

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/../../" && pwd)

echo "Building smart_rte_wasm to packages/core-wasm/pkg..."
wasm-pack build "$REPO_ROOT/rust/smart_rte_wasm" \
  --target web \
  --out-dir "$REPO_ROOT/packages/core-wasm/pkg" \
  --out-name smart_rte_wasm

echo "WASM build complete."


