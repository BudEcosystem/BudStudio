#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

// Path to the standalone package.json
const standalonePackageJsonPath = path.join(
  __dirname,
  "../../web/.next/standalone/package.json"
);

if (fs.existsSync(standalonePackageJsonPath)) {
  const packageJson = JSON.parse(fs.readFileSync(standalonePackageJsonPath, "utf8"));

  // Update the name to match our app
  packageJson.name = "bud-studio";
  packageJson.productName = "Bud Studio";

  fs.writeFileSync(
    standalonePackageJsonPath,
    JSON.stringify(packageJson, null, 2)
  );

  console.log("✓ Updated standalone package.json name to 'Bud Studio'");
} else {
  console.error("✗ Standalone package.json not found");
  process.exit(1);
}
