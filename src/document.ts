export type BlendMode = "source-over" | "multiply" | "screen" | "overlay";
export interface Layer {
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
  blend: BlendMode;
}
export interface Frame {
  duration: number;
  cels: Uint8ClampedArray[];
}
export interface PixelDocument {
  name: string;
  width: number;
  height: number;
  palette: string[];
  layers: Layer[];
  frames: Frame[];
}
export const MAX_PIXELS = 8 * 1024 * 1024;
export const MAX_DIMENSION = 2048;
export const MAX_FILE_BYTES = 64 * 1024 * 1024;
export function checkBudget(
  width: number,
  height: number,
  layers = 1,
  frames = 1,
): void {
  if (
    ![width, height, layers, frames].every(Number.isSafeInteger) ||
    width < 1 ||
    height < 1 ||
    width > MAX_DIMENSION ||
    height > MAX_DIMENSION ||
    layers < 1 ||
    layers > 128 ||
    frames < 1 ||
    frames > 512 ||
    width * height * layers * frames > MAX_PIXELS
  ) {
    throw new Error(
      "Слишком большой проект. До 2048 px на сторону, 128 слоёв, 512 кадров и 8 млн пикселей суммарно.",
    );
  }
}
export function createDocument(
  width: number,
  height: number,
  name = "Без названия",
  palette: string[] = ["#202c30", "#47684e", "#f7f6f2"],
): PixelDocument {
  checkBudget(width, height);
  return {
    name,
    width,
    height,
    palette: [...palette],
    layers: [
      {
        name: "Слой 1",
        visible: true,
        locked: false,
        opacity: 1,
        blend: "source-over",
      },
    ],
    frames: [
      { duration: 100, cels: [new Uint8ClampedArray(width * height * 4)] },
    ],
  };
}
export function cloneDocument(document: PixelDocument): PixelDocument {
  return structuredClone(document);
}
export function documentBytes(document: PixelDocument): number {
  return (
    document.width *
    document.height *
    document.layers.length *
    document.frames.length *
    4
  );
}
export class History {
  private previous: PixelDocument[] = [];
  private next: PixelDocument[] = [];
  private bytes = 0;
  constructor(private limit = 80 * 1024 * 1024) {}
  get canUndo() {
    return this.previous.length > 0;
  }
  get canRedo() {
    return this.next.length > 0;
  }
  clear() {
    this.previous = [];
    this.next = [];
    this.bytes = 0;
  }
  push(before: PixelDocument) {
    this.previous.push(before);
    this.bytes += documentBytes(before);
    this.next = [];
    while (
      this.previous.length > 1 &&
      (this.bytes > this.limit || this.previous.length > 60)
    ) {
      this.bytes -= documentBytes(this.previous.shift()!);
    }
  }
  undo(current: PixelDocument): PixelDocument | undefined {
    const previous = this.previous.pop();
    if (!previous) return;
    this.bytes -= documentBytes(previous);
    this.next.push(current);
    return previous;
  }
  redo(current: PixelDocument): PixelDocument | undefined {
    const next = this.next.pop();
    if (!next) return;
    this.previous.push(current);
    this.bytes += documentBytes(current);
    return next;
  }
}
export function encodeBytes(bytes: Uint8ClampedArray): string {
  let binary = "";
  for (let start = 0; start < bytes.length; start += 32768)
    binary += String.fromCharCode(...bytes.subarray(start, start + 32768));
  return btoa(binary);
}
export function decodeBytes(
  encoded: string,
  length: number,
): Uint8ClampedArray {
  if (encoded.length !== 4 * Math.ceil(length / 3))
    throw new Error("Неверный размер данных слоя.");
  const binary = atob(encoded);
  if (binary.length !== length) throw new Error("Повреждённые данные слоя.");
  const bytes = new Uint8ClampedArray(length);
  for (let index = 0; index < length; index += 1)
    bytes[index] = binary.charCodeAt(index);
  return bytes;
}
export function serializeDocument(document: PixelDocument): string {
  return JSON.stringify({
    format: "MogDopPixes",
    version: 1,
    ...document,
    frames: document.frames.map((frame) => ({
      duration: frame.duration,
      cels: frame.cels.map(encodeBytes),
    })),
  });
}
export function parseDocument(text: string): PixelDocument {
  const value = JSON.parse(text);
  if (
    value.format !== "MogDopPixes" ||
    value.version !== 1 ||
    !Array.isArray(value.layers) ||
    !Array.isArray(value.frames)
  )
    throw new Error("Это не проект MogDopPixes версии 1.");
  checkBudget(
    value.width,
    value.height,
    value.layers.length,
    value.frames.length,
  );
  if (
    typeof value.name !== "string" ||
    value.name.length > 200 ||
    !Array.isArray(value.palette) ||
    value.palette.length > 256 ||
    !value.palette.every(
      (color: unknown) =>
        typeof color === "string" && /^#[0-9a-f]{6}$/i.test(color),
    )
  )
    throw new Error("Неверное название или палитра проекта.");
  const layers = value.layers.map((layer: Layer) => {
    if (
      typeof layer.name !== "string" ||
      layer.name.length > 200 ||
      typeof layer.visible !== "boolean" ||
      typeof layer.locked !== "boolean" ||
      !Number.isFinite(layer.opacity) ||
      layer.opacity < 0 ||
      layer.opacity > 1 ||
      !["source-over", "multiply", "screen", "overlay"].includes(layer.blend)
    )
      throw new Error("Повреждённые свойства слоя.");
    return {
      name: layer.name,
      visible: layer.visible,
      locked: layer.locked,
      opacity: layer.opacity,
      blend: layer.blend,
    };
  });
  const frames = value.frames.map(
    (frame: { duration: number; cels: string[] }) => {
      if (
        !Number.isInteger(frame.duration) ||
        frame.duration < 10 ||
        frame.duration > 60000 ||
        !Array.isArray(frame.cels) ||
        frame.cels.length !== layers.length ||
        !frame.cels.every((cel) => typeof cel === "string")
      )
        throw new Error("Повреждённые данные кадра.");
      return {
        duration: frame.duration,
        cels: frame.cels.map((cel) =>
          decodeBytes(cel, value.width * value.height * 4),
        ),
      };
    },
  );
  return {
    name: value.name,
    width: value.width,
    height: value.height,
    palette: value.palette,
    layers,
    frames,
  };
}
export function addLayer(
  document: PixelDocument,
  index: number,
  duplicate = false,
): void {
  checkBudget(
    document.width,
    document.height,
    document.layers.length + 1,
    document.frames.length,
  );
  const source = document.layers[index];
  document.layers.splice(
    index,
    0,
    duplicate
      ? { ...source, name: `${source.name} · копия`.slice(0, 200) }
      : {
          name: `Слой ${document.layers.length + 1}`,
          visible: true,
          locked: false,
          opacity: 1,
          blend: "source-over",
        },
  );
  for (const frame of document.frames)
    frame.cels.splice(
      index,
      0,
      duplicate
        ? frame.cels[index].slice()
        : new Uint8ClampedArray(document.width * document.height * 4),
    );
}
export function deleteLayer(document: PixelDocument, index: number): void {
  if (document.layers.length === 1)
    throw new Error("В проекте должен остаться хотя бы один слой.");
  document.layers.splice(index, 1);
  for (const frame of document.frames) frame.cels.splice(index, 1);
}
export function moveLayer(
  document: PixelDocument,
  from: number,
  to: number,
): void {
  if (to < 0 || to >= document.layers.length) return;
  const layer = document.layers.splice(from, 1)[0];
  document.layers.splice(to, 0, layer);
  for (const frame of document.frames) {
    const cel = frame.cels.splice(from, 1)[0];
    frame.cels.splice(to, 0, cel);
  }
}
export function addFrame(
  document: PixelDocument,
  index: number,
  duplicate: boolean,
): void {
  checkBudget(
    document.width,
    document.height,
    document.layers.length,
    document.frames.length + 1,
  );
  const source = document.frames[index];
  document.frames.splice(index + 1, 0, {
    duration: source.duration,
    cels: source.cels.map((cel) =>
      duplicate ? cel.slice() : new Uint8ClampedArray(cel.length),
    ),
  });
}
