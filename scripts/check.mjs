#!/usr/bin/env node
/**
 * AFG AI - Project health check
 * Runs basic validation on the codebase
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = resolve(fileURLToPath(import.meta.url), "..");
const projectRoot = resolve(__dirname, "..");

let hasErrors = false;
let hasWarnings = false;

function error(msg) {
  console.error(`✗ ERROR: ${msg}`);
  hasErrors = true;
}

function warn(msg) {
  console.warn(`⚠ WARNING: ${msg}`);
  hasWarnings = true;
}

function ok(msg) {
  console.log(`✓ ${msg}`);
}

function checkFile(path, description) {
  if (existsSync(path)) {
    ok(`${description}: ${path}`);
    return true;
  } else {
    error(`${description} not found: ${path}`);
    return false;
  }
}

// Check essential files
console.log("\n=== Core Files ===");
checkFile(resolve(projectRoot, "package.json"), "Package manifest");
checkFile(resolve(projectRoot, "server.js"), "Server entry point");
checkFile(resolve(projectRoot, "server/app.js"), "Application factory");
checkFile(resolve(projectRoot, "server/config.js"), "Configuration loader");

// Check server modules
console.log("\n=== Server Modules ===");
const serverDirs = ["api", "lib", "providers"];
for (const dir of serverDirs) {
  const dirPath = resolve(projectRoot, "server", dir);
  if (existsSync(dirPath)) {
    const files = readdirSync(dirPath).filter((f) => f.endsWith(".js"));
    ok(`${dir}/: ${files.length} modules`);
  } else {
    error(`Missing server/${dir}/ directory`);
  }
}

// Check frontend assets
console.log("\n=== Frontend Assets ===");
checkFile(resolve(projectRoot, "app/src/main/assets/index.html"), "Main HTML");
checkFile(resolve(projectRoot, "app/src/main/assets/manifest.webmanifest"), "PWA manifest");
checkFile(resolve(projectRoot, "app/src/main/assets/sw.js"), "Service worker");

const jsDir = resolve(projectRoot, "app/src/main/assets/js");
if (existsSync(jsDir)) {
  const jsFiles = readdirSync(jsDir).filter((f) => f.endsWith(".js"));
  ok(`js/: ${jsFiles.length} modules`);
} else {
  error("Missing app/src/main/assets/js/ directory");
}

const stylesDir = resolve(projectRoot, "app/src/main/assets/styles");
if (existsSync(stylesDir)) {
  const cssFiles = readdirSync(stylesDir).filter((f) => f.endsWith(".css"));
  ok(`styles/: ${cssFiles.length} modules`);
} else {
  error("Missing app/src/main/assets/styles/ directory");
}

// Check tests
console.log("\n=== Tests ===");
const testDir = resolve(projectRoot, "test");
if (existsSync(testDir)) {
  const testFiles = readdirSync(testDir).filter((f) => f.endsWith(".test.js"));
  ok(`test/: ${testFiles.length} test files`);
} else {
  error("Missing test/ directory");
}

// Check package.json for consistency
console.log("\n=== Package.json Validation ===");
try {
  const pkg = JSON.parse(readFileSync(resolve(projectRoot, "package.json"), "utf-8"));
  if (pkg.type === "module") ok("ES modules enabled");
  else warn("package.json: 'type' should be 'module'");

  if (pkg.engines?.node) ok(`Node engine: ${pkg.engines.node}`);
  else warn("package.json: missing engines.node");

  if (pkg.scripts?.test) ok("Test script defined");
  else warn("package.json: missing test script");

  if (pkg.scripts?.start) ok("Start script defined");
  else warn("package.json: missing start script");
} catch (e) {
  error(`Failed to parse package.json: ${e.message}`);
}

// Check for common issues in JS files
console.log("\n=== Code Quality ===");
function scanJsFiles(dir) {
  if (!existsSync(dir)) return;
  const files = readdirSync(dir, { withFileTypes: true });
  for (const file of files) {
    const fullPath = resolve(dir, file.name);
    if (file.isDirectory()) {
      scanJsFiles(fullPath);
    } else if (file.name.endsWith(".js") || file.name.endsWith(".mjs")) {
      const content = readFileSync(fullPath, "utf-8");
      if (content.includes("console.log") && !content.includes("test")) {
        warn(`${fullPath}: contains console.log (consider using a logger)`);
      }
      if (content.includes("TODO") || content.includes("FIXME")) {
        warn(`${fullPath}: contains TODO/FIXME comments`);
      }
    }
  }
}
scanJsFiles(resolve(projectRoot, "server"));
scanJsFiles(resolve(projectRoot, "app/src/main/assets/js"));
scanJsFiles(resolve(projectRoot, "test"));

// Check git status
console.log("\n=== Git Status ===");
try {
  const { execSync } = await import("node:child_process");
  const status = execSync("git status --porcelain", { cwd: projectRoot, encoding: "utf-8" }).trim();
  if (status) {
    warn(`Working tree has ${status.split("\n").length} uncommitted changes`);
  } else {
    ok("Working tree is clean");
  }
} catch {
  warn("Could not check git status");
}

console.log("\n=== Summary ===");
if (hasErrors) {
  console.error("✗ Check failed with errors");
  process.exit(1);
} else if (hasWarnings) {
  console.log("⚠ Check passed with warnings");
  process.exit(0);
} else {
  console.log("✓ All checks passed");
  process.exit(0);
}