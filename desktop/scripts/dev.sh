#!/bin/bash

# Development script for Bud Studio Desktop
# This script builds Next.js in standalone mode and runs the Tauri dev server

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}=== Bud Studio Desktop Development ===${NC}\n"

# Check if we're in the desktop directory
if [ ! -f "src-tauri/Cargo.toml" ]; then
    echo -e "${RED}Error: Must run this script from the desktop directory${NC}"
    exit 1
fi

# Navigate to web directory
cd ../web

echo -e "${YELLOW}Step 1: Installing web dependencies...${NC}"
if [ ! -d "node_modules" ]; then
    npm install
else
    echo "Dependencies already installed"
fi

echo -e "\n${YELLOW}Step 2: Building Next.js in standalone mode...${NC}"
npm run build

if [ ! -d ".next/standalone" ]; then
    echo -e "${RED}Error: Standalone build not found. Check your next.config.js${NC}"
    exit 1
fi

echo -e "\n${YELLOW}Step 3: Copying static files...${NC}"
# Copy static files into standalone directory
cp -R .next/static .next/standalone/.next/
cp -R public .next/standalone/ || true

# Go back to desktop directory
cd ../desktop

echo -e "\n${YELLOW}Step 4: Starting Tauri development server...${NC}"
# Source cargo env if needed
if [ -f "$HOME/.cargo/env" ]; then
    source "$HOME/.cargo/env"
fi

cargo tauri dev

echo -e "\n${GREEN}Development server stopped${NC}"
