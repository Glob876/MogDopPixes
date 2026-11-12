import { line_points, flood_mask } from "./wasm/mogdoppixes_core";
import { bytes } from "./core";
import { blendPixel } from "./render";
export interface BrushOptions {
  size: number;
  color: number[];
  secondary: number[];
  opacity: number;
  erase: boolean;
  dither: boolean;
  round: boolean;
  filled: boolean;
  mirrorX: boolean;
  mirrorY: boolean;
  wrap: boolean;
  selection?: Uint8Array;
  stamp?: { width: number; height: number; pixels: Uint8ClampedArray };
}
export class Raster {
  covered: Uint8Array;
  constructor(
    public pixels: Uint8ClampedArray,
    public width: number,
    public height: number,
    public options: BrushOptions,
  ) {
    this.covered = new Uint8Array(width * height);
  }
  dot(x: number, y: number, color = this.options.color): void {
    const variants = [[x, y]];
    if (this.options.mirrorX) variants.push([this.width - 1 - x, y]);
    if (this.options.mirrorY) variants.push([x, this.height - 1 - y]);
    if (this.options.mirrorX && this.options.mirrorY)
      variants.push([this.width - 1 - x, this.height - 1 - y]);
    for (let [px, py] of variants) {
      if (this.options.wrap) {
        px = ((px % this.width) + this.width) % this.width;
        py = ((py % this.height) + this.height) % this.height;
      }
      if (px < 0 || py < 0 || px >= this.width || py >= this.height) continue;
      const index = py * this.width + px;
      if (
        this.covered[index] ||
        (this.options.selection && !this.options.selection[index])
      )
        continue;
      this.covered[index] = 1;
      const selected =
        this.options.dither && (px + py) % 2 ? this.options.secondary : color;
      blendPixel(
        this.pixels,
        index,
        [
          selected[0],
          selected[1],
          selected[2],
          selected[3] * this.options.opacity,
        ],
        this.options.erase,
      );
    }
  }
  dab(cx: number, cy: number): void {
    const stamp = this.options.stamp;
    if (stamp) {
      for (let y = 0; y < stamp.height; y += 1)
        for (let x = 0; x < stamp.width; x += 1) {
          const index = (y * stamp.width + x) * 4;
          if (stamp.pixels[index + 3])
            this.dot(
              cx + x - Math.floor(stamp.width / 2),
              cy + y - Math.floor(stamp.height / 2),
              Array.from(stamp.pixels.subarray(index, index + 4)),
            );
        }
      return;
    }
    const size = this.options.size;
    const minimum = -Math.floor(size / 2);
    const maximum = minimum + size;
    for (let y = minimum; y < maximum; y += 1)
      for (let x = minimum; x < maximum; x += 1) {
        if (
          this.options.round &&
          size > 2 &&
          (x + 0.5) ** 2 + (y + 0.5) ** 2 > (size / 2) ** 2
        )
          continue;
        this.dot(cx + x, cy + y);
      }
  }
  line(x0: number, y0: number, x1: number, y1: number): void {
    const points = line_points(x0, y0, x1, y1);
    for (let index = 0; index < points.length; index += 2)
      this.dab(points[index], points[index + 1]);
  }
  rectangle(x0: number, y0: number, x1: number, y1: number): void {
    const left = Math.min(x0, x1);
    const right = Math.max(x0, x1);
    const top = Math.min(y0, y1);
    const bottom = Math.max(y0, y1);
    if (this.options.filled) {
      for (
        let y = Math.max(0, top);
        y <= Math.min(this.height - 1, bottom);
        y += 1
      )
        for (
          let x = Math.max(0, left);
          x <= Math.min(this.width - 1, right);
          x += 1
        )
          this.dot(x, y);
    } else {
      this.line(left, top, right, top);
      this.line(right, top, right, bottom);
      this.line(right, bottom, left, bottom);
      this.line(left, bottom, left, top);
    }
  }
  ellipse(x0: number, y0: number, x1: number, y1: number): void {
    const left = Math.min(x0, x1);
    const right = Math.max(x0, x1);
    const top = Math.min(y0, y1);
    const bottom = Math.max(y0, y1);
    const rx = (right - left + 1) / 2;
    const ry = (bottom - top + 1) / 2;
    const cx = left + rx - 0.5;
    const cy = top + ry - 0.5;
    for (
      let y = Math.max(0, top);
      y <= Math.min(this.height - 1, bottom);
      y += 1
    )
      for (
        let x = Math.max(0, left);
        x <= Math.min(this.width - 1, right);
        x += 1
      ) {
        const norm = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
        const innerRx = Math.max(0.1, rx - this.options.size);
        const innerRy = Math.max(0.1, ry - this.options.size);
        const inner = ((x - cx) / innerRx) ** 2 + ((y - cy) / innerRy) ** 2;
        if (norm <= 1 && (this.options.filled || inner >= 1)) this.dot(x, y);
      }
  }
  gradient(x0: number, y0: number, x1: number, y1: number): void {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const denominator = dx * dx + dy * dy || 1;
    for (let y = 0; y < this.height; y += 1)
      for (let x = 0; x < this.width; x += 1) {
        let amount = Math.max(
          0,
          Math.min(1, ((x - x0) * dx + (y - y0) * dy) / denominator),
        );
        if (this.options.dither)
          amount = amount > ((x % 2) + 2 * (y % 2) + 0.5) / 4 ? 1 : 0;
        const color = this.options.color.map((value, channel) =>
          Math.round(
            value + (this.options.secondary[channel] - value) * amount,
          ),
        );
        this.dot(x, y, color);
      }
  }
  fill(x: number, y: number, tolerance: number): void {
    const mask = flood_mask(
      bytes(this.pixels),
      this.width,
      this.height,
      x,
      y,
      tolerance,
    );
    for (let index = 0; index < mask.length; index += 1)
      if (mask[index])
        this.dot(index % this.width, Math.floor(index / this.width));
  }
}
export function rectangleMask(
  width: number,
  height: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): Uint8Array {
  const mask = new Uint8Array(width * height);
  for (
    let y = Math.max(0, Math.min(y0, y1));
    y <= Math.min(height - 1, Math.max(y0, y1));
    y += 1
  )
    for (
      let x = Math.max(0, Math.min(x0, x1));
      x <= Math.min(width - 1, Math.max(x0, x1));
      x += 1
    )
      mask[y * width + x] = 1;
  return mask;
}
export function translate(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  dx: number,
  dy: number,
  selection?: Uint8Array,
): { pixels: Uint8ClampedArray; mask?: Uint8Array } {
  const output = selection
    ? pixels.slice()
    : new Uint8ClampedArray(pixels.length);
  const mask = selection ? new Uint8Array(selection.length) : undefined;
  if (selection)
    for (let index = 0; index < selection.length; index += 1)
      if (selection[index]) output.fill(0, index * 4, index * 4 + 4);
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) {
      const source = y * width + x;
      if (selection && !selection[source]) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const target = ny * width + nx;
      blendPixel(
        output,
        target,
        Array.from(pixels.subarray(source * 4, source * 4 + 4)),
      );
      if (mask) mask[target] = 1;
    }
  return { pixels: output, mask };
}
