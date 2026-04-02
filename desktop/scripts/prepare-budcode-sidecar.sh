#!/bin/bash
# Build the budcode sidecar binary for the current platform and place it
# in the Tauri binaries directory with the correct target-triple suffix.
#
# Usage:
#   ./desktop/scripts/prepare-budcode-sidecar.sh [path-to-codex-repo]
#
# If path-to-codex-repo is omitted, it defaults to ../codex relative to
# the BudStudio repo root.

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DESKTOP_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(dirname "$DESKTOP_DIR")"
BINARIES_DIR="$DESKTOP_DIR/src-tauri/binaries"

# Codex repo location
CODEX_REPO="${1:-$REPO_ROOT/../codex}"
BUDCODE_RS_DIR="$CODEX_REPO/budcode-rs"

if [ ! -d "$BUDCODE_RS_DIR" ]; then
    echo "Error: budcode-rs directory not found at $BUDCODE_RS_DIR"
    echo "Usage: $0 [path-to-codex-repo]"
    exit 1
fi

# Detect current platform target triple
OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS" in
    Darwin)
        case "$ARCH" in
            arm64) TARGET="aarch64-apple-darwin" ;;
            x86_64) TARGET="x86_64-apple-darwin" ;;
            *) echo "Unsupported macOS arch: $ARCH"; exit 1 ;;
        esac
        EXT=""
        ;;
    Linux)
        case "$ARCH" in
            aarch64) TARGET="aarch64-unknown-linux-gnu" ;;
            x86_64) TARGET="x86_64-unknown-linux-gnu" ;;
            *) echo "Unsupported Linux arch: $ARCH"; exit 1 ;;
        esac
        EXT=""
        ;;
    MINGW*|MSYS*|CYGWIN*)
        TARGET="x86_64-pc-windows-msvc"
        EXT=".exe"
        ;;
    *)
        echo "Unsupported OS: $OS"
        exit 1
        ;;
esac

SIDECAR_NAME="budcode-${TARGET}${EXT}"

echo "=== Building budcode sidecar ==="
echo "Source: $BUDCODE_RS_DIR"
echo "Target: $TARGET"
echo "Output: $BINARIES_DIR/$SIDECAR_NAME"

cd "$BUDCODE_RS_DIR"
cargo build --release --target "$TARGET" -p budcode_cli

# Copy built binary to Tauri sidecar location
mkdir -p "$BINARIES_DIR"
cp "target/${TARGET}/release/budcode${EXT}" "$BINARIES_DIR/$SIDECAR_NAME"
chmod +x "$BINARIES_DIR/$SIDECAR_NAME"

echo "=== budcode sidecar ready ==="
ls -la "$BINARIES_DIR/$SIDECAR_NAME"
