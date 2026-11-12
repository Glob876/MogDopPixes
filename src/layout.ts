import { icon } from "./icons";
import { colors } from "./art";
export const tools = [
  ["pencil", "Карандаш", "B"],
  ["eraser", "Ластик", "E"],
  ["fill", "Заливка", "G"],
  ["eyedropper", "Пипетка", "I"],
  ["line", "Линия", "L"],
  ["square", "Прямоугольник", "U"],
  ["circle", "Эллипс", "O"],
  ["gradient", "Градиент", ""],
  ["select", "Выделение", "M"],
  ["wand", "Волшебная палочка", "W"],
  ["dither", "Дизеринг", "D"],
  ["text", "Текст", "T"],
  ["move", "Перемещение", "V"],
  ["hand", "Рука", "H"],
];
const selectedColor = colors[2];
function button(name: string, label: string, extra = "") {
  return `<button class="icon-button" title="${label}" aria-label="${label}" ${extra}>${icon(name)}</button>`;
}
export function mountLayout() {
  document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
  <header class="app-header">
    <a class="brand" href="./" aria-label="MogDopPixes"> <img src="./icon.svg" alt="" width="26" height="26"/><span>MogDop<span class="brand-accent">Pixes</span></span></a>
    <span class="prototype-badge">0.1.0</span>
    <div class="header-spacer"></div>
    <span class="local-note">${icon("image")} Локальная обработка файлов</span>
    ${button("help", "Справка и горячие клавиши", 'data-action="help"')}
    ${button("moon", "Переключить тему", 'id="theme-toggle" data-action="theme"')}
  </header>
  <div class="menu-bar">
    <div class="menus">
      <div class="menu-wrap"><button class="menu-button" data-menu="file" aria-expanded="false">Файл</button>
        <div class="menu-popover" id="menu-file" hidden>
          <button data-action="new">Новый проект… <kbd>Ctrl N</kbd></button>
          <button data-action="open">Открыть… <kbd>Ctrl O</kbd></button>
          <div class="menu-divider"></div>
          <button data-action="save">Сохранить <kbd>Ctrl S</kbd></button>
          <button data-action="export">Экспорт… <kbd>Ctrl E</kbd></button>
        </div>
      </div>
      <div class="menu-wrap"><button class="menu-button" data-menu="edit" aria-expanded="false">Правка</button>
        <div class="menu-popover" id="menu-edit" hidden>
          <button data-action="undo">Отменить <kbd>Ctrl Z</kbd></button>
          <button data-action="redo">Повторить <kbd>Ctrl Shift Z</kbd></button>
          <div class="menu-divider"></div>
          <button data-action="copy">Копировать <kbd>Ctrl C</kbd></button>
          <button data-action="paste">Вставить <kbd>Ctrl V</kbd></button><button data-action="cut">Вырезать <kbd>Ctrl X</kbd></button><button data-action="select-all">Выделить всё <kbd>Ctrl A</kbd></button><button data-action="deselect">Снять выделение <kbd>Esc</kbd></button><button data-action="clear">Очистить <kbd>Del</kbd></button><div class="menu-divider"></div><button data-action="adjust">Цветокоррекция…</button><button data-action="apply-palette">Применить палитру к слою</button><button data-action="make-brush">Кисть из выделения</button>
        </div>
      </div>
      <div class="menu-wrap"><button class="menu-button" data-menu="canvas" aria-expanded="false">Холст</button>
        <div class="menu-popover" id="menu-canvas" hidden>
          <button data-action="resize">Размер холста…</button>
          <button data-action="rotate">Повернуть на 90°</button>
          <button data-action="flip-x">Отразить по горизонтали</button><button data-action="flip-y">Отразить по вертикали</button><button data-action="background">Цвет фона просмотра…</button>
        </div>
      </div>
      <div class="menu-wrap"><button class="menu-button" data-menu="view" aria-expanded="false">Вид</button>
        <div class="menu-popover" id="menu-view" hidden>
          <button data-action="grid">Пиксельная сетка <kbd>Ctrl '</kbd></button>
          <button data-action="fit">Вписать холст <kbd>F</kbd></button>
          <button data-action="theme">Сменить тему</button><button data-action="reference">Открыть референс…</button><button data-action="hide-reference">Убрать референс</button><button data-action="precise">Точный курсор на телефоне</button>
        </div>
      </div>
    </div>
    <div class="quick-actions">
      ${button("undo", "Отменить · Ctrl Z", 'data-action="undo"')}
      ${button("redo", "Повторить · Ctrl Shift Z", 'data-action="redo"')}
      <span class="separator"></span>
      <button class="save-button" data-action="save">${icon("save")}<span>Сохранить</span></button>
      <button class="export-button" data-action="export">${icon("export")}<span>Экспорт</span></button>
    </div>
  </div>
  <div class="document-bar">
    <div class="document-tab">${icon("image")}<button class="document-title" data-action="rename" title="Переименовать проект">Лесной домик</button><span class="file-extension">.pixes</span><span class="demo-label" id="dirty-mark" hidden>изменён</span></div>
    <span class="document-size">64 × 64 px</span>
    <button class="new-document icon-button" data-action="new" aria-label="Новый проект" title="Новый проект">${icon("plus")}</button>
  </div>
  <main class="editor">
    <aside class="tool-rail" aria-label="Инструменты">
      <div class="rail-label">ИНСТРУМЕНТЫ</div>
      <div class="tools">${tools.map(([name, label, key]) => `<button class="tool ${name === "pencil" ? "active" : ""}" data-tool="${name}" title="${label}${key ? ` (${key})` : ""}" aria-label="${label}" aria-pressed="${name === "pencil"}">${icon(name)}${key ? `<span class="tool-key">${key}</span>` : ""}</button>`).join("")}</div>
      <div class="rail-divider"></div>
      <div class="rail-options">
        ${button("mirror", "Симметрия", 'data-toggle="symmetry" aria-pressed="false"')}
        ${button("tile", "Повтор текстуры", 'data-toggle="tile" aria-pressed="false"')}
      </div>
      <div class="color-pair" title="Основной и фоновый цвет"><span class="back-color"></span><input id="foreground" type="color" value="${selectedColor}" aria-label="Основной цвет"/>${button("swap", "Поменять цвета местами", 'data-action="swap"')}</div>
      <span class="rail-bottom">1:1</span>
    </aside>
    <section class="center-column" aria-label="Рабочая область">
      <div class="tool-options">
        <span class="active-tool-name">${icon("pencil")}<span id="tool-name">Карандаш</span></span>
        <span class="separator"></span>
        <label class="compact-label">Размер <input id="brush-size" type="number" min="1" max="64" value="1"/><span>px</span></label>
        <label class="compact-label opacity-option">Непрозр. <input id="brush-opacity" type="number" min="1" max="100" value="100"/><span>%</span></label>
        <button class="icon-button" data-action="brush-settings" title="Параметры инструмента" aria-label="Параметры инструмента">${icon("settings")}</button><span class="options-spacer"></span>
        ${button("grid", "Пиксельная сетка", 'data-action="grid" id="grid-toggle" aria-pressed="false"')}
        ${button("onion", "Калька соседних кадров", 'data-toggle="onion" aria-pressed="false"')}
      </div>
      <div class="viewport" id="viewport">
        <div class="canvas-corner top-left"></div><div class="canvas-corner bottom-right"></div>
        <img id="reference-image" alt="Референс" hidden/><div class="workspace-label">ЛЕСНОЙ ДОМИК <span>/ 64 × 64</span></div>
        <div class="artboard" id="artboard"><canvas id="onion-canvas" aria-hidden="true"></canvas><canvas id="artwork" width="64" height="64" aria-label="Холст пиксельного редактора"></canvas><div class="pixel-grid" id="pixel-grid" hidden></div><canvas id="selection-canvas" aria-hidden="true"></canvas><div id="cursor" hidden></div></div>
        <div class="canvas-caption"><span class="caption-dot"></span>Колесо — масштаб · два пальца — масштаб и сдвиг</div>
        <div class="zoom-controls">
          ${button("minus", "Уменьшить холст", 'data-action="zoom-out"')}
          <button class="zoom-value" data-action="fit" id="zoom-value" title="Вписать холст">600%</button>
          ${button("plus", "Увеличить холст", 'data-action="zoom-in"')}
          <span class="separator"></span>
          ${button("fit", "Вписать холст · F", 'data-action="fit"')}
        </div>
      </div>
      <section class="timeline" aria-label="Кадры анимации" id="timeline-panel">
        <div class="panel-heading timeline-heading"><h2>${icon("frame")} Анимация <span class="count" id="frame-count">6 кадров</span></h2><div class="panel-actions">${button("settings", "Длительность и порядок кадра", 'data-action="frame-settings"')}${button("trash", "Удалить кадр", 'data-action="delete-frame"')}${button("duplicate", "Дублировать кадр", 'data-action="duplicate-frame"')}${button("plus", "Добавить кадр", 'data-action="add-frame"')}${button("close", "Закрыть панель", 'data-action="close-drawer" data-drawer-close')}</div></div>
        <div class="timeline-body">
          <div class="playback">
            <div class="transport">${button("first", "Первый кадр", 'data-action="first-frame"')}<button class="play-button" data-action="play" id="play-button" aria-label="Воспроизвести анимацию">${icon("play")}</button>${button("last", "Последний кадр", 'data-action="last-frame"')}</div>
            <label class="fps-label"><input id="fps" type="number" min="1" max="30" value="6" aria-label="Частота кадров"/> <span>FPS</span></label>
          </div>
          <div class="frames" id="frames"></div>
        </div>
      </section>
    </section>
    <aside class="sidebar" id="sidebar" aria-label="Палитра и слои">
      <section class="palette-panel" id="palette-panel">
        <div class="panel-heading"><h2>${icon("palette")} Палитра <span class="count">24</span></h2><div class="panel-actions">${button("plus", "Добавление цвета", 'data-action="add-color"')}${button("close", "Закрыть панель", 'data-action="close-drawer" data-drawer-close')}</div></div>
        <button class="palette-name" data-action="palette"><span><span class="palette-mini"></span>Лесная тропа</span>${icon("chevron")}</button>
        <div class="swatches">${colors.map((color, index) => `<button class="swatch ${color === selectedColor ? "selected" : ""}" style="--swatch:${color}" data-color="${color}" title="${color}" aria-label="Цвет ${color}" aria-pressed="${color === selectedColor}"><span>${index + 1}</span></button>`).join("")}</div>
        <div class="color-details"><label class="color-preview" for="foreground" id="color-preview" style="background:${selectedColor}"></label><div><span class="small-label">ОСНОВНОЙ ЦВЕТ</span><span class="hex-color" id="hex-color">${selectedColor.toUpperCase()}</span></div><span class="alpha-label">100%</span></div>
      </section>
      <section class="preview-panel"><div class="panel-heading"><h2>${icon("image")} Навигатор</h2><span class="small-label">1:1</span></div><div class="navigator"><canvas id="navigator" width="64" height="64" aria-label="Миниатюра изображения"></canvas><span>64 × 64 px</span></div></section>
      <section class="layers-panel" id="layers-panel">
        <div class="panel-heading"><h2>${icon("layers")} Слои <span class="count" id="layer-count">3</span></h2><div class="panel-actions">${button("plus", "Добавить слой", 'data-action="add-layer"')}${button("close", "Закрыть панель", 'data-action="close-drawer" data-drawer-close')}</div></div>
        <div class="layer-settings"><select aria-label="Режим наложения" id="blend-mode"><option value="source-over">Обычный</option><option value="multiply">Умножение</option><option value="screen">Экран</option><option value="overlay">Перекрытие</option></select><label title="Непрозрачность слоя"><input id="layer-opacity" type="number" min="0" max="100" value="100"/>%</label></div>
        <div class="layer-list" id="layer-list"></div>
        <div class="layer-footer"><div>${button("plus", "Добавить слой", 'data-action="add-layer"')}${button("duplicate", "Дублировать слой", 'data-action="duplicate-layer"')}${button("trash", "Удалить слой", 'data-action="delete-layer"')}</div><div>${button("up", "Переместить слой выше", 'data-action="layer-up"')}${button("down", "Переместить слой ниже", 'data-action="layer-down"')}</div></div>
      </section>
      <div class="sidebar-note" id="autosave-status">Автосохранение на устройстве<br/><span>Файлы не отправляются на сервер</span></div>
    </aside>
  </main>
  <div class="mobile-dock" aria-label="Панели редактора"><button class="active" data-action="close-drawer">${icon("pencil")}<span>Холст</span></button><button data-drawer="palette">${icon("palette")}<span>Палитра</span></button><button data-drawer="layers">${icon("layers")}<span>Слои</span><span class="dock-count" id="dock-layer-count">3</span></button><button data-drawer="timeline">${icon("frame")}<span>Кадры</span></button></div>
  <footer class="status-bar"><span class="status-left"><span class="status-dot"></span><span>Готово</span><span class="status-separator">/</span><span id="status-tool">Карандаш</span></span><span class="status-middle">B — карандаш <span>·</span> E — ластик <span>·</span> F — вписать</span><span class="status-right">64 × 64 px <span>RGBA</span></span></footer>
  <div class="drawer-backdrop" id="drawer-backdrop" hidden></div>
  <div class="toast" id="toast" role="status" hidden></div>
  <dialog id="dialog"><div id="dialog-content"></div></dialog>
`;
}
