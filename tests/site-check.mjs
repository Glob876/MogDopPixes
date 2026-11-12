import { _electron } from "playwright";
import assert from "node:assert/strict";
import { mkdtemp, mkdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
const base = process.env.PIXES_SITE_URL || "http://127.0.0.1:4192";
const profile = await mkdtemp(path.join(os.tmpdir(), "pixes-site-qa-"));
await mkdir("qa", { recursive: true });
const app = await _electron.launch({
  args: [".", `--user-data-dir=${profile}`],
  cwd: process.cwd(),
});
try {
  const page = await app.firstWindow();
  await page.waitForSelector('#app[data-ready="true"]');
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await app.evaluate(async ({ BrowserWindow }, url) => {
    await BrowserWindow.getAllWindows()[0].loadURL(url);
  }, base + "/pixes.html");
  await page.locator(".pixes-tabs").waitFor();
  for (const width of [1440, 1000, 390, 360]) {
    await app.evaluate(
      ({ BrowserWindow }, width) =>
        BrowserWindow.getAllWindows()[0].setContentSize(width, 900),
      width,
    );
    await page.waitForFunction((width) => innerWidth === width, width);
    if (
      (await page.locator(".menu-toggle").getAttribute("aria-expanded")) !==
      "true"
    )
      await page.locator(".menu-toggle").click();
    await page.waitForTimeout(400);
    const geometry = await page.evaluate(() => ({
      tops: [...document.querySelectorAll(".mega-section")].map((e) =>
        Math.round(e.getBoundingClientRect().top),
      ),
      overflow: document.documentElement.scrollWidth > innerWidth,
      tabs: [...document.querySelectorAll(".pixes-tabs a")].map((e) =>
        Math.round(e.getBoundingClientRect().top),
      ),
    }));
    assert.equal(
      new Set(geometry.tops).size,
      1,
      "menu sections must be on one row",
    );
    assert.equal(
      new Set(geometry.tabs).size,
      1,
      "Pixes tabs must be on one row",
    );
    assert.equal(geometry.overflow, false, `page overflow at ${width}`);
    if (width <= 1000) {
      await page.locator(".menu-scroll-arrow.next").click();
      await page.waitForFunction(
        () => document.querySelector(".mega-inner").scrollLeft > 20,
      );
    }
    await page.screenshot({ path: `qa/site-menu-${width}.png` });
  }
  await app.evaluate(async ({ BrowserWindow }, url) => {
    await BrowserWindow.getAllWindows()[0].loadURL(url);
  }, base + "/pixes-web.html");
  const editor = page.frameLocator("iframe");
  await editor.locator('#app[data-ready="true"]').waitFor();
  assert.equal(await editor.locator("[data-tool]").count(), 14);
  await page.screenshot({ path: "qa/site-web-phone.png" });
  await app.evaluate(async ({ BrowserWindow }, url) => {
    await BrowserWindow.getAllWindows()[0].loadURL(url);
  }, base + "/pixes-download.html");
  await page.locator("#pixes-release-status").waitFor();
  assert.equal(await page.locator(".pixes-tabs a").count(), 3);
  assert.deepEqual(errors, []);
  console.log(
    "PASS: site pages, one-row menus/tabs, arrows, no overflow, embedded editor and download page.",
  );
} finally {
  await app.evaluate(({ app }) => app.exit(0));
}
