// Headless drive-and-capture harness (Joshua-style).
//   node qa/shot.mjs <url> <outfile> [actionsJSON]
//
// Launches headless Chromium forced onto software GL (swiftshader), waits for the
// game's `window.__telemetry` to appear, optionally replays a JSON action script,
// dumps telemetry, screenshots, and exits non-zero if any console/page errors
// were collected. This is what makes headless verification of the 3D app possible.

import { chromium } from "playwright";

const url = process.argv[2] ?? "http://localhost:5050/";
const out = process.argv[3] ?? "qa/shot.png";
const actions = process.argv[4] ? JSON.parse(process.argv[4]) : [];

const browser = await chromium.launch({
  args: [
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--ignore-gpu-blocklist",
    "--enable-unsafe-swiftshader",
  ],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

const errors = [];
page.on("console", (m) => {
  if (m.type() === "error") errors.push(`console.error: ${m.text()}`);
});
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));

await page.goto(url, { waitUntil: "domcontentloaded" });

// Wait for the world runtime to come up (generous: software GL is slow).
let ready = false;
try {
  await page.waitForFunction(() => !!window.__telemetry && !!window.__continent, { timeout: 60000 });
  ready = true;
} catch {
  /* fall through; we still screenshot + report */
}

for (const a of actions) {
  if (a.wait) await page.waitForTimeout(a.wait);
  else if (a.eval) await page.evaluate(a.eval);
  else if (a.key) {
    // {key:"KeyW", downMs:600} — hold a key (Playwright accepts code names).
    await page.keyboard.down(a.key);
    await page.waitForTimeout(a.downMs ?? 120);
    await page.keyboard.up(a.key);
  }
}

// Give physics a moment to settle (5th CLI arg overrides, ms).
await page.waitForTimeout(process.argv[5] ? parseInt(process.argv[5], 10) : 1500);

const telemetry = ready ? await page.evaluate(() => window.__telemetry()) : null;
await page.screenshot({ path: out });
await browser.close();

console.log(JSON.stringify({ ready, telemetry, errors }, null, 2));
if (!ready || errors.length) process.exit(1);
