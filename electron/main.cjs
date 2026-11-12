const { app, BrowserWindow, Menu, dialog, shell } = require("electron");
const path = require("node:path");

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 360,
    minHeight: 540,
    title: "MogDopPixes",
    backgroundColor: "#f7f6f2",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://github.com/Glob876/MogDopPixes"))
      void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-prevent-unload", (event) => {
    const response = dialog.showMessageBoxSync(window, {
      type: "question",
      title: "Закрыть MogDopPixes?",
      message: "Изменения ещё не сохранены в файл.",
      detail:
        "Черновик остаётся на устройстве. Для надёжной копии скачайте проект .pixes.",
      buttons: ["Остаться", "Закрыть"],
      defaultId: 0,
      cancelId: 0,
    });
    if (response === 1) event.preventDefault();
  });
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.on("did-finish-load", () => {
    console.info("MogDopPixes: интерфейс загружен.");
  });
  window.webContents.on("did-fail-load", (_event, code, description) => {
    console.error(`MogDopPixes: ошибка загрузки ${code}: ${description}`);
  });
  window.webContents.on("console-message", (event) => {
    if (event.level === "error") console.error(event.message);
  });
  if (process.argv.includes("--dev")) {
    window.loadURL("http://127.0.0.1:4190");
  } else {
    window.loadFile(path.join(__dirname, "../dist/index.html"));
  }
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
