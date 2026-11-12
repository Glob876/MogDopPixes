import { _electron } from "playwright";
import { mkdtemp, mkdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
const root = process.cwd();
const profile = await mkdtemp(path.join(os.tmpdir(), "pixes-qa-"));
await mkdir("qa", { recursive: true });
const app = await _electron.launch({
  args: [".", `--user-data-dir=${profile}`],
  cwd: root,
  timeout: 30000,
});
const errors = [];
await app.evaluate(({ session }, folder) => {
  globalThis.qaDownloads = [];
  session.defaultSession.on("will-download", (_event, item) => {
    item.setSavePath(folder + "/" + item.getFilename());
    item.on("done", (_event, state) => {
      globalThis.qaDownloads.push({ name: item.getFilename(), state });
    });
  });
}, profile);
async function downloaded(name) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const found = await app.evaluate(() => globalThis.qaDownloads);
    if (found.some((file) => file.name === name && file.state === "completed"))
      return readFile(path.join(profile, name));
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Download missing: " + name);
}
try {
  const page = await app.firstWindow();
  page.on("dialog", (dialog) => dialog.accept().catch(() => {}));
  page.on("pageerror", (error) => errors.push(error.message));
  await page.waitForSelector('#app[data-ready="true"]');
  console.log("ready");
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(1440, 940),
  );
  await page.screenshot({ path: "qa/desktop-light.png" });
  await page.locator(".new-document").click();
  await page.locator('[name="name"]').fill("Проверка");
  await page.locator('[name="width"]').fill("8");
  await page.locator('[name="height"]').fill("8");
  await page.locator('#modal-form [type="submit"]').click();
  await page.waitForFunction(
    () => document.querySelector("#artwork").width === 8,
  );
  const canvas = page.locator("#artwork");
  const pixel = (x, y) =>
    page.evaluate(
      ([x, y]) =>
        Array.from(
          document
            .querySelector("#artwork")
            .getContext("2d")
            .getImageData(x, y, 1, 1).data,
        ),
      [x, y],
    );
  const clickPixel = async (x, y) => {
    const bounds = await canvas.boundingBox();
    await page.mouse.click(
      bounds.x + ((x + 0.5) / 8) * bounds.width,
      bounds.y + ((y + 0.5) / 8) * bounds.height,
    );
  };
  console.log("created");
  await clickPixel(2, 3);
  assert.deepEqual(await pixel(2, 3), [71, 104, 78, 255]);
  await page.keyboard.press("Control+z");
  assert.equal((await pixel(2, 3))[3], 0);
  await page.keyboard.press("Control+Shift+z");
  assert.equal((await pixel(2, 3))[3], 255);
  await page.locator('[data-action="add-layer"]').first().click();
  await page.locator('[data-color="#cb7654"]').click();
  await clickPixel(2, 3);
  assert.deepEqual(await pixel(2, 3), [203, 118, 84, 255]);
  await page.locator('[data-visibility="0"]').click();
  assert.deepEqual(await pixel(2, 3), [71, 104, 78, 255]);
  await page.locator('[data-visibility="0"]').click();
  await page.locator('[data-action="duplicate-frame"]').click();
  assert.equal(await page.locator("[data-frame]").count(), 2);
  await page.locator('[data-tool="eraser"]').click();
  await clickPixel(2, 3);
  assert.deepEqual(await pixel(2, 3), [71, 104, 78, 255]);
  await page.locator('[data-frame="0"]').click();
  assert.deepEqual(await pixel(2, 3), [203, 118, 84, 255]);
  console.log("draw/layer/frame checks passed");
  await page.locator(".save-button").click();
  const saved = JSON.parse((await downloaded("Проверка.pixes")).toString());
  assert.equal(saved.layers.length, 2);
  assert.equal(saved.frames.length, 2);
  assert.equal(saved.width, 8);
  await page.locator(".export-button").click();
  await page.locator('[name="format"]').selectOption("png");
  await page.locator('#modal-form [type="submit"]').click();
  const png = await downloaded("Проверка.png");
  assert.equal(png.readUInt32BE(16), 8);
  assert.equal(png.readUInt32BE(20), 8);
  await page.locator(".export-button").click();
  await page.locator('[name="format"]').selectOption("gif");
  await page.locator('#modal-form [type="submit"]').click();
  const gif = await downloaded("Проверка.gif");
  assert.equal(gif.subarray(0, 6).toString(), "GIF89a");
  const { parseGIF, decompressFrames } = await import("gifuct-js");
  const decoded = decompressFrames(
    parseGIF(gif.buffer.slice(gif.byteOffset, gif.byteOffset + gif.byteLength)),
    true,
  );
  assert.equal(decoded.length, 2);
  assert.equal(decoded[0].dims.width, 8);
  assert.deepEqual(
    Array.from(decoded[0].patch.subarray((3 * 8 + 2) * 4, (3 * 8 + 2) * 4 + 4)),
    [203, 118, 84, 255],
  );
  await page.locator('[data-menu="file"]').click();
  const chooser = page.waitForEvent("filechooser");
  await page.locator('[data-action="open"]').click();
  await (await chooser).setFiles(path.join(profile, "Проверка.pixes"));
  await page.waitForFunction(
    () =>
      document.querySelector("#app").dataset.ready === "true" &&
      document.querySelector(".document-title").textContent === "Проверка",
  );
  console.log("save, reopen, PNG and GIF exports passed");
  await page.waitForTimeout(900);
  await app.evaluate(({ BrowserWindow }) => {
    for (const window of BrowserWindow.getAllWindows())
      window.webContents.on("will-prevent-unload", (event) =>
        event.preventDefault(),
      );
  });
  await page.reload();
  await page.waitForSelector('#app[data-ready="true"]');
  assert.equal(await page.locator(".document-title").textContent(), "Проверка");
  assert.deepEqual(await pixel(2, 3), [203, 118, 84, 255]);
  if (true) {
    await page.locator('[data-menu="file"]').click();
    const aseChooser = page.waitForEvent("filechooser");
    await page.locator('[data-action="open"]').click();
    await (
      await aseChooser
    ).setFiles(path.join(root, "tests/fixtures/linked.ase"));
    await page.waitForFunction(
      () => document.querySelector("#artwork").width === 2,
    );
    assert.deepEqual(await pixel(0, 0), [255, 0, 0, 255]);
    await page.locator('[data-frame="1"]').click();
    assert.deepEqual(await pixel(1, 0), [255, 0, 0, 255]);
    assert.equal((await pixel(0, 0))[3], 0);
    console.log("Aseprite compressed and offset-linked cels passed");
  }
  await page
    .locator('[data-action="sample"]')
    .first()
    .evaluate((button) => button.click());
  await page.waitForFunction(
    () => document.querySelector("#artwork").width === 64,
  );
  await page
    .locator('[data-action="theme"]')
    .last()
    .evaluate((button) => button.click());
  await page.screenshot({ path: "qa/desktop-dark.png" });
  for (const width of [360, 390, 768]) {
    await app.evaluate(
      ({ BrowserWindow }, width) =>
        BrowserWindow.getAllWindows()[0].setContentSize(width, 1000),
      width,
    );
    await page.waitForFunction((width) => innerWidth === width, width);
    await page.waitForTimeout(70);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    );
    assert.equal(overflow, false, `overflow at ${width}`);
    await page.locator('[data-drawer="layers"]').click();
    await page.locator("#layers-panel").waitFor({ state: "visible" });
    await page.screenshot({ path: `qa/phone-${width}-layers.png` });
    await page.locator('#layers-panel [data-action="close-drawer"]').click();
    await page.screenshot({ path: `qa/phone-${width}.png` });
  }
  assert.deepEqual(errors, []);
  console.log(
    "PASS: startup, drawing, undo/redo, real layers, frame isolation, recovery, desktop themes and phone layouts.",
  );
} finally {
  await app.evaluate(({ app }) => app.exit(0));
}
