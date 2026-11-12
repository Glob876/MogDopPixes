import "./style.css";
import { mountLayout, tools } from "./layout";
import { icon } from "./icons";
import { colors, drawArtwork } from "./art";
import { initializeCore, bytes } from "./core";
import {
  transform,
  resize_nearest,
  apply_palette,
  flood_mask,
} from "./wasm/mogdoppixes_core";
import {
  createDocument,
  cloneDocument,
  checkBudget,
  History,
  addLayer,
  deleteLayer,
  moveLayer,
  addFrame,
  parseDocument,
  serializeDocument,
  encodeBytes,
  decodeBytes,
  type PixelDocument,
  type BlendMode,
} from "./document";
import {
  makeCanvas,
  paintPixels,
  composite,
  rgba,
  hex,
  blendPixel,
  escapeHtml,
} from "./render";
import {
  importFile,
  saveProject,
  exportImage,
  exportGif,
  extractPalette,
  parsePalette,
  exportPalette,
} from "./files";
import { Raster, rectangleMask, translate, type BrushOptions } from "./raster";
import { readRecovery, writeRecovery } from "./storage";

initializeCore();
mountLayout();
function get<T extends HTMLElement = HTMLElement>(selector: string): T {
  return document.querySelector<T>(selector)!;
}
const artwork = get<HTMLCanvasElement>("#artwork");
const mini = get<HTMLCanvasElement>("#navigator");
const viewport = get("#viewport");
const artboard = get("#artboard");
const dialog = get<HTMLDialogElement>("#dialog");
const history = new History();
let project = sampleDocument();
let selectedLayer = 0;
let selectedFrame = 0;
let selectedTool = "pencil";
let foreground = colors[2];
let background = "#f7f6f2";
let colorAlpha = 255;
let selection: Uint8Array | undefined;
let clipboard:
  { width: number; height: number; pixels: Uint8ClampedArray } | undefined;
let stamp: BrushOptions["stamp"];
let brushRound = false;
let gridWidth = 1;
let gridHeight = 1;
let gridColor = "#202c30";
let gridOpacity = 20;
let brushLibrary: {
  name: string;
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
}[] = [];
try {
  const saved = JSON.parse(localStorage.getItem("pixes-brushes") || "[]");
  if (Array.isArray(saved))
    brushLibrary = saved.slice(0, 16).map((brush) => {
      if (
        !Number.isInteger(brush.width) ||
        !Number.isInteger(brush.height) ||
        brush.width < 1 ||
        brush.width > 64 ||
        brush.height < 1 ||
        brush.height > 64 ||
        typeof brush.name !== "string" ||
        typeof brush.pixels !== "string"
      )
        throw new Error("Invalid brush");
      return {
        ...brush,
        name: brush.name.slice(0, 64),
        pixels: decodeBytes(brush.pixels, brush.width * brush.height * 4),
      };
    });
} catch {
  brushLibrary = [];
}
let filled = false;
let tolerance = 0;
let symmetry = 0;
let tile = false;
let onion = false;
let precise = false;
let zoom = 6;
let fit = true;
let panX = 0;
let panY = 0;
let playing = false;
let playTimer: ReturnType<typeof setTimeout> | undefined;
let toastTimer: ReturnType<typeof setTimeout>;
let saveTimer: ReturnType<typeof setTimeout>;
let dirty = false;
let drawer = "";
let referenceUrl: string | undefined;
let exportController: AbortController | undefined;
let busy = false;
let modalCallback: ((data: FormData) => void | Promise<void>) | undefined;
let modalResolve: ((value: boolean) => void) | undefined;
let pointerState:
  | {
      id: number;
      startX: number;
      startY: number;
      lastX: number;
      lastY: number;
      before: PixelDocument;
      source: Uint8ClampedArray;
      selection?: Uint8Array;
      raster: Raster;
      changed: boolean;
      pan: boolean;
      clientX: number;
      clientY: number;
      panX: number;
      panY: number;
    }
  | undefined;
const touches = new Map<number, { x: number; y: number }>();
let pinch:
  | {
      distance: number;
      zoom: number;
      x: number;
      y: number;
      panX: number;
      panY: number;
    }
  | undefined;
let spaceDown = false;

