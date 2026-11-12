import { GIFEncoder, quantize, applyPalette } from "gifenc";
import { parseGIF, decompressFrames } from "gifuct-js";
import {
  checkBudget,
  createDocument,
  MAX_FILE_BYTES,
  MAX_PIXELS,
  parseDocument,
  serializeDocument,
  type PixelDocument,
} from "./document";
import {
  composite,
  makeCanvas,
  canvasBlob,
  download,
  hex,
  rgba,
} from "./render";

export function saveProject(document: PixelDocument): void {
  download(
    new Blob([serializeDocument(document)], { type: "application/json" }),
    `${document.name}.pixes`,
  );
}
export async function importFile(file: File): Promise<PixelDocument> {
  if (file.size > MAX_FILE_BYTES) throw new Error("Файл больше 64 МиБ.");
  const name = file.name.replace(/\.[^.]+$/, "").slice(0, 200);
  if (/\.pixes$/i.test(file.name)) return parseDocument(await file.text());
  if (/\.(ase|aseprite)$/i.test(file.name))
    return importAseprite(await file.arrayBuffer(), name);
  if (/\.gif$/i.test(file.name) || file.type === "image/gif") {
    const parsed = parseGIF(await file.arrayBuffer());
    const count = parsed.frames.filter((frame) => "image" in frame).length;
    checkBudget(parsed.lsd.width, parsed.lsd.height, 1, count);
    const decoded = decompressFrames(parsed, true);
    const document = createDocument(parsed.lsd.width, parsed.lsd.height, name);
    document.frames = [];
    const canvas = makeCanvas(document.width, document.height);
    const context = canvas.getContext("2d")!;
    let previous: ImageData | undefined;
    for (let index = 0; index < decoded.length; index += 1) {
      const frame = decoded[index];
      if (index > 0) {
        const last = decoded[index - 1];
        if (last.disposalType === 2)
          context.clearRect(
            last.dims.left,
            last.dims.top,
            last.dims.width,
            last.dims.height,
          );
        if (last.disposalType === 3 && previous)
          context.putImageData(previous, 0, 0);
      }
      previous = context.getImageData(0, 0, document.width, document.height);
      const patch = makeCanvas(frame.dims.width, frame.dims.height);
      patch
        .getContext("2d")!
        .putImageData(
          new ImageData(
            new Uint8ClampedArray(frame.patch),
            frame.dims.width,
            frame.dims.height,
          ),
          0,
          0,
        );
      context.drawImage(patch, frame.dims.left, frame.dims.top);
      document.frames.push({
        duration: Math.max(10, frame.delay || 100),
        cels: [
          context.getImageData(0, 0, document.width, document.height).data,
        ],
      });
    }
    document.palette = extractPalette(document.frames[0].cels[0]);
    return document;
  }
  const bitmap = await createImageBitmap(file);
  try {
    checkBudget(bitmap.width, bitmap.height);
    const document = createDocument(bitmap.width, bitmap.height, name);
    const canvas = makeCanvas(bitmap.width, bitmap.height);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
    document.frames[0].cels[0] = canvas
      .getContext("2d")!
      .getImageData(0, 0, bitmap.width, bitmap.height).data;
    document.palette = extractPalette(document.frames[0].cels[0]);
    return document;
  } finally {
    bitmap.close();
  }
}
export function extractPalette(pixels: Uint8ClampedArray): string[] {
  const counts = new Map<string, number>();
  for (let offset = 0; offset < pixels.length; offset += 4) {
    if (pixels[offset + 3] === 0) continue;
    const color = hex(pixels.subarray(offset, offset + 3));
    counts.set(color, (counts.get(color) || 0) + 1);
  }
  return [...counts]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 256)
    .map(([color]) => color);
}
export function parsePalette(text: string): string[] {
  let result: string[];
  if (text.trim().startsWith("JASC-PAL")) {
    const lines = text.trim().split(/\r?\n/);
    result = lines
      .slice(3)
      .filter((line) => /^\s*\d+\s+\d+\s+\d+\s*$/.test(line))
      .map((line) =>
        hex(
          line
            .trim()
            .split(/\s+/)
            .map(Number)
            .map((value) => Math.max(0, Math.min(255, value))),
        ),
      );
  } else if (text.startsWith("GIMP Palette")) {
    result = text
      .split(/\r?\n/)
      .filter((line) => /^\s*\d+\s+\d+\s+\d+/.test(line))
      .map((line) =>
        hex(
          line
            .trim()
            .split(/\s+/)
            .slice(0, 3)
            .map(Number)
            .map((value) => Math.max(0, Math.min(255, value))),
        ),
      );
  } else result = text.match(/#[0-9a-f]{6}\b/gi) || [];
  result = [...new Set(result.map((color) => color.toLowerCase()))].slice(
    0,
    256,
  );
  if (!result.length)
    throw new Error("Нет цветов. Поддерживаются JASC PAL, GIMP GPL и HEX.");
  return result;
}
export function exportPalette(document: PixelDocument): void {
  const text = `JASC-PAL\r\n0100\r\n${document.palette.length}\r\n${document.palette.map((color) => rgba(color).slice(0, 3).join(" ")).join("\r\n")}\r\n`;
  download(new Blob([text], { type: "text/plain" }), `${document.name}.pal`);
}
export async function exportImage(
  document: PixelDocument,
  frame: number,
  scale: number,
  format: string,
  columns: number,
): Promise<void> {
  const sheet = format === "sheet";
  const count = sheet ? document.frames.length : 1;
  const cols = sheet ? Math.min(columns, count) : 1;
  const rows = Math.ceil(count / cols);
  const width = document.width * scale * cols;
  const height = document.height * scale * rows;
  if (width > 16384 || height > 16384 || width * height > 32 * 1024 * 1024)
    throw new Error(
      "Экспорт слишком большой. Уменьшите масштаб или число столбцов.",
    );
  const canvas = makeCanvas(width, height);
  const context = canvas.getContext("2d")!;
  context.imageSmoothingEnabled = false;
  if (format === "jpeg") {
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
  }
  for (let index = 0; index < count; index += 1)
    context.drawImage(
      composite(document, sheet ? index : frame),
      (index % cols) * document.width * scale,
      Math.floor(index / cols) * document.height * scale,
      document.width * scale,
      document.height * scale,
    );
  const type =
    format === "jpeg"
      ? "image/jpeg"
      : format === "webp"
        ? "image/webp"
        : "image/png";
  download(
    await canvasBlob(canvas, type),
    `${document.name}${sheet ? "-sheet" : ""}.${format === "jpeg" ? "jpg" : format === "webp" ? "webp" : "png"}`,
  );
  if (sheet) {
    const metadata = {
      image: `${document.name}-sheet.png`,
      width,
      height,
      frames: document.frames.map((item, index) => ({
        x: (index % cols) * document.width * scale,
        y: Math.floor(index / cols) * document.height * scale,
        width: document.width * scale,
        height: document.height * scale,
        duration: item.duration,
      })),
    };
    download(
      new Blob([JSON.stringify(metadata, null, 2)], {
        type: "application/json",
      }),
      `${document.name}-sheet.json`,
    );
  }
}
export async function exportGif(
  document: PixelDocument,
  scale: number,
  signal: AbortSignal,
  progress: (value: number) => void,
): Promise<void> {
  const width = document.width * scale;
  const height = document.height * scale;
  if (width * height > 4 * 1024 * 1024)
    throw new Error(
      "Для GIF уменьшите масштаб: не более 4 млн пикселей на кадр.",
    );
  const gif = GIFEncoder();
  const canvas = makeCanvas(width, height);
  const context = canvas.getContext("2d")!;
  context.imageSmoothingEnabled = false;
  for (let index = 0; index < document.frames.length; index += 1) {
    signal.throwIfAborted();
    context.clearRect(0, 0, width, height);
    context.drawImage(composite(document, index), 0, 0, width, height);
    const pixels = context.getImageData(0, 0, width, height).data;
    const palette = quantize(pixels, 256, {
      format: "rgba4444",
      oneBitAlpha: true,
    });
    const mapped = applyPalette(pixels, palette, "rgba4444");
    const transparentIndex = palette.findIndex((color) => color[3] === 0);
    gif.writeFrame(mapped, width, height, {
      palette,
      delay: document.frames[index].duration,
      transparent: transparentIndex !== -1,
      transparentIndex: Math.max(0, transparentIndex),
      dispose: 2,
      repeat: 0,
    });
    progress(Math.round(((index + 1) / document.frames.length) * 100));
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  signal.throwIfAborted();
  gif.finish();
  download(
    new Blob([new Uint8Array(gif.bytes())], { type: "image/gif" }),
    `${document.name}.gif`,
  );
}

// Native Aseprite RGBA normal-layer import; reject unsupported semantics explicitly.
async function importAseprite(
  buffer: ArrayBuffer,
  name: string,
): Promise<PixelDocument> {
  const view = new DataView(buffer);
  if (
    buffer.byteLength < 128 ||
    view.getUint16(4, true) !== 0xa5e0 ||
    view.getUint32(0, true) !== buffer.byteLength
  )
    throw new Error("Повреждённый Aseprite-файл.");
  const count = view.getUint16(6, true);
  const width = view.getUint16(8, true);
  const height = view.getUint16(10, true);
  if (view.getUint16(12, true) !== 32)
    throw new Error("Импорт Aseprite пока поддерживает только RGBA (32 бита).");
  checkBudget(width, height, 1, count);
  const document = createDocument(width, height, name);
  document.layers = [];
  document.frames = [];
  let offset = 128;
  let decodedPixels = 0;
  const celRecords: {
    frame: number;
    layer: number;
    x: number;
    y: number;
    opacity: number;
    w: number;
    h: number;
    pixels?: Uint8Array;
    link?: number;
  }[] = [];
  for (let fi = 0; fi < count; fi += 1) {
    if (
      offset + 16 > buffer.byteLength ||
      view.getUint16(offset + 4, true) !== 0xf1fa
    )
      throw new Error("Повреждённый кадр Aseprite.");
    const end = offset + view.getUint32(offset, true);
    if (end > buffer.byteLength || end <= offset + 15)
      throw new Error("Неверная длина кадра Aseprite.");
    const chunks =
      view.getUint32(offset + 12, true) || view.getUint16(offset + 6, true);
    document.frames.push({
      duration: Math.max(10, view.getUint16(offset + 8, true) || 100),
      cels: [],
    });
    let chunk = offset + 16;
    for (let ci = 0; ci < chunks; ci += 1) {
      if (chunk + 6 > end) throw new Error("Повреждённый блок Aseprite.");
      const size = view.getUint32(chunk, true);
      const type = view.getUint16(chunk + 4, true);
      const data = chunk + 6;
      if (size < 6 || chunk + size > end)
        throw new Error("Неверная длина блока Aseprite.");
      if (type === 0x2004) {
        if (
          size < 24 ||
          view.getUint16(data + 2, true) !== 0 ||
          view.getUint16(data + 10, true) !== 0
        )
          throw new Error(
            "Aseprite: группы, тайлы и режимы наложения пока не поддерживаются. Сведите их в обычные слои.",
          );
        const flags = view.getUint16(data, true);
        const length = view.getUint16(data + 16, true);
        if (data + 18 + length > chunk + size)
          throw new Error("Повреждённое имя слоя Aseprite.");
        const layerName = new TextDecoder()
          .decode(buffer.slice(data + 18, data + 18 + length))
          .slice(0, 200);
        document.layers.push({
          name: layerName,
          visible: Boolean(flags & 1),
          locked: !(flags & 2),
          opacity: view.getUint8(data + 12) / 255,
          blend: "source-over",
        });
        checkBudget(width, height, document.layers.length, count);
      } else if (type === 0x2005) {
        if (size < 22) throw new Error("Повреждённая ячейка Aseprite.");
        const layer = view.getUint16(data, true);
        const x = view.getInt16(data + 2, true);
        const y = view.getInt16(data + 4, true);
        const opacity = view.getUint8(data + 6);
        const kind = view.getUint16(data + 7, true);
        if (kind === 1) {
          if (size < 24) throw new Error("Повреждённая ссылка Aseprite.");
          celRecords.push({
            frame: fi,
            layer,
            x,
            y,
            opacity,
            w: 0,
            h: 0,
            link: view.getUint16(data + 16, true),
          });
        } else if (kind === 0 || kind === 2) {
          if (size < 26) throw new Error("Повреждённое изображение Aseprite.");
          const w = view.getUint16(data + 16, true);
          const h = view.getUint16(data + 18, true);
          checkBudget(w, h);
          decodedPixels += w * h;
          if (decodedPixels > MAX_PIXELS)
            throw new Error("Слишком много распакованных пикселей Aseprite.");
          const raw = new Uint8Array(buffer.slice(data + 20, chunk + size));
          let pixels = raw;
          if (kind === 2) {
            const stream = new Blob([raw])
              .stream()
              .pipeThrough(new DecompressionStream("deflate"));
            const reader = stream.getReader();
            const output = new Uint8Array(w * h * 4);
            let written = 0;
            while (true) {
              const item = await reader.read();
              if (item.done) break;
              if (written + item.value.length > output.length) {
                await reader.cancel();
                throw new Error("Превышен размер распакованной ячейки.");
              }
              output.set(item.value, written);
              written += item.value.length;
            }
            if (written !== output.length)
              throw new Error("Повреждённая сжатая ячейка Aseprite.");
            pixels = output;
          }
          if (pixels.length !== w * h * 4)
            throw new Error("Неверный размер ячейки Aseprite.");
          celRecords.push({ frame: fi, layer, x, y, opacity, w, h, pixels });
        } else
          throw new Error("Тайловые ячейки Aseprite пока не поддерживаются.");
      }
      chunk += size;
    }
    offset = end;
  }
  checkBudget(width, height, document.layers.length, count);
  for (const frame of document.frames)
    frame.cels = document.layers.map(
      () => new Uint8ClampedArray(width * height * 4),
    );
  for (const record of celRecords) {
    if (record.layer >= document.layers.length)
      throw new Error("Неверный индекс слоя Aseprite.");
    let image = record;
    while (image.link !== undefined) {
      const linkedFrame = image.link;
      if (linkedFrame >= image.frame)
        throw new Error("Неподдерживаемая ссылка Aseprite.");
      const linked = celRecords.find(
        (candidate) =>
          candidate.frame === linkedFrame && candidate.layer === image.layer,
      );
      if (!linked) throw new Error("Связанная ячейка Aseprite не найдена.");
      image = linked;
    }
    const destination = document.frames[record.frame].cels[record.layer];
    for (let y = 0; y < image.h; y += 1)
      for (let x = 0; x < image.w; x += 1) {
        const dx = x + record.x;
        const dy = y + record.y;
        if (dx < 0 || dy < 0 || dx >= width || dy >= height) continue;
        const source = (y * image.w + x) * 4;
        const target = (dy * width + dx) * 4;
        destination.set(image.pixels!.subarray(source, source + 4), target);
        destination[target + 3] =
          (destination[target + 3] * record.opacity) / 255;
      }
  }
  document.layers.reverse();
  for (const frame of document.frames) frame.cels.reverse();
  document.palette = extractPalette(
    composite(document, 0).getContext("2d")!.getImageData(0, 0, width, height)
      .data,
  );
  return document;
}
