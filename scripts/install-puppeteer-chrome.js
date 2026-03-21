/**
 * Install Chrome for Puppeteer into ./.cache/puppeteer (bundled with deploy on Render, etc.).
 * Puppeteer v22+ does not download the browser during `npm install` alone.
 *
 * Skip: SKIP_PUPPETEER_CHROME=1 npm install
 */
const { execSync } = require("child_process");
const path = require("path");

if (process.env.SKIP_PUPPETEER_CHROME === "1" || process.env.SKIP_PUPPETEER_CHROME === "true") {
  console.log("[postinstall] SKIP_PUPPETEER_CHROME set — skipping Chrome download.");
  process.exit(0);
}

const projectRoot = path.join(__dirname, "..");
const cacheDir = path.join(projectRoot, ".cache", "puppeteer");

process.env.PUPPETEER_CACHE_DIR = cacheDir;

console.log("[postinstall] Installing Chrome for Puppeteer into", cacheDir);

try {
  execSync("npx puppeteer browsers install chrome", {
    stdio: "inherit",
    cwd: projectRoot,
    env: { ...process.env, PUPPETEER_CACHE_DIR: cacheDir },
    shell: process.platform === "win32",
  });
} catch (err) {
  console.error("[postinstall] puppeteer browsers install failed:", err?.message || err);
  process.exit(1);
}
