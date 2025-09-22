#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "$0")/.." && pwd)

echo "Building wasm (release)..."
cd "$ROOT_DIR"
cargo build -p smart_rte_wasm --release --target wasm32-unknown-unknown

echo "Copying wasm artifacts to packages/core-wasm/pkg..."
mkdir -p "$ROOT_DIR/packages/core-wasm/pkg"
cp -f "$ROOT_DIR/target/wasm32-unknown-unknown/release/smart_rte_wasm.wasm" "$ROOT_DIR/packages/core-wasm/pkg/smart_rte_wasm_bg.wasm" || true

echo "Done."