function sampleDocument(): PixelDocument {
  const sample = createDocument(64, 64, "Лесной домик", colors);
  sample.layers = [
    {
      name: "Домик",
      visible: true,
      locked: false,
      opacity: 1,
      blend: "source-over",
    },
    {
      name: "Лес и ручей",
      visible: true,
      locked: false,
      opacity: 1,
      blend: "source-over",
    },
    {
      name: "Небо и горы",
      visible: true,
      locked: true,
      opacity: 1,
      blend: "source-over",
    },
  ];
  sample.frames = Array.from({ length: 6 }, (_, index) => ({
    duration: 160,
    cels: ["house", "ground", "sky"].map((variant) => {
      const canvas = makeCanvas(64, 64);
      drawArtwork(canvas, index, variant);
      return canvas.getContext("2d")!.getImageData(0, 0, 64, 64).data;
    }),
  }));
  return sample;
}
function toast(message: string): void {
  clearTimeout(toastTimer);
  const element = get("#toast");
  element.textContent = message;
  element.hidden = false;
  toastTimer = setTimeout(() => {
    element.hidden = true;
  }, 4500);
}
function failure(error: unknown): void {
  console.error(error);
  toast(
    error instanceof Error ? error.message : "Не удалось выполнить действие.",
  );
}
function editable(): boolean {
  if (busy) {
    toast("Дождитесь завершения экспорта.");
    return false;
  }
  if (project.layers[selectedLayer].locked) {
    toast("Слой заблокирован. Снимите замок справа от его имени.");
    return false;
  }
  if (!project.layers[selectedLayer].visible) {
    toast("Слой скрыт. Включите его видимость.");
    return false;
  }
  return true;
}
function cel(): Uint8ClampedArray {
  return project.frames[selectedFrame].cels[selectedLayer];
}
function markChanged(): void {
  dirty = true;
  get("#dirty-mark").hidden = false;
  clearTimeout(saveTimer);
  get("#autosave-status").innerHTML =
    "Изменения не сохранены в файл<br/><span>Автосохранение…</span>";
  saveTimer = setTimeout(async () => {
    try {
      await writeRecovery(project);
      get("#autosave-status").innerHTML =
        "Черновик сохранён на устройстве<br/><span>Ctrl S — скачать проект .pixes</span>";
    } catch {
      get("#autosave-status").innerHTML =
        "Не удалось сохранить черновик<br/><span>Скачайте проект через Ctrl S</span>";
    }
  }, 700);
}
function commit(before: PixelDocument): void {
  history.push(before);
  markChanged();
  renderAll();
}
function edit(operation: () => void, requireEditable = false): void {
  if (busy || (requireEditable && !editable())) return;
  stopPlayback();
  const before = cloneDocument(project);
  try {
    operation();
    commit(before);
  } catch (error) {
    project = before;
    renderAll();
    failure(error);
  }
}
function clampSelection(): void {
  selectedLayer = Math.max(
    0,
    Math.min(selectedLayer, project.layers.length - 1),
  );
  selectedFrame = Math.max(
    0,
    Math.min(selectedFrame, project.frames.length - 1),
  );
}
function renderAll(): void {
  clampSelection();
  renderCanvas();
  renderLayers();
  renderFrames();
  renderPalette();
  updateLabels();
  updateZoom();
}
function renderCanvas(): void {
  composite(project, selectedFrame, artwork);
  composite(project, selectedFrame, mini);
  const onionCanvas = get<HTMLCanvasElement>("#onion-canvas");
  onionCanvas.width = project.width;
  onionCanvas.height = project.height;
  onionCanvas.hidden = !onion || playing;
  if (onion && !playing) {
    const context = onionCanvas.getContext("2d")!;
    if (selectedFrame > 0) {
      context.globalAlpha = 0.22;
      context.drawImage(composite(project, selectedFrame - 1), 0, 0);
    }
    if (selectedFrame + 1 < project.frames.length) {
      context.globalAlpha = 0.15;
      context.drawImage(composite(project, selectedFrame + 1), 0, 0);
    }
  }
  renderSelection();
  if (tile) {
    artboard.style.backgroundImage = `url(${artwork.toDataURL()})`;
  }
}
function renderSelection(): void {
  const canvas = get<HTMLCanvasElement>("#selection-canvas");
  canvas.width = project.width;
  canvas.height = project.height;
  if (!selection) return;
  const data = new Uint8ClampedArray(project.width * project.height * 4);
  for (let i = 0; i < selection.length; i += 1) {
    if (!selection[i]) continue;
    const x = i % project.width;
    const y = Math.floor(i / project.width);
    if (
      x === 0 ||
      y === 0 ||
      x === project.width - 1 ||
      y === project.height - 1 ||
      !selection[i - 1] ||
      !selection[i + 1] ||
      !selection[i - project.width] ||
      !selection[i + project.width]
    ) {
      const light = (x + y) % 4 < 2 ? 255 : 0;
      data.set([light, light, light, 255], i * 4);
    }
  }
  canvas
    .getContext("2d")!
    .putImageData(new ImageData(data, project.width, project.height), 0, 0);
}
function updateLabels(): void {
  get(".document-title").textContent = project.name;
  get(".document-size").textContent = `${project.width} × ${project.height} px`;
  get(".status-right").innerHTML =
    `${project.width} × ${project.height} px <span>RGBA</span>`;
  get(".workspace-label").textContent =
    `${project.name.toUpperCase()} / ${project.width} × ${project.height}`;
  get(".navigator > span").textContent =
    `${project.width} × ${project.height} px`;
  document.title = `${dirty ? "• " : ""}${project.name} — MogDopPixes`;
  document
    .querySelectorAll<HTMLButtonElement>('[data-action="undo"]')
    .forEach((button) => {
      button.disabled = !history.canUndo;
    });
  document
    .querySelectorAll<HTMLButtonElement>('[data-action="redo"]')
    .forEach((button) => {
      button.disabled = !history.canRedo;
    });
}
function updateZoom(): void {
  if (fit) {
    zoom = Math.max(
      0.05,
      Math.min(
        16,
        (viewport.clientWidth - 64) / project.width,
        (viewport.clientHeight - 96) / project.height,
      ),
    );
    if (zoom >= 1) zoom = Math.max(1, Math.floor(zoom));
  }
  artboard.style.width = `${project.width * zoom}px`;
  artboard.style.height = `${project.height * zoom}px`;
  artboard.style.setProperty("--pixel-size", `${zoom}px`);
  artboard.style.transform = `translate(${panX}px, ${panY}px)`;
  get("#zoom-value").textContent = `${Math.round(zoom * 100)}%`;
  get("#pixel-grid").style.opacity = zoom < 3 ? "0" : "1";
  get("#pixel-grid").style.backgroundSize =
    `${zoom * gridWidth}px ${zoom * gridHeight}px`;
  const gridInk = `${gridColor}${Math.round(gridOpacity * 2.55)
    .toString(16)
    .padStart(2, "0")}`;
  get("#pixel-grid").style.backgroundImage =
    `linear-gradient(to right, ${gridInk} 1px, transparent 1px), linear-gradient(to bottom, ${gridInk} 1px, transparent 1px)`;
}
function zoomBy(factor: number): void {
  fit = false;
  zoom = Math.max(0.05, Math.min(64, zoom * factor));
  updateZoom();
}
function setColor(color: string, alpha = colorAlpha): void {
  foreground = color;
  colorAlpha = alpha;
  get<HTMLInputElement>("#foreground").value = color;
  get("#color-preview").style.background = color;
  get("#hex-color").textContent = color.toUpperCase();
  get(".alpha-label").textContent = `${Math.round((alpha / 255) * 100)}%`;
  renderPalette();
}
function renderPalette(): void {
  get(".swatches").innerHTML = project.palette
    .map(
      (color) =>
        `<button class="swatch ${color.toLowerCase() === foreground.toLowerCase() ? "selected" : ""}" style="--swatch:${color}" data-color="${color}" title="${color}" aria-label="Цвет ${color}" aria-pressed="${color.toLowerCase() === foreground.toLowerCase()}"></button>`,
    )
    .join("");
  get("#palette-panel .count").textContent = String(project.palette.length);
  get(".palette-name > span").innerHTML =
    '<span class="palette-mini"></span>Палитра проекта';
}
function chooseTool(name: string): void {
  selectedTool = name;
  const tool = tools.find((entry) => entry[0] === name)!;
  document
    .querySelectorAll<HTMLButtonElement>("[data-tool]")
    .forEach((button) => {
      const selected = button.dataset.tool === name;
      button.classList.toggle("active", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
  get("#tool-name").textContent = tool[1];
  get(".active-tool-name .icon").outerHTML = icon(name);
  get("#status-tool").textContent = tool[1];
  viewport.dataset.tool = name;
}
function renderLayers(): void {
  get("#layer-list").innerHTML = project.layers
    .map(
      (
        layer,
        index,
      ) => `<div class="layer ${index === selectedLayer ? "selected" : ""}">
    <button class="icon-button layer-visibility" data-visibility="${index}" aria-label="${layer.visible ? "Скрыть" : "Показать"} слой ${escapeHtml(layer.name)}" title="Видимость слоя">${icon(layer.visible ? "eye" : "hidden")}</button>
    <button class="layer-select" data-select-layer="${index}" aria-pressed="${index === selectedLayer}" title="Двойной щелчок — переименовать"><canvas width="64" height="64" data-layer-preview="${index}" aria-hidden="true"></canvas><span>${escapeHtml(layer.name)}<small>${Math.round(layer.opacity * 100)}% · ${project.width} × ${project.height}</small></span></button>
    <button class="icon-button layer-lock ${layer.locked ? "is-locked" : ""}" data-lock="${index}" aria-label="${layer.locked ? "Разблокировать" : "Заблокировать"} слой ${escapeHtml(layer.name)}" title="Блокировка слоя">${icon(layer.locked ? "lock" : "unlock")}</button></div>`,
    )
    .join("");
  document
    .querySelectorAll<HTMLCanvasElement>("[data-layer-preview]")
    .forEach((canvas) =>
      paintPixels(
        canvas,
        project.frames[selectedFrame].cels[Number(canvas.dataset.layerPreview)],
        project.width,
        project.height,
      ),
    );
  get("#layer-count").textContent = String(project.layers.length);
  get("#dock-layer-count").textContent = String(project.layers.length);
  get<HTMLInputElement>("#layer-opacity").value = String(
    Math.round(project.layers[selectedLayer].opacity * 100),
  );
  get<HTMLSelectElement>("#blend-mode").value =
    project.layers[selectedLayer].blend;
}
function renderFrames(): void {
  get("#frames").innerHTML =
    project.frames
      .map(
        (frame, index) =>
          `<button class="frame ${index === selectedFrame ? "selected" : ""}" data-frame="${index}" aria-label="Кадр ${index + 1}" aria-pressed="${index === selectedFrame}"><span class="frame-number">${String(index + 1).padStart(2, "0")}</span><canvas data-frame-preview="${index}" aria-hidden="true"></canvas><span class="frame-duration">${frame.duration} мс</span></button>`,
      )
      .join("") +
    `<button class="add-frame" data-action="add-frame" title="Добавить пустой кадр" aria-label="Добавить кадр">${icon("plus")}</button>`;
  document
    .querySelectorAll<HTMLCanvasElement>("[data-frame-preview]")
    .forEach((canvas) =>
      composite(project, Number(canvas.dataset.framePreview), canvas),
    );
  get("#frame-count").textContent = `${project.frames.length} кадр.`;
  get<HTMLInputElement>("#fps").value = String(
    Math.round((1000 / project.frames[selectedFrame].duration) * 10) / 10,
  );
}
function chooseFrame(index: number): void {
  selectedFrame = index;
  document
    .querySelectorAll<HTMLButtonElement>("[data-frame]")
    .forEach((button) => {
      const selected = Number(button.dataset.frame) === index;
      button.classList.toggle("selected", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
  renderCanvas();
  renderLayers();
}
function stopPlayback(): void {
  playing = false;
  clearTimeout(playTimer);
  get("#play-button").innerHTML = icon("play");
  get("#play-button").setAttribute("aria-label", "Воспроизвести анимацию");
}
function startPlayback(): void {
  if (playing) {
    stopPlayback();
    renderCanvas();
    return;
  }
  playing = true;
  selection = undefined;
  get("#play-button").innerHTML = icon("pause");
  get("#play-button").setAttribute("aria-label", "Остановить анимацию");
  function next() {
    if (!playing) return;
    playTimer = setTimeout(() => {
      chooseFrame((selectedFrame + 1) % project.frames.length);
      next();
    }, project.frames[selectedFrame].duration);
  }
  renderCanvas();
  next();
}
function setDrawer(name: string): void {
  drawer = name;
  get("#app").dataset.drawer = name;
  get("#drawer-backdrop").hidden = !name;
  document
    .querySelectorAll<HTMLButtonElement>(".mobile-dock button")
    .forEach((button) => {
      const active = name
        ? button.dataset.drawer === name
        : button.dataset.action === "close-drawer";
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
}
function closeMenus(): void {
  document.querySelectorAll<HTMLElement>(".menu-popover").forEach((element) => {
    element.hidden = true;
  });
  document
    .querySelectorAll("[data-menu]")
    .forEach((element) => element.setAttribute("aria-expanded", "false"));
}
function brushOptions(event?: PointerEvent): BrushOptions {
  const size = Math.max(
    1,
    Math.min(64, Number(get<HTMLInputElement>("#brush-size").value) || 1),
  );
  const opacity = Math.max(
    0,
    Math.min(
      1,
      (Number(get<HTMLInputElement>("#brush-opacity").value) || 100) / 100,
    ),
  );
  return {
    size,
    color: rgba(event?.button === 2 ? background : foreground, colorAlpha),
    secondary: rgba(background),
    opacity:
      event?.pointerType === "pen"
        ? opacity * Math.max(0.05, event.pressure)
        : opacity,
    erase: selectedTool === "eraser",
    dither: selectedTool === "dither",
    round: brushRound,
    filled,
    mirrorX: symmetry === 1 || symmetry === 3,
    mirrorY: symmetry === 2 || symmetry === 3,
    wrap: tile,
    selection,
    stamp: selectedTool === "pencil" ? stamp : undefined,
  };
}
function position(event: PointerEvent): [number, number] {
  const bounds = artwork.getBoundingClientRect();
  const offset = precise && event.pointerType === "touch" ? 48 : 0;
  return [
    Math.max(
      -4096,
      Math.min(4096, Math.floor((event.clientX - bounds.left) / zoom)),
    ),
    Math.max(
      -4096,
      Math.min(4096, Math.floor((event.clientY - offset - bounds.top) / zoom)),
    ),
  ];
}
function applyShape(
  state: NonNullable<typeof pointerState>,
  x: number,
  y: number,
  constrain: boolean,
): void {
  if (constrain && ["line", "square", "circle"].includes(selectedTool)) {
    const dx = x - state.startX;
    const dy = y - state.startY;
    if (selectedTool === "line") {
      if (Math.abs(dx) > Math.abs(dy) * 2) y = state.startY;
      else if (Math.abs(dy) > Math.abs(dx) * 2) x = state.startX;
      else {
        const size = Math.max(Math.abs(dx), Math.abs(dy));
        x = state.startX + Math.sign(dx) * size;
        y = state.startY + Math.sign(dy) * size;
      }
    } else {
      const size = Math.max(Math.abs(dx), Math.abs(dy));
      x = state.startX + (Math.sign(dx) || 1) * size;
      y = state.startY + (Math.sign(dy) || 1) * size;
    }
  }
  if (["line", "square", "circle", "gradient"].includes(selectedTool)) {
    cel().set(state.source);
    state.raster.covered.fill(0);
    if (selectedTool === "line")
      state.raster.line(state.startX, state.startY, x, y);
    if (selectedTool === "square")
      state.raster.rectangle(state.startX, state.startY, x, y);
    if (selectedTool === "circle")
      state.raster.ellipse(state.startX, state.startY, x, y);
    if (selectedTool === "gradient")
      state.raster.gradient(state.startX, state.startY, x, y);
  } else if (selectedTool === "select") {
    selection = rectangleMask(
      project.width,
      project.height,
      state.startX,
      state.startY,
      x,
      y,
    );
  } else if (selectedTool === "move") {
    const moved = translate(
      state.source,
      project.width,
      project.height,
      x - state.startX,
      y - state.startY,
      state.selection,
    );
    cel().set(moved.pixels);
    selection = moved.mask;
  } else state.raster.line(state.lastX, state.lastY, x, y);
  state.lastX = x;
  state.lastY = y;
  state.changed = true;
  renderCanvas();
}
function finishStroke(cancel = false): void {
  const state = pointerState;
  pointerState = undefined;
  if (!state || state.pan) return;
  if (cancel) {
    project = state.before;
    selection = state.selection;
    renderAll();
    return;
  }
  if (state.changed && selectedTool !== "select") commit(state.before);
  else renderSelection();
}
viewport.addEventListener("pointerdown", (event) => {
  if ((event.target as HTMLElement).closest("button, .zoom-controls")) return;
  if (event.pointerType === "touch") {
    touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (touches.size === 2) {
      finishStroke(true);
      const points = [...touches.values()];
      pinch = {
        distance: Math.hypot(
          points[1].x - points[0].x,
          points[1].y - points[0].y,
        ),
        zoom,
        x: (points[0].x + points[1].x) / 2,
        y: (points[0].y + points[1].y) / 2,
        panX,
        panY,
      };
      viewport.setPointerCapture(event.pointerId);
      return;
    }
  }
  if (pointerState || pinch) return;
  const isPan = selectedTool === "hand" || spaceDown || event.button === 1;
  if (
    !isPan &&
    event.target !== artwork &&
    !(event.target as HTMLElement).closest("#artboard")
  )
    return;
  const [x, y] = position(event);
  if (!isPan && (selectedTool === "eyedropper" || event.altKey)) {
    if (x < 0 || y < 0 || x >= project.width || y >= project.height) return;
    const pixel = artwork.getContext("2d")!.getImageData(x, y, 1, 1).data;
    setColor(hex(pixel), pixel[3]);
    return;
  }
  if (selectedTool === "wand" && !isPan) {
    selection = flood_mask(
      bytes(cel()),
      project.width,
      project.height,
      x,
      y,
      tolerance,
    );
    renderSelection();
    return;
  }
  if (!isPan && selectedTool !== "select" && !editable()) return;
  if (selectedTool === "text" && !isPan) {
    showTextDialog(x, y);
    return;
  }
  stopPlayback();
  viewport.setPointerCapture(event.pointerId);
  event.preventDefault();
  const before = cloneDocument(project);
  const source = cel().slice();
  pointerState = {
    id: event.pointerId,
    startX: x,
    startY: y,
    lastX: x,
    lastY: y,
    before,
    source,
    selection: selection?.slice(),
    raster: new Raster(
      cel(),
      project.width,
      project.height,
      brushOptions(event),
    ),
    changed: false,
    pan: isPan,
    clientX: event.clientX,
    clientY: event.clientY,
    panX,
    panY,
  };
  if (isPan) return;
  if (selectedTool === "fill") {
    pointerState.raster.fill(x, y, tolerance);
    pointerState.changed = true;
    renderCanvas();
    finishStroke();
    return;
  }
  applyShape(pointerState, x, y, event.shiftKey);
});
viewport.addEventListener("pointermove", (event) => {
  if (touches.has(event.pointerId))
    touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (pinch && touches.size >= 2) {
    const points = [...touches.values()];
    fit = false;
    zoom = Math.max(
      0.05,
      Math.min(
        64,
        (pinch.zoom *
          Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y)) /
          Math.max(1, pinch.distance),
      ),
    );
    panX = pinch.panX + (points[0].x + points[1].x) / 2 - pinch.x;
    panY = pinch.panY + (points[0].y + points[1].y) / 2 - pinch.y;
    updateZoom();
    return;
  }
  const [x, y] = position(event);
  const cursor = get("#cursor");
  cursor.hidden =
    x < 0 ||
    y < 0 ||
    x >= project.width ||
    y >= project.height ||
    selectedTool === "hand";
  cursor.style.left = `${x * zoom}px`;
  cursor.style.top = `${y * zoom}px`;
  cursor.style.width = `${zoom}px`;
  cursor.style.height = `${zoom}px`;
  get(".status-left > span:nth-child(2)").textContent = `${x}, ${y}`;
  const state = pointerState;
  if (!state || state.id !== event.pointerId) return;
  if (state.pan) {
    panX = state.panX + event.clientX - state.clientX;
    panY = state.panY + event.clientY - state.clientY;
    fit = false;
    updateZoom();
    return;
  }
  if (event.pointerType === "pen") {
    state.raster.options.opacity =
      Math.max(0.05, event.pressure) *
      Math.max(
        0.01,
        Math.min(
          1,
          Number(get<HTMLInputElement>("#brush-opacity").value) / 100,
        ),
      );
  }
  applyShape(state, x, y, event.shiftKey);
});
function pointerEnd(event: PointerEvent): void {
  touches.delete(event.pointerId);
  if (pinch) {
    if (!touches.size) pinch = undefined;
    return;
  }
  if (pointerState?.id === event.pointerId)
    finishStroke(event.type === "pointercancel");
}
viewport.addEventListener("pointerup", pointerEnd);
viewport.addEventListener("pointercancel", pointerEnd);
viewport.addEventListener("lostpointercapture", (event) => {
  if (pointerState?.id === event.pointerId) finishStroke(true);
});
viewport.addEventListener("pointerleave", () => {
  get("#cursor").hidden = true;
});
viewport.addEventListener("contextmenu", (event) => event.preventDefault());
viewport.addEventListener(
  "wheel",
  (event) => {
    event.preventDefault();
    if (event.shiftKey) {
      fit = false;
      panX -= event.deltaY;
      updateZoom();
    } else zoomBy(event.deltaY < 0 ? 1.15 : 1 / 1.15);
  },
  { passive: false },
);
function openModal(
  title: string,
  body: string,
  submit: string,
  callback: (data: FormData) => void | Promise<void>,
): Promise<boolean> {
  closeMenus();
  setDrawer("");
  if (dialog.open) modalResolve?.(false);
  modalCallback = callback;
  get("#dialog-content").innerHTML =
    `<form id="modal-form"><div class="dialog-heading"><h2>${escapeHtml(title)}</h2><button type="button" class="icon-button" data-action="close-dialog" aria-label="Закрыть">${icon("close")}</button></div>${body}<p id="modal-error" class="form-error" role="alert" hidden></p><div class="dialog-footer"><button type="button" class="secondary" data-action="close-dialog">Отмена</button><button type="submit" class="primary">${submit}</button></div></form>`;
  if (!dialog.open) dialog.showModal();
  return new Promise((resolve) => {
    modalResolve = resolve;
  });
}
function confirmOperation(title: string, text: string): Promise<boolean> {
  return openModal(title, `<p>${escapeHtml(text)}</p>`, "Продолжить", () => {});
}
function numberField(
  label: string,
  name: string,
  value: number,
  minimum: number,
  maximum: number,
): string {
  return `<label class="dialog-field">${label}<input name="${name}" type="number" min="${minimum}" max="${maximum}" value="${value}" required/></label>`;
}
function number(
  data: FormData,
  key: string,
  minimum: number,
  maximum: number,
): number {
  const value = Number(data.get(key));
  if (!Number.isFinite(value) || value < minimum || value > maximum)
    throw new Error(`Значение должно быть от ${minimum} до ${maximum}.`);
  return Math.round(value);
}
function textField(label: string, name: string, value: string): string {
  return `<label class="dialog-field">${label}<input name="${name}" value="${escapeHtml(value)}" maxlength="200" required/></label>`;
}
async function replaceProject(next: PixelDocument): Promise<void> {
  stopPlayback();
  clearTimeout(saveTimer);
  try {
    await writeRecovery(project, "backup");
  } catch {
    toast("Не удалось сохранить резервный черновик.");
  }
  project = next;
  selectedLayer = 0;
  selectedFrame = 0;
  selection = undefined;
  history.clear();
  stamp = undefined;
  dirty = false;
  fit = true;
  panX = 0;
  panY = 0;
  get("#dirty-mark").hidden = true;
  renderAll();
  try {
    await writeRecovery(project);
    get("#autosave-status").innerHTML =
      "Черновик сохранён на устройстве<br/><span>Ctrl S — скачать проект .pixes</span>";
  } catch {
    toast("Автосохранение недоступно. Скачайте .pixes через Ctrl S.");
  }
}
function showNew(): void {
  void openModal(
    "Новый проект",
    `${dirty ? "<p>Текущие изменения ещё не сохранены в файл. Перед созданием нового проекта скачайте .pixes, если он нужен.</p>" : ""}${textField("Название", "name", "Без названия")}<div class="dimension-fields">${numberField("Ширина", "width", 64, 1, 2048)}<span>×</span>${numberField("Высота", "height", 64, 1, 2048)}<span>px</span></div><div class="size-presets">${[16, 32, 64, 128].map((size) => `<button type="button" data-size="${size}">${size} × ${size}</button>`).join("")}</div><label class="dialog-checkbox"><input name="opaque" type="checkbox"/> Заполнить фоновым цветом</label>`,
    "Создать",
    async (data) => {
      const next = createDocument(
        number(data, "width", 1, 2048),
        number(data, "height", 1, 2048),
        String(data.get("name")).trim() || "Без названия",
        project.palette,
      );
      if (data.has("opaque"))
        for (
          let offset = 0;
          offset < next.frames[0].cels[0].length;
          offset += 4
        )
          next.frames[0].cels[0].set(rgba(background), offset);
      await replaceProject(next);
    },
  );
}
function showResize(): void {
  void openModal(
    "Размер холста",
    `<div class="dimension-fields">${numberField("Ширина", "width", project.width, 1, 2048)}<span>×</span>${numberField("Высота", "height", project.height, 1, 2048)}</div><label class="dialog-checkbox"><input type="checkbox" name="scale" checked/> Масштабировать пиксели (ближайший сосед)</label><p>Без масштабирования: размер меняется от левого верхнего угла. Изменение применяется ко всем слоям и кадрам.</p>`,
    "Применить",
    (data) => {
      const width = number(data, "width", 1, 2048);
      const height = number(data, "height", 1, 2048);
      checkBudget(width, height, project.layers.length, project.frames.length);
      edit(() => {
        for (const frame of project.frames)
          frame.cels = frame.cels.map((pixels) => {
            if (data.has("scale"))
              return new Uint8ClampedArray(
                resize_nearest(
                  bytes(pixels),
                  project.width,
                  project.height,
                  width,
                  height,
                ),
              );
            const output = new Uint8ClampedArray(width * height * 4);
            for (let y = 0; y < Math.min(height, project.height); y += 1)
              output.set(
                pixels.subarray(
                  y * project.width * 4,
                  (y * project.width + Math.min(width, project.width)) * 4,
                ),
                y * width * 4,
              );
            return output;
          });
        project.width = width;
        project.height = height;
        selection = undefined;
        fit = true;
        panX = 0;
        panY = 0;
      });
    },
  );
}
function showTextDialog(x: number, y: number): void {
  void openModal(
    "Текст",
    `<label class="dialog-field">Текст<textarea name="text" rows="3" maxlength="1000" required>Текст</textarea></label><div class="dimension-fields">${numberField("Размер, px", "size", 8, 4, 128)}<label class="dialog-field">Шрифт<select name="font"><option value="monospace">Моноширинный</option><option value="sans-serif">Без засечек</option><option value="serif">С засечками</option></select></label></div><p>Текст растрируется на текущем слое без полупрозрачных краёв. После вставки его можно переместить инструментом «Перемещение».</p>`,
    "Вставить",
    (data) => {
      edit(() => {
        const canvas = makeCanvas(project.width, project.height);
        const context = canvas.getContext("2d")!;
        const size = number(data, "size", 4, 128);
        context.fillStyle = foreground;
        context.font = `${size}px ${String(data.get("font"))}`;
        context.textBaseline = "top";
        String(data.get("text"))
          .split("\n")
          .forEach((line, index) =>
            context.fillText(line, x, y + index * (size + 2)),
          );
        const pixels = context.getImageData(
          0,
          0,
          project.width,
          project.height,
        ).data;
        for (let index = 0; index < pixels.length / 4; index += 1)
          if (pixels[index * 4 + 3] >= 100 && (!selection || selection[index]))
            blendPixel(cel(), index, rgba(foreground, colorAlpha));
      }, true);
    },
  );
}
function showBrushSettings(): void {
  void openModal(
    "Параметры инструмента",
    `<label class="dialog-field">Форма кисти<select name="shape"><option value="square" ${!brushRound ? "selected" : ""}>Квадрат</option><option value="round" ${brushRound ? "selected" : ""}>Круг</option></select></label><label class="dialog-checkbox"><input type="checkbox" name="filled" ${filled ? "checked" : ""}/> Заполнять прямоугольники и эллипсы</label><div class="dimension-fields">${numberField("Допуск заливки и палочки", "tolerance", tolerance, 0, 255)}${numberField("Непрозрачность кисти, %", "opacity", Number(get<HTMLInputElement>("#brush-opacity").value), 1, 100)}</div><label class="dialog-field">Симметрия<select name="symmetry">${["Выключена", "По X", "По Y", "По X и Y"].map((name, index) => `<option value="${index}" ${symmetry === index ? "selected" : ""}>${name}</option>`).join("")}</select></label><label class="dialog-checkbox"><input name="wrap" type="checkbox" ${tile ? "checked" : ""}/> Рисование через края и повтор текстуры</label>${stamp ? '<label class="dialog-checkbox"><input type="checkbox" name="reset-stamp"/> Вернуть обычную кисть</label>' : ""}`,
    "Применить",
    (data) => {
      brushRound = data.get("shape") === "round";
      filled = data.has("filled");
      tolerance = number(data, "tolerance", 0, 255);
      symmetry = number(data, "symmetry", 0, 3);
      tile = data.has("wrap");
      get<HTMLInputElement>("#brush-opacity").value = String(
        number(data, "opacity", 1, 100),
      );
      if (data.has("reset-stamp")) stamp = undefined;
      updateToggles();
    },
  );
}
function updateToggles(): void {
  const values: Record<string, boolean> = {
    symmetry: symmetry !== 0,
    tile,
    onion,
  };
  for (const [name, value] of Object.entries(values)) {
    const button = get(`[data-toggle="${name}"]`);
    button.classList.toggle("active", value);
    button.setAttribute("aria-pressed", String(value));
  }
  artboard.classList.toggle("tile-preview", tile);
  if (tile) {
    artboard.style.backgroundImage = `url(${artwork.toDataURL()})`;
    artboard.style.backgroundSize = "100% 100%";
  } else {
    artboard.style.backgroundImage = "";
    artboard.style.backgroundSize = "";
  }
}
function showFrameSettings(): void {
  void openModal(
    "Кадр анимации",
    `${numberField("Длительность, мс", "duration", project.frames[selectedFrame].duration, 10, 60000)}<label class="dialog-checkbox"><input name="all" type="checkbox"/> Применить длительность ко всем кадрам</label>${numberField("Позиция кадра", "position", selectedFrame + 1, 1, project.frames.length)}`,
    "Применить",
    (data) =>
      edit(() => {
        const duration = number(data, "duration", 10, 60000);
        if (data.has("all"))
          project.frames.forEach((frame) => {
            frame.duration = duration;
          });
        else project.frames[selectedFrame].duration = duration;
        const position = number(data, "position", 1, project.frames.length) - 1;
        const frame = project.frames.splice(selectedFrame, 1)[0];
        project.frames.splice(position, 0, frame);
        selectedFrame = position;
      }),
  );
}
function showPalette(): void {
  void openModal(
    "Палитра",
    `<p>До 256 цветов. Импорт JASC PAL, GIMP GPL и списков HEX; экспорт в PAL.</p><div class="dialog-tools"><button type="button" class="secondary" data-action="import-palette">Импорт…</button><button type="button" class="secondary" data-action="export-palette">Скачать PAL</button><button type="button" class="secondary" data-action="extract-palette">Из изображения</button></div><label class="dialog-field">Цвета HEX<textarea name="colors" rows="6" maxlength="4096">${project.palette.join(" ")}</textarea></label><p>Можно вставить список HEX, например #202c30 #47684e #f7f6f2.</p>`,
    "Применить",
    (data) => {
      const palette = parsePalette(String(data.get("colors")));
      edit(() => {
        project.palette = palette;
      });
    },
  );
}
function rgbToHsv(color: number[]): number[] {
  const [r, g, b] = color.map((value) => value / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const difference = max - min;
  let hue = 0;
  if (difference)
    hue =
      max === r
        ? ((g - b) / difference) % 6
        : max === g
          ? (b - r) / difference + 2
          : (r - g) / difference + 4;
  return [
    (hue * 60 + 360) % 360,
    max ? (difference / max) * 100 : 0,
    max * 100,
  ];
}
function hsvToRgb(h: number, s: number, v: number): number[] {
  s /= 100;
  v /= 100;
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  const value =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x];
  return value.map((channel) => Math.round((channel + m) * 255));
}
function showColor(): void {
  const rgb = rgba(foreground);
  const hsv = rgbToHsv(rgb.slice(0, 3));
  void openModal(
    "Основной цвет",
    `<label class="dialog-field">HEX<input name="hex" value="${foreground}" pattern="#[0-9a-fA-F]{6}" required/></label><div class="dimension-fields">${["R", "G", "B"].map((name, index) => numberField(name, name.toLowerCase(), rgb[index], 0, 255)).join("")}</div><div class="dimension-fields">${["H", "S", "V"].map((name, index) => numberField(name, name.toLowerCase(), Math.round(hsv[index]), 0, index === 0 ? 359 : 100)).join("")}</div>${numberField("Альфа, 0–255", "alpha", colorAlpha, 0, 255)}<label class="dialog-checkbox"><input type="checkbox" name="add"/> Добавить в палитру</label>`,
    "Выбрать",
    (data) => {
      setColor(String(data.get("hex")), number(data, "alpha", 0, 255));
      if (data.has("add") && !project.palette.includes(foreground))
        edit(() => {
          if (project.palette.length >= 256)
            throw new Error("В палитре уже 256 цветов.");
          project.palette.push(foreground);
        });
    },
  );
}
function showAdjust(): void {
  if (!editable()) return;
  void openModal(
    "Цветокоррекция слоя",
    `<div class="dimension-fields">${numberField("Тон, °", "hue", 0, -180, 180)}${numberField("Насыщенность, %", "saturation", 0, -100, 100)}</div>${numberField("Яркость, %", "value", 0, -100, 100)}<p>Применяется к активному слою текущего кадра с учётом выделения.</p>`,
    "Применить",
    (data) =>
      edit(() => {
        const h = number(data, "hue", -180, 180);
        const s = number(data, "saturation", -100, 100);
        const v = number(data, "value", -100, 100);
        const pixels = cel();
        for (let index = 0; index < pixels.length / 4; index += 1) {
          if (selection && !selection[index]) continue;
          const offset = index * 4;
          const hsv = rgbToHsv(Array.from(pixels.subarray(offset, offset + 3)));
          pixels.set(
            hsvToRgb(
              (hsv[0] + h + 360) % 360,
              Math.max(0, Math.min(100, hsv[1] + s)),
              Math.max(0, Math.min(100, hsv[2] + v)),
            ),
            offset,
          );
        }
      }, true),
  );
}
function showExport(): void {
  stopPlayback();
  void openModal(
    "Экспорт",
    `<label class="dialog-field">Формат<select name="format" id="export-format"><option value="png">PNG · текущий кадр</option><option value="gif">GIF · анимация</option><option value="sheet">PNG + JSON · спрайт-лист</option><option value="jpeg">JPEG · текущий кадр</option><option value="webp">WebP · текущий кадр</option></select></label><div class="dimension-fields">${numberField("Масштаб ×", "scale", 1, 1, 16)}${numberField("Столбцов в спрайт-листе", "columns", Math.min(8, project.frames.length), 1, 512)}</div><p>GIF: 256 цветов и однобитная прозрачность. PNG сохраняет полупрозрачность. Спрайт-лист скачивается вместе с JSON длительностей.</p><p id="export-progress" role="status"></p>`,
    "Скачать",
    async (data) => {
      exportController = new AbortController();
      const controller = exportController;
      busy = true;
      try {
        const scale = number(data, "scale", 1, 16);
        const format = String(data.get("format"));
        if (format === "gif")
          await exportGif(project, scale, controller.signal, (progress) => {
            get("#export-progress").textContent =
              `Кодирование GIF: ${progress}%`;
          });
        else
          await exportImage(
            project,
            selectedFrame,
            scale,
            format,
            number(data, "columns", 1, 512),
          );
        toast("Файл передан браузеру для скачивания.");
      } finally {
        busy = false;
        exportController = undefined;
      }
    },
  );
}
async function chooseFile(accept: string): Promise<File | undefined> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.addEventListener(
      "change",
      () => {
        resolve(input.files?.[0]);
        input.remove();
      },
      { once: true },
    );
    input.addEventListener(
      "cancel",
      () => {
        resolve(undefined);
        input.remove();
      },
      { once: true },
    );
    input.hidden = true;
    document.body.append(input);
    input.click();
  });
}
async function loadFile(file: File): Promise<void> {
  if (busy) return;
  stopPlayback();
  busy = true;
  let next: PixelDocument;
  try {
    next = await importFile(file);
  } finally {
    busy = false;
  }
  if (
    dirty &&
    !(await confirmOperation(
      "Открыть другой проект?",
      "В текущем проекте есть изменения. Сохраните .pixes перед заменой, если они нужны. Предыдущий черновик останется в резервной копии на устройстве.",
    ))
  )
    return;
  await replaceProject(next);
  toast(`Открыт проект «${next.name}».`);
}
function copySelection(): void {
  const width = project.width;
  const height = project.height;
  let left = width;
  let right = -1;
  let top = height;
  let bottom = -1;
  for (let index = 0; index < width * height; index += 1)
    if (!selection || selection[index]) {
      const x = index % width;
      const y = Math.floor(index / width);
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  if (right < left) throw new Error("Выделение пустое.");
  const pixels = new Uint8ClampedArray(
    (right - left + 1) * (bottom - top + 1) * 4,
  );
  for (let y = top; y <= bottom; y += 1)
    for (let x = left; x <= right; x += 1)
      if (!selection || selection[y * width + x])
        pixels.set(
          cel().subarray((y * width + x) * 4, (y * width + x + 1) * 4),
          ((y - top) * (right - left + 1) + x - left) * 4,
        );
  clipboard = { width: right - left + 1, height: bottom - top + 1, pixels };
  toast("Скопировано во внутренний буфер редактора.");
}
function pasteSelection(): void {
  if (!clipboard) {
    toast(
      "Буфер редактора пуст. Скопируйте выделение или вставьте изображение из системного буфера через Ctrl V.",
    );
    return;
  }
  edit(() => {
    selection = new Uint8Array(project.width * project.height);
    for (let y = 0; y < Math.min(project.height, clipboard!.height); y += 1)
      for (let x = 0; x < Math.min(project.width, clipboard!.width); x += 1) {
        const index = y * project.width + x;
        blendPixel(
          cel(),
          index,
          Array.from(
            clipboard!.pixels.subarray(
              (y * clipboard!.width + x) * 4,
              (y * clipboard!.width + x + 1) * 4,
            ),
          ),
        );
        selection[index] = 1;
      }
    chooseTool("move");
  }, true);
}
function clearPixels(): void {
  edit(() => {
    const pixels = cel();
    for (let index = 0; index < pixels.length / 4; index += 1)
      if (!selection || selection[index])
        pixels.fill(0, index * 4, index * 4 + 4);
  }, true);
}
function transformLayer(mode: number): void {
  if (mode === 2) {
    edit(() => {
      for (const frame of project.frames)
        frame.cels = frame.cels.map(
          (pixels) =>
            new Uint8ClampedArray(
              transform(bytes(pixels), project.width, project.height, 2),
            ),
        );
      [project.width, project.height] = [project.height, project.width];
      selection = undefined;
      fit = true;
    });
  } else
    edit(() => {
      project.frames[selectedFrame].cels[selectedLayer] = new Uint8ClampedArray(
        transform(bytes(cel()), project.width, project.height, mode),
      );
      selection = undefined;
    }, true);
}
function showBrushLibrary(): void {
  void openModal(
    "Библиотека кистей",
    '<p>До 16 своих кистей на этом устройстве. Создать кисть: выделите область до 64 × 64 px и выберите «Правка → Кисть из выделения».</p><div class="brush-library">' +
      brushLibrary
        .map(
          (brush, index) =>
            `<button type="button" class="brush-preset" data-brush="${index}"><canvas data-brush-preview="${index}"></canvas><span>${escapeHtml(brush.name)}</span></button>`,
        )
        .join("") +
      '</div><label class="dialog-checkbox"><input type="checkbox" name="reset"/> Обычная кисть</label>',
    "Применить",
    (data) => {
      if (data.has("reset")) stamp = undefined;
    },
  );
  document
    .querySelectorAll<HTMLCanvasElement>("[data-brush-preview]")
    .forEach((canvas) => {
      const brush = brushLibrary[Number(canvas.dataset.brushPreview)];
      paintPixels(canvas, brush.pixels, brush.width, brush.height);
    });
}
function showGridSettings(): void {
  void openModal(
    "Параметры сетки",
    `<div class="dimension-fields">${numberField("Шаг X, px", "x", gridWidth, 1, 256)}${numberField("Шаг Y, px", "y", gridHeight, 1, 256)}</div><label class="dialog-field">Цвет<input name="color" type="color" value="${gridColor}"/></label>${numberField("Непрозрачность, %", "opacity", gridOpacity, 1, 100)}<label class="dialog-checkbox"><input name="visible" type="checkbox" ${!get("#pixel-grid").hidden ? "checked" : ""}/> Показывать сетку</label>`,
    "Применить",
    (data) => {
      gridWidth = number(data, "x", 1, 256);
      gridHeight = number(data, "y", 1, 256);
      gridColor = String(data.get("color"));
      gridOpacity = number(data, "opacity", 1, 100);
      get("#pixel-grid").hidden = !data.has("visible");
      get("#grid-toggle").classList.toggle("active", data.has("visible"));
      get("#grid-toggle").setAttribute(
        "aria-pressed",
        String(data.has("visible")),
      );
      updateZoom();
    },
  );
}
function showToolbar(): void {
  void openModal(
    "Панель инструментов",
    '<p>Выберите инструменты на панели. Остальные останутся доступны горячими клавишами. Настройка сохраняется на устройстве.</p><div class="toolbar-choices">' +
      tools
        .map(
          ([name, label]) =>
            `<label class="dialog-checkbox"><input name="tool" value="${name}" type="checkbox" ${!get(`[data-tool="${name}"]`).hidden ? "checked" : ""}/>${icon(name)}${label}</label>`,
        )
        .join("") +
      "</div>",
    "Применить",
    (data) => {
      const visible = data.getAll("tool").map(String);
      if (!visible.length) throw new Error("Оставьте хотя бы один инструмент.");
      document
        .querySelectorAll<HTMLElement>("[data-tool]")
        .forEach((button) => {
          button.hidden = !visible.includes(button.dataset.tool!);
        });
      try {
        localStorage.setItem("pixes-toolbar", JSON.stringify(visible));
      } catch {
        /* Session setting still works. */
      }
    },
  );
}
const actions: Record<string, () => void | Promise<void>> = {
  new: showNew,
  open: async () => {
    const file = await chooseFile(
      ".pixes,.png,.jpg,.jpeg,.webp,.gif,.ase,.aseprite",
    );
    if (file) await loadFile(file);
  },
  save: () => {
    saveProject(project);
    dirty = false;
    get("#dirty-mark").hidden = true;
    updateLabels();
    toast("Проект .pixes передан для скачивания.");
  },
  export: showExport,
  undo: () => {
    stopPlayback();
    const restored = history.undo(project);
    if (restored) {
      project = restored;
      selection = undefined;
      markChanged();
      renderAll();
    }
  },
  redo: () => {
    stopPlayback();
    const restored = history.redo(project);
    if (restored) {
      project = restored;
      selection = undefined;
      markChanged();
      renderAll();
    }
  },
  theme: () => {
    const dark = document.documentElement.dataset.theme !== "dark";
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    get("#theme-toggle").innerHTML = icon(dark ? "sun" : "moon");
    try {
      localStorage.setItem("mogdoppixes-theme", dark ? "dark" : "light");
    } catch {
      /* Theme remains usable without persistent storage. */
    }
  },
  grid: () => {
    const grid = get("#pixel-grid");
    grid.hidden = !grid.hidden;
    get("#grid-toggle").classList.toggle("active", !grid.hidden);
    get("#grid-toggle").setAttribute("aria-pressed", String(!grid.hidden));
  },
  fit: () => {
    fit = true;
    panX = 0;
    panY = 0;
    updateZoom();
  },
  "zoom-in": () => zoomBy(1.25),
  "zoom-out": () => zoomBy(0.8),
  "close-drawer": () => setDrawer(""),
  "close-dialog": () => {
    exportController?.abort();
    dialog.close("cancel");
  },
  play: startPlayback,
  "first-frame": () => {
    stopPlayback();
    chooseFrame(0);
  },
  "last-frame": () => {
    stopPlayback();
    chooseFrame(project.frames.length - 1);
  },
  "add-frame": () =>
    edit(() => {
      addFrame(project, selectedFrame, false);
      selectedFrame += 1;
    }),
  "duplicate-frame": () =>
    edit(() => {
      addFrame(project, selectedFrame, true);
      selectedFrame += 1;
    }),
  "delete-frame": async () => {
    if (project.frames.length === 1) {
      toast("В проекте должен остаться хотя бы один кадр.");
      return;
    }
    if (
      await confirmOperation(
        "Удалить кадр?",
        `Кадр ${selectedFrame + 1} будет удалён. Действие можно отменить.`,
      )
    )
      edit(() => {
        project.frames.splice(selectedFrame, 1);
      });
  },
  "frame-settings": showFrameSettings,
  "add-layer": () => edit(() => addLayer(project, selectedLayer)),
  "duplicate-layer": () => edit(() => addLayer(project, selectedLayer, true)),
  "delete-layer": async () => {
    if (project.layers.length === 1) {
      toast("В проекте должен остаться хотя бы один слой.");
      return;
    }
    if (project.layers[selectedLayer].locked) {
      toast("Сначала разблокируйте слой.");
      return;
    }
    if (
      await confirmOperation(
        "Удалить слой?",
        `Слой «${project.layers[selectedLayer].name}» будет удалён во всех кадрах. Действие можно отменить.`,
      )
    )
      edit(() => deleteLayer(project, selectedLayer));
  },
  "layer-up": () => {
    if (selectedLayer > 0)
      edit(() => {
        moveLayer(project, selectedLayer, selectedLayer - 1);
        selectedLayer -= 1;
      });
  },
  "layer-down": () => {
    if (selectedLayer + 1 < project.layers.length)
      edit(() => {
        moveLayer(project, selectedLayer, selectedLayer + 1);
        selectedLayer += 1;
      });
  },
  "layer-rename": () => {
    const layer = project.layers[selectedLayer];
    void openModal(
      "Имя слоя",
      textField("Название", "name", layer.name),
      "Переименовать",
      (data) =>
        edit(() => {
          layer.name = String(data.get("name")).trim() || "Слой";
        }),
    );
  },
  rename: () => {
    void openModal(
      "Имя проекта",
      textField("Название", "name", project.name),
      "Переименовать",
      (data) =>
        edit(() => {
          project.name = String(data.get("name")).trim() || "Без названия";
        }),
    );
  },
  copy: copySelection,
  cut: () => {
    if (!editable()) return;
    copySelection();
    clearPixels();
  },
  paste: pasteSelection,
  clear: clearPixels,
  "select-all": () => {
    selection = new Uint8Array(project.width * project.height).fill(1);
    renderSelection();
  },
  deselect: () => {
    selection = undefined;
    renderSelection();
  },
  "brush-library": showBrushLibrary,
  "grid-settings": showGridSettings,
  toolbar: showToolbar,
  resize: showResize,
  rotate: () => transformLayer(2),
  "flip-x": () => transformLayer(0),
  "flip-y": () => transformLayer(1),
  swap: () => {
    const previous = foreground;
    setColor(background);
    background = previous;
    get(".back-color").style.background = background;
  },
  "brush-settings": showBrushSettings,
  palette: showPalette,
  "add-color": showColor,
  "import-palette": async () => {
    const file = await chooseFile(".pal,.gpl,.txt,.hex");
    if (!file) return;
    if (file.size > 65536) throw new Error("Палитра больше 64 КиБ.");
    const palette = parsePalette(await file.text());
    get<HTMLTextAreaElement>('[name="colors"]').value = palette.join(" ");
  },
  "export-palette": () => exportPalette(project),
  "extract-palette": () => {
    get<HTMLTextAreaElement>('[name="colors"]').value = extractPalette(
      artwork
        .getContext("2d")!
        .getImageData(0, 0, project.width, project.height).data,
    ).join(" ");
  },
  "apply-palette": () =>
    edit(() => {
      const palette = Uint8Array.from(
        project.palette.flatMap((color) => rgba(color).slice(0, 3)),
      );
      if (!palette.length) throw new Error("Добавьте цвета в палитру.");
      const mapped = apply_palette(bytes(cel()), palette);
      for (let index = 0; index < project.width * project.height; index += 1)
        if (!selection || selection[index])
          cel().set(mapped.subarray(index * 4, index * 4 + 4), index * 4);
    }, true),
  "make-brush": () => {
    copySelection();
    if (!clipboard) return;
    if (clipboard.width > 64 || clipboard.height > 64)
      throw new Error("Выделите кисть не больше 64 × 64 px.");
    stamp = { ...clipboard, pixels: clipboard.pixels.slice() };
    brushLibrary.unshift({
      ...stamp,
      name: `Кисть ${brushLibrary.length + 1}`,
    });
    brushLibrary = brushLibrary.slice(0, 16);
    try {
      localStorage.setItem(
        "pixes-brushes",
        JSON.stringify(
          brushLibrary.map((brush) => ({
            ...brush,
            pixels: encodeBytes(brush.pixels),
          })),
        ),
      );
    } catch {
      toast(
        "Кисть работает, но не удалось сохранить библиотеку на устройстве.",
      );
    }
    chooseTool("pencil");
    toast(
      "Кисть сохранена в библиотеке. Вернуть обычную можно в параметрах инструмента.",
    );
  },
  adjust: showAdjust,
  background: () => {
    void openModal(
      "Фон просмотра",
      '<label class="dialog-field">Цвет<input name="color" type="color" value="#e8e9e2"/></label><p>Меняет фон рабочей области, не пиксели документа.</p>',
      "Применить",
      (data) => {
        viewport.style.background = String(data.get("color"));
      },
    );
  },
  reference: async () => {
    const file = await chooseFile("image/*");
    if (!file) return;
    if (file.size > 16 * 1024 * 1024)
      throw new Error("Референс больше 16 МиБ.");
    if (referenceUrl) URL.revokeObjectURL(referenceUrl);
    referenceUrl = URL.createObjectURL(file);
    get<HTMLImageElement>("#reference-image").src = referenceUrl;
    get("#reference-image").hidden = false;
  },
  "hide-reference": () => {
    get("#reference-image").hidden = true;
    if (referenceUrl) URL.revokeObjectURL(referenceUrl);
    referenceUrl = undefined;
  },
  precise: () => {
    precise = !precise;
    toast(
      precise
        ? "Точный курсор: на 48 px выше пальца. Два пальца — сдвиг и масштаб."
        : "Курсор под пальцем.",
    );
  },
  recovery: async () => {
    const backup = await readRecovery("backup");
    if (!backup) throw new Error("Резервного черновика пока нет.");
    const validated = parseDocument(serializeDocument(backup));
    if (
      await confirmOperation(
        "Открыть резервный черновик?",
        `Будет открыт проект «${validated.name}». Текущий черновик станет резервным.`,
      )
    )
      await replaceProject(validated);
  },
  sample: async () => {
    if (
      !dirty ||
      (await confirmOperation(
        "Открыть пример?",
        "Текущий проект будет заменён примером. При необходимости сначала сохраните .pixes.",
      ))
    )
      await replaceProject(sampleDocument());
  },
  help: () => {
    void openModal(
      "MogDopPixes 0.1.0",
      `<p>Пиксельный редактор со слоями и покадровой анимацией. Проекты обрабатываются на этом устройстве. Для переноса скачайте .pixes через меню «Файл».</p><div class="shortcut-list"><span>Инструменты</span><kbd>B E G I L U O M W D T V H</kbd><span>Отмена / повтор</span><kbd>Ctrl Z / Ctrl Shift Z</kbd><span>Сохранить / экспорт</span><kbd>Ctrl S / Ctrl E</kbd><span>Копировать / вставить</span><kbd>Ctrl C / Ctrl V</kbd><span>Пипетка временно</span><kbd>Alt + клик</kbd><span>Линия с ограничением</span><kbd>Shift + протянуть</kbd><span>Воспроизведение / рука</span><kbd>Пробел / удерживать пробел</kbd><span>Масштаб / вписать</span><kbd>Колесо / F</kbd><span>На телефоне</span><kbd>Два пальца: масштаб и сдвиг</kbd></div><p>PNG/JPEG/WebP/GIF и RGBA Aseprite импортируются через «Открыть». .pixes сохраняет все слои и кадры. GIF имеет ограничения прозрачности; экспорт PNG сохраняет альфа-канал.</p><div class="dialog-tools"><button type="button" class="secondary" data-action="recovery">Резервный черновик</button><button type="button" class="secondary" data-action="sample">Открыть пример</button></div><p><a href="https://github.com/Glob876/MogDopPixes" target="_blank" rel="noreferrer">Исходный код · GPL-3.0</a></p>`,
      "Закрыть",
      () => {},
    );
  },
};
async function runAction(action: string): Promise<void> {
  if (busy && !["close-dialog", "close-drawer"].includes(action)) return;
  try {
    await actions[action]?.();
  } catch (error) {
    if (!(error instanceof DOMException && error.name === "AbortError"))
      failure(error);
  }
}
document.addEventListener("click", (event) => {
  const target = (event.target as HTMLElement).closest<HTMLElement>(
    "button, #drawer-backdrop",
  );
  if (!target) {
    if (!(event.target as HTMLElement).closest(".menu-popover")) closeMenus();
    return;
  }
  if (target.dataset.menu) {
    const menu = get(`#menu-${target.dataset.menu}`);
    const open = menu.hidden;
    closeMenus();
    menu.hidden = !open;
    target.setAttribute("aria-expanded", String(open));
    return;
  }
  closeMenus();
  if (target.dataset.action) void runAction(target.dataset.action);
  if (target.dataset.brush !== undefined) {
    stamp = brushLibrary[Number(target.dataset.brush)];
    chooseTool("pencil");
    dialog.close("done");
  }
  if (target.dataset.tool) chooseTool(target.dataset.tool);
  if (target.dataset.color) setColor(target.dataset.color);
  if (target.dataset.drawer)
    setDrawer(drawer === target.dataset.drawer ? "" : target.dataset.drawer);
  if (target.id === "drawer-backdrop") setDrawer("");
  if (target.dataset.toggle === "symmetry") {
    symmetry = (symmetry + 1) % 4;
    toast(
      [
        "Симметрия выключена",
        "Симметрия по X",
        "Симметрия по Y",
        "Симметрия по X и Y",
      ][symmetry],
    );
    updateToggles();
  }
  if (target.dataset.toggle === "tile") {
    tile = !tile;
    updateToggles();
    toast(
      tile
        ? "Повтор текстуры включён. Рисование переходит через края."
        : "Повтор текстуры выключен.",
    );
  }
  if (target.dataset.toggle === "onion") {
    onion = !onion;
    updateToggles();
    renderCanvas();
  }
  if (target.dataset.selectLayer !== undefined) {
    selectedLayer = Number(target.dataset.selectLayer);
    renderLayers();
  }
  if (target.dataset.visibility !== undefined)
    edit(() => {
      const layer = project.layers[Number(target.dataset.visibility)];
      layer.visible = !layer.visible;
    });
  if (target.dataset.lock !== undefined)
    edit(() => {
      const layer = project.layers[Number(target.dataset.lock)];
      layer.locked = !layer.locked;
    });
  if (target.dataset.frame !== undefined) {
    stopPlayback();
    chooseFrame(Number(target.dataset.frame));
  }
  if (target.dataset.size) {
    dialog
      .querySelectorAll<HTMLInputElement>('[name="width"], [name="height"]')
      .forEach((input) => {
        input.value = target.dataset.size!;
      });
    dialog
      .querySelectorAll("[data-size]")
      .forEach((element) =>
        element.classList.toggle("active", element === target),
      );
  }
});
document.addEventListener("dblclick", (event) => {
  const layer = (event.target as HTMLElement).closest<HTMLElement>(
    "[data-select-layer]",
  );
  if (layer) {
    selectedLayer = Number(layer.dataset.selectLayer);
    void runAction("layer-rename");
  }
  if ((event.target as HTMLElement).closest("[data-frame]"))
    showFrameSettings();
});
get("#foreground").addEventListener("input", (event) =>
  setColor((event.target as HTMLInputElement).value),
);
get("#color-preview").addEventListener("click", (event) => {
  event.preventDefault();
  showColor();
});
get("#fps").addEventListener("change", () => {
  const fps = Math.max(
    1,
    Math.min(100, Number(get<HTMLInputElement>("#fps").value) || 10),
  );
  edit(() =>
    project.frames.forEach((frame) => {
      frame.duration = Math.max(10, Math.round(1000 / fps));
    }),
  );
});
get("#blend-mode").addEventListener("change", () => {
  const value = get<HTMLSelectElement>("#blend-mode").value as BlendMode;
  edit(() => {
    project.layers[selectedLayer].blend = value;
  }, true);
});
get("#layer-opacity").addEventListener("change", () => {
  const value = Math.max(
    0,
    Math.min(100, Number(get<HTMLInputElement>("#layer-opacity").value) || 0),
  );
  edit(() => {
    project.layers[selectedLayer].opacity = value / 100;
  }, true);
});
dialog.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.target as HTMLFormElement;
  const submit = form.querySelector<HTMLButtonElement>('[type="submit"]')!;
  if (submit.disabled) return;
  submit.disabled = true;
  try {
    await modalCallback?.(new FormData(form));
    if (dialog.open) dialog.close("done");
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return;
    const message = get("#modal-error");
    if (message) {
      message.textContent =
        error instanceof Error
          ? error.message
          : "Не удалось выполнить действие.";
      message.hidden = false;
    }
  } finally {
    submit.disabled = false;
  }
});
dialog.addEventListener("close", () => {
  exportController?.abort();
  modalResolve?.(dialog.returnValue === "done");
  modalResolve = undefined;
  modalCallback = undefined;
});
dialog.addEventListener("cancel", () => exportController?.abort());
dialog.addEventListener("click", (event) => {
  if (event.target === dialog) {
    exportController?.abort();
    dialog.close("cancel");
  }
});
dialog.addEventListener("input", (event) => {
  const input = event.target as HTMLInputElement;
  if (!dialog.querySelector('[name="hex"]')) return;
  const form = dialog.querySelector("form")!;
  function updateRGB(color: number[]) {
    ["r", "g", "b"].forEach((key, index) => {
      (form.elements.namedItem(key) as HTMLInputElement).value = String(
        color[index],
      );
    });
    (form.elements.namedItem("hex") as HTMLInputElement).value = hex(color);
  }
  function updateHSV(color: number[]) {
    rgbToHsv(color).forEach((value, index) => {
      (
        form.elements.namedItem(["h", "s", "v"][index]) as HTMLInputElement
      ).value = String(Math.round(value));
    });
  }
  if (input.name === "hex" && /^#[0-9a-f]{6}$/i.test(input.value)) {
    const color = rgba(input.value).slice(0, 3);
    updateRGB(color);
    updateHSV(color);
  }
  if (["r", "g", "b"].includes(input.name)) {
    const color = ["r", "g", "b"].map((key) =>
      Math.max(
        0,
        Math.min(
          255,
          Number((form.elements.namedItem(key) as HTMLInputElement).value) || 0,
        ),
      ),
    );
    updateRGB(color);
    updateHSV(color);
  }
  if (["h", "s", "v"].includes(input.name)) {
    const values = ["h", "s", "v"].map(
      (key) =>
        Number((form.elements.namedItem(key) as HTMLInputElement).value) || 0,
    );
    updateRGB(hsvToRgb(values[0], values[1], values[2]));
  }
});
let spaceStarted = 0;
document.addEventListener("keydown", (event) => {
  const target = event.target as HTMLElement;
  if (event.key === "Escape") {
    closeMenus();
    setDrawer("");
    if (pointerState) finishStroke(true);
    else {
      selection = undefined;
      renderSelection();
    }
    return;
  }
  if (target.matches("input, textarea, select") || dialog.open) return;
  if (event.code === "Space" && !target.closest("button")) {
    event.preventDefault();
    if (!spaceDown) {
      spaceDown = true;
      spaceStarted = performance.now();
    }
    return;
  }
  const control = event.ctrlKey || event.metaKey;
  if (control) {
    const actionsByCode: Record<string, string> = {
      KeyN: "new",
      KeyO: "open",
      KeyS: "save",
      KeyE: "export",
      KeyZ: event.shiftKey ? "redo" : "undo",
      KeyY: "redo",
      KeyC: "copy",
      KeyX: "cut",
      KeyA: "select-all",
      Quote: "grid",
    };
    const action = actionsByCode[event.code];
    if (action) {
      event.preventDefault();
      void runAction(action);
    }
    return;
  }
  if (event.key === "Delete" || event.key === "Backspace") {
    event.preventDefault();
    clearPixels();
    return;
  }
  if (event.code === "KeyF") {
    void runAction("fit");
    return;
  }
  if (event.code === "BracketLeft" || event.code === "BracketRight") {
    const input = get<HTMLInputElement>("#brush-size");
    input.value = String(
      Math.max(
        1,
        Math.min(
          64,
          Number(input.value) + (event.code === "BracketRight" ? 1 : -1),
        ),
      ),
    );
    return;
  }
  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    event.preventDefault();
    stopPlayback();
    chooseFrame(
      (selectedFrame +
        (event.key === "ArrowRight" ? 1 : project.frames.length - 1)) %
        project.frames.length,
    );
    return;
  }
  const tool = tools.find((item) => item[2] && `Key${item[2]}` === event.code);
  if (tool) chooseTool(tool[0]);
});
document.addEventListener("keyup", (event) => {
  if (event.code === "Space") {
    const usedToPan = pointerState?.pan;
    if (
      spaceDown &&
      performance.now() - spaceStarted < 250 &&
      !usedToPan &&
      !dialog.open &&
      !(event.target as HTMLElement).matches("input, textarea, select, button")
    )
      startPlayback();
    spaceDown = false;
  }
});
window.addEventListener("blur", () => {
  spaceDown = false;
  touches.clear();
  pinch = undefined;
  finishStroke(true);
});
window.addEventListener("beforeunload", (event) => {
  if (dirty) {
    event.preventDefault();
    event.returnValue = "";
  }
});
window.addEventListener("pagehide", () => {
  stopPlayback();
  clearTimeout(saveTimer);
  void writeRecovery(project);
});
document.addEventListener("paste", async (event) => {
  if ((event.target as HTMLElement).matches("input, textarea") || dialog.open)
    return;
  const file = [...(event.clipboardData?.files || [])].find((item) =>
    item.type.startsWith("image/"),
  );
  event.preventDefault();
  if (file) {
    try {
      const imported = await importFile(file);
      const pixels = composite(imported, 0)
        .getContext("2d")!
        .getImageData(0, 0, imported.width, imported.height).data;
      clipboard = { width: imported.width, height: imported.height, pixels };
      pasteSelection();
    } catch (error) {
      failure(error);
    }
  } else pasteSelection();
});
document.addEventListener("dragover", (event) => event.preventDefault());
document.addEventListener("drop", (event) => {
  event.preventDefault();
  const file = event.dataTransfer?.files[0];
  if (file && !dialog.open) void loadFile(file).catch(failure);
});
new ResizeObserver(updateZoom).observe(viewport);
matchMedia("(max-width: 760px), (max-aspect-ratio: 4/5)").addEventListener(
  "change",
  () => setDrawer(""),
);
try {
  const theme = localStorage.getItem("mogdoppixes-theme");
  const dark = theme
    ? theme === "dark"
    : matchMedia("(prefers-color-scheme: dark)").matches;
  if (dark) void actions.theme();
} catch {
  /* Default light theme if storage is unavailable. */
}
get("#menu-file").insertAdjacentHTML(
  "beforeend",
  '<div class="menu-divider"></div><button data-action="recovery">Резервный черновик…</button><button data-action="sample">Открыть пример</button>',
);
get("#layers-panel .panel-actions").insertAdjacentHTML(
  "afterbegin",
  `<button class="icon-button" data-action="layer-rename" title="Переименовать слой" aria-label="Переименовать слой">${icon("settings")}</button>`,
);
get("#menu-view").insertAdjacentHTML(
  "beforeend",
  '<button data-action="grid-settings">Параметры сетки…</button><button data-action="toolbar">Панель инструментов…</button>',
);
get("#menu-edit").insertAdjacentHTML(
  "beforeend",
  '<button data-action="brush-library">Библиотека кистей…</button>',
);
try {
  const visible = JSON.parse(localStorage.getItem("pixes-toolbar") || "null");
  if (Array.isArray(visible) && visible.length)
    document.querySelectorAll<HTMLElement>("[data-tool]").forEach((button) => {
      button.hidden = !visible.includes(button.dataset.tool!);
    });
} catch {}
get("#fps").setAttribute("max", "100");
get("#fps").setAttribute("step", "0.1");
get("#artwork").setAttribute("tabindex", "0");
renderAll();
busy = true;
void (async () => {
  try {
    const recovery = await readRecovery();
    if (recovery) {
      project = parseDocument(serializeDocument(recovery));
      renderAll();
      toast("Восстановлен черновик с этого устройства.");
      get("#autosave-status").innerHTML =
        "Черновик восстановлен<br/><span>Ctrl S — скачать проект .pixes</span>";
    }
  } catch {
    get("#autosave-status").innerHTML =
      "Автосохранение недоступно<br/><span>Скачивайте .pixes через Ctrl S</span>";
  } finally {
    busy = false;
    get("#app").dataset.ready = "true";
  }
})();
