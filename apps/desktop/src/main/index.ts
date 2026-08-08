import { app, BrowserWindow, Menu, Tray, nativeImage, shell, dialog } from "electron";
import { randomInt } from "node:crypto";
import { networkInterfaces } from "node:os";
import { rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createApiServer } from "@magic-printer/api";
import { LocalDatabase } from "@magic-printer/database";
import { LibreOfficeConverter, UnconfiguredEncryptionDetector, type PlatformServices, type PrinterAdapter } from "@magic-printer/platform";
import type { PrinterInfo, PrintOptions } from "@magic-printer/shared";
import electronUpdater from "electron-updater";
const { autoUpdater } = electronUpdater;

let mainWindow: BrowserWindow | null = null;
let printWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let server: Awaited<ReturnType<typeof createApiServer>> | null = null;
let database: LocalDatabase | null = null;
let isQuitting = false;
let cleanupTimer: NodeJS.Timeout | null = null;
let restartTimer: NodeJS.Timeout | null = null;
let boundServer = { host: "127.0.0.1", port: 17890 };

const traySvg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#6755db"/><path d="M9 5h14v7H9zM7 12h18a3 3 0 0 1 3 3v8h-5v5H9v-5H4v-8a3 3 0 0 1 3-3Zm4 9v5h10v-5Z" fill="none" stroke="white" stroke-width="2" stroke-linejoin="round"/></svg>`;

const getAccessUrls = () => Object.values(networkInterfaces()).flatMap((items) => (items ?? []).filter((item) => !item.internal && item.family === "IPv4").map((item) => `http://${item.address}:${boundServer.port}`));

class ElectronPrinterAdapter implements PrinterAdapter {
  constructor(private readonly host: () => BrowserWindow) {}

  async listPrinters(): Promise<PrinterInfo[]> {
    const printers = await this.host().webContents.getPrintersAsync();
    return printers.map((printer) => ({
      id: printer.name,
      name: printer.displayName || printer.name,
      systemName: printer.name,
      isDefault: printer.isDefault,
      status: printer.status === 0 ? "online" : "unknown",
      capabilities: { paperSizes: [] }
    }));
  }

  async printPdf(input: { filePath: string; printerId: string; options: PrintOptions }): Promise<{ nativeJobId?: string }> {
    const target = this.host();
    await target.loadURL(pathToFileURL(input.filePath).toString());
    await new Promise<void>((resolvePrint, reject) => target.webContents.print({
      silent: true,
      deviceName: input.printerId,
      copies: input.options.copies,
      color: input.options.color === "color",
      landscape: input.options.orientation === "landscape",
      duplexMode: input.options.duplex === "none" ? "simplex" : input.options.duplex === "long-edge" ? "longEdge" : "shortEdge",
      pagesPerSheet: 1,
      printBackground: true
    }, (success, reason) => success ? resolvePrint() : reject(new Error(reason || "打印失败"))));
    return {};
  }

  async cancel(): Promise<void> { throw new Error("当前平台打印任务进入系统队列后暂不支持取消"); }
}

const getPrintWindow = () => {
  if (!printWindow || printWindow.isDestroyed()) printWindow = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true } });
  return printWindow;
};

const createWindow = async (url: string) => {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 820,
    minHeight: 600,
    show: false,
    title: "Magic Printer",
    backgroundColor: "#1e1e1e",
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  mainWindow.removeMenu();
  mainWindow.on("close", (event) => { if (!isQuitting) { event.preventDefault(); mainWindow?.hide(); } });
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.webContents.setWindowOpenHandler(({ url: target }) => { if (target.startsWith("https://")) void shell.openExternal(target); return { action: "deny" }; });
  await mainWindow.loadURL(url);
};

const createTray = (url: string) => {
  const image = nativeImage.createFromBuffer(Buffer.from(traySvg));
  if (process.platform === "darwin") image.setTemplateImage(true);
  tray = new Tray(image.resize({ width: 18, height: 18 }));
  tray.setToolTip("Magic Printer");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "打开 Magic Printer", click: () => { mainWindow?.show(); mainWindow?.focus(); } },
    { label: "在浏览器中打开", click: () => void shell.openExternal(url) },
    { type: "separator" },
    { label: "检查更新", click: () => void checkForUpdates(true) },
    { type: "separator" },
    { label: "退出", click: () => { isQuitting = true; app.quit(); } }
  ]));
  tray.on("double-click", () => { mainWindow?.show(); mainWindow?.focus(); });
};

