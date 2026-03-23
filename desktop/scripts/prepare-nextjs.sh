#!/bin/bash
# Prepare Next.js standalone build for Tauri bundling
# This script builds Next.js and normalizes the directory structure

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DESKTOP_DIR="$(dirname "$SCRIPT_DIR")"
WEB_DIR="$(dirname "$DESKTOP_DIR")/web"
STANDALONE_DIR="$WEB_DIR/.next/standalone"

echo "=== Building Next.js for Tauri bundle ==="
echo "Web directory: $WEB_DIR"

# Build Next.js
echo "Running npm run build..."
cd "$WEB_DIR"
npm run build

echo "Standalone directory: $STANDALONE_DIR"

# Check if standalone build exists
if [ ! -d "$STANDALONE_DIR" ]; then
    echo "Error: Standalone build not found at $STANDALONE_DIR"
    echo "Build may have failed"
    exit 1
fi

# Find the server.js file (it might be nested due to absolute path preservation)
# Exclude node_modules to avoid picking up Next.js internal test server.js files
SERVER_JS=$(find "$STANDALONE_DIR" -path "*/node_modules" -prune -o -name "server.js" -type f -print | head -1)

if [ -z "$SERVER_JS" ]; then
    echo "Error: server.js not found in standalone directory"
    exit 1
fi

# Get the directory containing server.js (this is the actual app root)
APP_ROOT=$(dirname "$SERVER_JS")
echo "Found app root at: $APP_ROOT"

# Create a normalized structure at the standalone root
# Copy static files to be siblings of server.js
STATIC_SRC="$WEB_DIR/.next/static"
PUBLIC_SRC="$WEB_DIR/public"

# Destination is next to server.js
STATIC_DEST="$APP_ROOT/.next/static"
PUBLIC_DEST="$APP_ROOT/public"

echo "Copying static files..."
if [ -d "$STATIC_SRC" ]; then
    rm -rf "$STATIC_DEST"
    cp -R "$STATIC_SRC" "$STATIC_DEST"
    echo "  Copied .next/static -> $STATIC_DEST"
else
    echo "  Warning: $STATIC_SRC not found"
fi

if [ -d "$PUBLIC_SRC" ]; then
    rm -rf "$PUBLIC_DEST"
    cp -R "$PUBLIC_SRC" "$PUBLIC_DEST"
    echo "  Copied public -> $PUBLIC_DEST"
else
    echo "  Warning: $PUBLIC_SRC not found"
fi

echo "=== Next.js preparation complete ==="
