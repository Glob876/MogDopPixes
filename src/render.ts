import type { PixelDocument } from "./document";
export function makeCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}
export function paintPixels(
  canvas: HTMLCanvasElement,
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): void {
  canvas.width = width;
  canvas.height = height;
  canvas
    .getContext("2d")!
    .putImageData(
      new ImageData(new Uint8ClampedArray(pixels), width, height),
      0,
      0,
    );
}
export function composite(
  document: PixelDocument,
  frameIndex: number,
  canvas = makeCanvas(document.width, document.height),
): HTMLCanvasElement {
  canvas.width = document.width;
  canvas.height = document.height;
  const context = canvas.getContext("2d")!;
  const temporary = makeCanvas(document.width, document.height);
  for (let index = document.layers.length - 1; index >= 0; index -= 1) {
    const layer = document.layers[index];
    if (!layer.visible || layer.opacity === 0) continue;
    paintPixels(
      temporary,
      document.frames[frameIndex].cels[index],
      document.width,
      document.height,
    );
    context.globalAlpha = layer.opacity;
    context.globalCompositeOperation = layer.blend;
    context.drawImage(temporary, 0, 0);
  }
  context.globalAlpha = 1;
  context.globalCompositeOperation = "source-over";
  return canvas;
}
export function rgba(hex: string, alpha = 255): number[] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
    Math.round(alpha),
  ];
}
export function hex(rgb: ArrayLike<number>): string {
  return `#${Array.from(rgb)
    .slice(0, 3)
    .map((channel) => Math.round(channel).toString(16).padStart(2, "0"))
    .join("")}`;
}
export function blendPixel(
  pixels: Uint8ClampedArray,
  index: number,
  color: number[],
  erase = false,
): void {
  const offset = index * 4;
  const alpha = color[3] / 255;
  const oldAlpha = pixels[offset + 3] / 255;
  if (erase) {
    pixels[offset + 3] = Math.round(oldAlpha * (1 - alpha) * 255);
    return;
  }
  const newAlpha = alpha + oldAlpha * (1 - alpha);
  if (newAlpha === 0) return;
  for (let channel = 0; channel < 3; channel += 1)
    pixels[offset + channel] =
      (color[channel] * alpha +
        pixels[offset + channel] * oldAlpha * (1 - alpha)) /
      newAlpha;
  pixels[offset + 3] = newAlpha * 255;
}
export function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
export function canvasBlob(
  canvas: HTMLCanvasElement,
  type = "image/png",
): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(new Error("Не удалось закодировать изображение.")),
      type,
      0.95,
    ),
  );
}
export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ]!,
  );
}