const checkForUpdates = async (manual = false) => {
  if (!app.isPackaged) {
    if (manual) await dialog.showMessageBox({ type: "info", title: "开发模式", message: "开发模式不会检查 GitHub Releases 更新。" });
    return;
  }
  try {
    const result = await autoUpdater.checkForUpdates();
    if (manual && !result?.updateInfo) await dialog.showMessageBox({ type: "info", title: "检查更新", message: "当前已经是最新版本。" });
  } catch (error) {
    if (manual) await dialog.showMessageBox({ type: "error", title: "检查更新失败", message: error instanceof Error ? error.message : "无法连接更新服务" });
  }
};

const configureUpdater = () => {
  if (!app.isPackaged) return;
  autoUpdater.autoDownload = true;
  autoUpdater.on("update-available", () => undefined);
  autoUpdater.on("update-downloaded", async () => {
    const result = await dialog.showMessageBox({ type: "info", title: "更新已下载", message: "新版本已准备完成，重启 Magic Printer 后安装。", buttons: ["立即重启", "稍后"] });
    if (result.response === 0) { isQuitting = true; autoUpdater.quitAndInstall(); }
  });
  void checkForUpdates();
};

const bootstrap = async () => {
  const dataDir = app.getPath("userData");
  database = await LocalDatabase.open(join(dataDir, "magic-printer.sqlite"));
  const cleanupExpired = async () => {
    if (!database) return;
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const expiredIds = database.deleteExpiredJobs(cutoff);
    await Promise.all(expiredIds.flatMap((id) => [
      rm(join(dataDir, "uploads", id), { recursive: true, force: true }),
      rm(join(dataDir, "previews", id), { recursive: true, force: true })
    ]));
  };
  await cleanupExpired();
  cleanupTimer = setInterval(() => void cleanupExpired(), 6 * 60 * 60 * 1000);
  const settings = database.readSettings();
  boundServer = { host: settings.server.host, port: settings.server.port };
  const jobs = new Map(database.listJobs().map((job) => [job.id, job]));
  const files = new Map<string, string>();
  const previewFiles = new Map<string, string>();
  const previewTypes = new Map<string, string>();
  const converter = new LibreOfficeConverter();
  const pairingCode = String(randomInt(100000, 1000000));
  const platform: PlatformServices = {
    printers: new ElectronPrinterAdapter(getPrintWindow),
    detectLibreOffice: () => converter.probe(),
    encryption: new UnconfiguredEncryptionDetector(),
    converter
  };
  const staticDir = resolve(app.getAppPath(), "../web/dist");
  server = await createApiServer({
    dataDir,
    staticDir,
    settings,
    jobs,
    files,
    previewFiles,
    previewTypes,
    pairingCode,
    accessUrls: getAccessUrls,
    platform,
    onSettingsChanged: (next) => {
      database?.writeSettings(next);
      app.setLoginItemSettings({ openAtLogin: next.launchAtStartup, openAsHidden: true, args: ["--hidden"] });
      if (next.server.host !== boundServer.host || next.server.port !== boundServer.port) {
        if (restartTimer) clearTimeout(restartTimer);
        restartTimer = setTimeout(() => {
          void (async () => {
            if (!server) return;
            await server.close();
            boundServer = { host: next.server.host, port: next.server.port };
            await server.listen(boundServer);
            await mainWindow?.loadURL(`http://127.0.0.1:${boundServer.port}`);
          })().catch((error) => console.error("Failed to restart local service", error));
        }, 0);
      }
    },
    onJobChanged: (job) => database?.saveJob(job),
    onJobDeleted: (id) => { database?.deleteJob(id); }
  });
  await server.listen({ host: settings.server.host, port: settings.server.port });
  const url = `http://${settings.server.host}:${settings.server.port}`;
  await createWindow(url);
  createTray(url);
  configureUpdater();
  if (process.argv.includes("--hidden")) mainWindow?.hide();
};

const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) app.quit();
else {
  app.on("second-instance", () => { mainWindow?.show(); mainWindow?.focus(); });
  app.whenReady().then(bootstrap).catch((error) => { console.error(error); app.quit(); });
  app.on("activate", () => { if (mainWindow) mainWindow.show(); });
  app.on("before-quit", () => { isQuitting = true; });
  app.on("will-quit", () => { if (cleanupTimer) clearInterval(cleanupTimer); void server?.close(); database?.close(); });
  app.on("window-all-closed", () => { /* tray application stays alive */ });
}
