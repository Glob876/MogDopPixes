import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createDocument,
  cloneDocument,
  addLayer,
  deleteLayer,
  addFrame,
  moveLayer,
  serializeDocument,
  parseDocument,
  History,
  checkBudget,
} from "../src/document";
import { initializeCore } from "../src/core";
import { Raster, translate } from "../src/raster";
initializeCore();
test("project round trip preserves independent frame and layer buffers", () => {
  const document = createDocument(3, 2, "Русский <проект>");
  document.frames[0].cels[0].set([10, 20, 30, 128], 4);
  addLayer(document, 0);
  addFrame(document, 0, true);
  document.frames[1].cels[1][4] = 90;
  const loaded = parseDocument(serializeDocument(document));
  assert.deepEqual(loaded, document);
  loaded.frames[0].cels[1][4] = 7;
  assert.equal(loaded.frames[1].cels[1][4], 90);
  assert.equal(document.frames[0].cels[1][4], 10);
});
test("reordering and deleting layers update every frame", () => {
  const document = createDocument(2, 2);
  document.frames[0].cels[0][0] = 42;
  addFrame(document, 0, true);
  addLayer(document, 0);
  moveLayer(document, 1, 0);
  assert.equal(document.frames[0].cels[0][0], 42);
  assert.equal(document.frames[1].cels[0][0], 42);
  deleteLayer(document, 0);
  assert.equal(document.frames[1].cels[0][0], 0);
  assert.throws(() => deleteLayer(document, 0));
});
test("undo and redo include structural changes without aliasing", () => {
  const history = new History();
  const document = createDocument(4, 4);
  history.push(cloneDocument(document));
  addLayer(document, 0);
  addFrame(document, 0, true);
  const restored = history.undo(document)!;
  assert.equal(restored.layers.length, 1);
  assert.equal(restored.frames.length, 1);
  const redone = history.redo(restored)!;
  assert.equal(redone.layers.length, 2);
  assert.equal(redone.frames.length, 2);
});
test("malformed project and oversized allocation are rejected", () => {
  assert.throws(() => checkBudget(2048, 2048, 128, 512));
  assert.throws(() => checkBudget(-1, 2));
  const document = createDocument(1, 1);
  const encoded = JSON.parse(serializeDocument(document));
  encoded.frames[0].cels[0] = "AAAA";
  assert.throws(() => parseDocument(JSON.stringify(encoded)));
  encoded.layers[0].opacity = -1;
  assert.throws(() => parseDocument(JSON.stringify(encoded)));
});
function raster(
  pixels: Uint8ClampedArray,
  extra: Record<string, unknown> = {},
) {
  return new Raster(pixels, 4, 4, {
    size: 1,
    color: [255, 0, 0, 128],
    secondary: [0, 0, 255, 255],
    opacity: 1,
    erase: false,
    dither: false,
    round: false,
    filled: false,
    mirrorX: false,
    mirrorY: false,
    wrap: false,
    ...extra,
  });
}
test("stroke joints do not accumulate opacity, symmetry respects selection", () => {
  const pixels = new Uint8ClampedArray(64);
  const brush = raster(pixels);
  brush.line(0, 0, 3, 3);
  brush.line(3, 3, 0, 0);
  assert.equal(pixels[3], 128);
  assert.equal(pixels[63], 128);
  const selection = new Uint8Array(16);
  selection[0] = 1;
  const other = new Uint8ClampedArray(64);
  raster(other, { mirrorX: true, selection }).dab(0, 0);
  assert.equal(other[3], 128);
  assert.equal(other[15], 0);
});
test("flood respects transparent regions and erasing preserves color alpha", () => {
  const pixels = new Uint8ClampedArray(64);
  raster(pixels, { color: [5, 6, 7, 255] }).fill(0, 0, 0);
  assert.equal(pixels[63], 255);
  raster(pixels, { erase: true, color: [0, 0, 0, 255] }).dab(2, 2);
  assert.equal(pixels[(2 * 4 + 2) * 4 + 3], 0);
  assert.equal(pixels[3], 255);
});
test("move selected pixels clears source and preserves unrelated pixels", () => {
  const pixels = new Uint8ClampedArray(16);
  pixels.set([255, 0, 0, 255], 0);
  pixels.set([0, 255, 0, 255], 12);
  const moved = translate(pixels, 2, 2, 1, 0, new Uint8Array([1, 0, 0, 0]));
  assert.equal(moved.pixels[3], 0);
  assert.equal(moved.pixels[7], 255);
  assert.equal(moved.pixels[13], 255);
  assert.deepEqual(Array.from(moved.mask!), [0, 1, 0, 0]);
});
