import { app, BrowserWindow, Menu, Tray, nativeImage, shell, dialog } from "electron";
import { execFile } from "node:child_process";
import { randomInt } from "node:crypto";
import { networkInterfaces } from "node:os";
import { access, readdir, rm } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createApiServer } from "@magic-printer/api";
import { LocalDatabase } from "@magic-printer/database";
import { HeuristicEncryptionDetector, LibreOfficeConverter, type PlatformServices, type PrinterAdapter } from "@magic-printer/platform";
import type { AppSettings, PrinterInfo, PrintOptions } from "@magic-printer/shared";
import electronUpdater from "electron-updater";
import { promisify } from "node:util";
const { autoUpdater } = electronUpdater;
const execFileAsync = promisify(execFile);

let mainWindow: BrowserWindow | null = null;
let printWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let server: Awaited<ReturnType<typeof createApiServer>> | null = null;
let database: LocalDatabase | null = null;
let isQuitting = false;
let cleanupTimer: NodeJS.Timeout | null = null;
let restartTimer: NodeJS.Timeout | null = null;
let boundServer = { host: "127.0.0.1", port: 17890 };

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
      capabilities: this.mapCapabilities(printer.options, `${printer.name} ${printer.displayName || ""}`)
    }));
  }

  private mapCapabilities(rawOptions: unknown, printerName = ""): PrinterInfo["capabilities"] {
    const options = rawOptions && typeof rawOptions === "object" ? rawOptions as Record<string, unknown> : {};
    const isHpM427dw = /m427dw/i.test(printerName);
    const colorValue = options.color ?? options.colorMode ?? options.supportsColor;
    const duplexValue = options.duplex ?? options.duplexMode ?? options.supportsDuplex;
    const paperValue = options.paperSizes ?? options.mediaSizes ?? options.mediaSize;
    const detectedPaperSizes = Array.isArray(paperValue)
      ? paperValue.map((value) => typeof value === "string" ? value : (value && typeof value === "object" && "name" in value ? String(value.name) : "")).filter(Boolean)
      : [];
    const paperSizes = isHpM427dw
      ? [...new Set([...detectedPaperSizes, "A4", "A5", "A6", "Letter", "Legal"])]
      : detectedPaperSizes;
    const color = typeof colorValue === "boolean" ? colorValue : typeof colorValue === "string" ? !["mono", "monochrome", "grayscale", "black-and-white", "false", "0", "no", "off"].includes(colorValue.toLowerCase()) : isHpM427dw ? false : undefined;
    const duplex = typeof duplexValue === "boolean" ? duplexValue : typeof duplexValue === "string" ? !["none", "simplex", "false", "0", "no", "off"].includes(duplexValue.toLowerCase()) : isHpM427dw ? true : undefined;
    return { ...(color === undefined ? {} : { color }), ...(duplex === undefined ? {} : { duplex }), paperSizes };
  }

  async printPdf(input: { filePath: string; printerId: string; options: PrintOptions }): Promise<{ nativeJobId?: string }> {
    if (process.platform === "darwin" && extname(input.filePath).toLowerCase() === ".pdf") {
      return this.printPdfWithCups(input);
    }
    const target = this.host();
    await target.loadURL(pathToFileURL(input.filePath).toString());
    const pageRanges = this.parsePageRanges(input.options.pageRange);
    await new Promise<void>((resolvePrint, reject) => target.webContents.print({
      silent: true,
      deviceName: input.printerId,
      copies: input.options.copies,
      color: input.options.color === "color",
      landscape: input.options.orientation === "landscape",
      duplexMode: input.options.duplex === "none" ? "simplex" : input.options.duplex === "long-edge" ? "longEdge" : "shortEdge",
      pageSize: input.options.paperSize as "A4" | "A5" | "A6" | "Letter" | "Legal",
      ...(pageRanges ? { pageRanges } : {}),
      pagesPerSheet: input.options.paperLayout === "half" ? 2 : 1,
      printBackground: false
    }, (success, reason) => success ? resolvePrint() : reject(new Error(reason || "打印失败"))));
    return {};
  }

  private async printPdfWithCups(input: { filePath: string; printerId: string; options: PrintOptions }): Promise<{ nativeJobId?: string }> {
    const duplex = input.options.duplex === "none"
      ? "one-sided"
      : input.options.duplex === "long-edge"
        ? "two-sided-long-edge"
        : "two-sided-short-edge";
    const args = [
      "-d", input.printerId,
      "-n", String(input.options.copies),
      "-o", `media=${input.options.paperSize}`,
      "-o", `sides=${duplex}`,
      "-o", `number-up=${input.options.paperLayout === "half" ? 2 : 1}`,
      "-o", `orientation-requested=${input.options.orientation === "landscape" ? 4 : 3}`
    ];
    if (input.options.color === "grayscale") args.push("-o", "ColorModel=Gray");
    if (input.options.pageRange) args.push("-P", input.options.pageRange);
    args.push(input.filePath);
    try {
      const result = await execFileAsync("/usr/bin/lp", args, { timeout: 30_000 });
      const nativeJobId = result.stdout.match(/request id is\s+([^\s]+)/i)?.[1];
      return nativeJobId ? { nativeJobId } : {};
    } catch (error) {
      throw new Error(error instanceof Error ? `系统打印服务提交失败：${error.message}` : "系统打印服务提交失败");
    }
  }

  private parsePageRanges(value?: string): Array<{ from: number; to: number }> | undefined {
    if (!value?.trim()) return undefined;
    const ranges = value.split(",").map((part) => part.trim()).filter(Boolean).map((part) => {
      const numbers = part.split("-").map((item) => Number(item.trim()));
      const start = numbers[0] ?? NaN;
      const end = numbers[1] ?? start;
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) return null;
      return { from: start - 1, to: end - 1 };
    });
    return ranges.length > 0 && ranges.every(Boolean) ? ranges as Array<{ from: number; to: number }> : undefined;
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
  const trayPath = app.isPackaged ? join(process.resourcesPath, "tray-icon.png") : resolve(app.getAppPath(), "build/icon.png");
  const image = nativeImage.createFromPath(trayPath);
  if (image.isEmpty()) console.warn("Failed to load Magic Printer tray icon");
  const trayImage = image.resize({ width: 18, height: 18 });
  if (process.platform === "darwin") trayImage.setTemplateImage(false);
  tray = new Tray(trayImage);
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
  await Promise.all([...jobs.values()].map(async (job) => {
    if (job.status === "blocked") return;
    const safeName = job.fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 160) || "document";
    const filePath = join(dataDir, "uploads", job.id, safeName);
    try { await access(filePath); } catch { return; }
    files.set(job.id, filePath);
    const extension = extname(job.fileName).toLowerCase();
    if (job.mimeType.startsWith("image/") || extension === ".pdf") {
      previewFiles.set(job.id, filePath);
      previewTypes.set(job.id, job.mimeType.startsWith("image/") ? job.mimeType : "application/pdf");
      return;
    }
    if (job.status !== "ready") return;
    try {
      const entries = await readdir(join(dataDir, "previews", job.id));
      const previewName = entries.find((name) => [".pdf", ".html"].includes(extname(name).toLowerCase()));
      if (previewName) {
        const previewPath = join(dataDir, "previews", job.id, previewName);
        previewFiles.set(job.id, previewPath);
        previewTypes.set(job.id, extname(previewName).toLowerCase() === ".html" ? "text/html" : "application/pdf");
      }
    } catch { /* no persisted preview is available */ }
  }));
  const converter = new LibreOfficeConverter();
  const pairingCode = String(randomInt(100000, 1000000));
  const platform: PlatformServices = {
    printers: new ElectronPrinterAdapter(getPrintWindow),
    detectLibreOffice: () => converter.probe(),
    encryption: new HeuristicEncryptionDetector(),
    converter
  };
  const staticDir = app.isPackaged
    ? join(process.resourcesPath, "web")
    : resolve(app.getAppPath(), "../web/dist");
  let appliedLaunchAtStartup = settings.launchAtStartup;
  let createConfiguredServer: (nextSettings: AppSettings) => ReturnType<typeof createApiServer>;
  const scheduleServerRestart = (next: AppSettings) => {
    database?.writeSettings(next);
    if (next.launchAtStartup !== appliedLaunchAtStartup) {
      appliedLaunchAtStartup = next.launchAtStartup;
      if (!(process.platform === "darwin" && !app.isPackaged)) {
        try {
          app.setLoginItemSettings({ openAtLogin: next.launchAtStartup, openAsHidden: true, args: ["--hidden"] });
        } catch (error) {
          console.warn("Unable to update login item", error);
        }
      }
    }
    if (next.server.host === boundServer.host && next.server.port === boundServer.port) return;
    if (restartTimer) clearTimeout(restartTimer);
    const portChanged = next.server.port !== boundServer.port;
    restartTimer = setTimeout(() => {
      void (async () => {
        const previousServer = server;
        server = null;
        if (previousServer) await previousServer.close();
        boundServer = { host: next.server.host, port: next.server.port };
        const replacement = await createConfiguredServer(next);
        await replacement.listen(boundServer);
        server = replacement;
        if (portChanged) await mainWindow?.loadURL(`http://127.0.0.1:${boundServer.port}`);
      })().catch((error) => console.error("Failed to restart local service", error));
    }, 0);
  };
  createConfiguredServer = (nextSettings) => createApiServer({
    dataDir,
    staticDir,
    settings: nextSettings,
    jobs,
    files,
    previewFiles,
    previewTypes,
    pairingCode,
    accessUrls: getAccessUrls,
    platform,
    onSettingsChanged: scheduleServerRestart,
    onJobChanged: (job) => database?.saveJob(job),
    onJobDeleted: (id) => { database?.deleteJob(id); }
  });
  server = await createConfiguredServer(settings);
  await server.listen({ host: settings.server.host, port: settings.server.port });
  const localUrl = `http://127.0.0.1:${settings.server.port}`;
  const accessUrl = `http://${settings.server.host}:${settings.server.port}`;
  await createWindow(localUrl);
  createTray(accessUrl);
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
