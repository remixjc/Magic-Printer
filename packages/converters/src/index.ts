import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import { access, mkdir } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type ConversionProbe = { available: boolean; path?: string; version?: string };

export interface DocumentConverter {
  probe(): Promise<ConversionProbe>;
  convertToPdf(inputPath: string, outputDir: string): Promise<string>;
}

const candidates = process.platform === "win32"
  ? ["soffice.exe", "libreoffice.exe"]
  : process.platform === "darwin"
    ? ["/Applications/LibreOffice.app/Contents/MacOS/soffice", "soffice"]
    : ["libreoffice", "soffice"];

const findExecutable = async (): Promise<string | undefined> => {
  for (const candidate of candidates) {
    try {
      if (candidate.includes("/")) return candidate;
      const command = process.platform === "win32" ? "where" : "which";
      const result = await execFileAsync(command, [candidate]);
      const path = result.stdout.trim().split(/\r?\n/)[0];
      if (path) return path;
    } catch { /* try next candidate */ }
  }
  return undefined;
};

export class LibreOfficeConverter implements DocumentConverter {
  private cachedPath: string | undefined;

  async probe(): Promise<ConversionProbe> {
    this.cachedPath ??= await findExecutable();
    if (!this.cachedPath) return { available: false };
    try {
      const result = await execFileAsync(this.cachedPath, ["--version"]);
      return { available: true, path: this.cachedPath, version: result.stdout.trim() };
    } catch {
      return { available: true, path: this.cachedPath };
    }
  }

  async convertToPdf(inputPath: string, outputDir: string): Promise<string> {
    await mkdir(outputDir, { recursive: true });
    // On macOS 27, LibreOffice 26.2 aborts while initializing NSApplication
    // in headless mode. Use Apple's textutil for Word files first so the app
    // does not invoke the crashing process at all.
    if (process.platform === "darwin" && [".doc", ".docx"].includes(extname(inputPath).toLowerCase())) {
      const htmlPath = join(outputDir, `${basename(inputPath, extname(inputPath))}.html`);
      try {
        await execFileAsync("/usr/bin/textutil", ["-convert", "html", "-output", htmlPath, inputPath], { timeout: 30_000 });
        await access(htmlPath);
        return htmlPath;
      } catch { /* fall through to LibreOffice for older macOS installations */ }
    }
    const probe = await this.probe();
    if (!probe.available || !probe.path) throw new Error("LibreOffice 未安装或不可用");
    const userProfile = join(outputDir, ".lo-profile");
    await mkdir(userProfile, { recursive: true });
    try {
      await execFileAsync(probe.path, [
        "--headless",
        "--nologo",
        "--nodefault",
        "--nofirststartwizard",
        `-env:UserInstallation=${pathToFileURL(userProfile).toString()}`,
        "--convert-to", "pdf",
        "--outdir", outputDir,
        inputPath
      ], { timeout: 120_000, windowsHide: true });
      const expected = join(outputDir, `${basename(inputPath, extname(inputPath))}.pdf`);
      try { await access(expected); return expected; } catch { throw new Error("LibreOffice 未生成预览文件"); }
    } catch (error) {
      // Some macOS LibreOffice builds abort in headless mode. Use the native
      // textutil converter for Word documents so preview/printing can still
      // proceed instead of leaving the job stuck in a loading state.
      if (process.platform === "darwin" && [".doc", ".docx"].includes(extname(inputPath).toLowerCase())) {
        const htmlPath = join(outputDir, `${basename(inputPath, extname(inputPath))}.html`);
        try {
          await execFileAsync("/usr/bin/textutil", ["-convert", "html", "-output", htmlPath, inputPath], { timeout: 30_000 });
          await access(htmlPath);
          return htmlPath;
        } catch { /* report the original conversion failure below */ }
      }
      throw new Error(error instanceof Error ? `Office 预览转换失败：${error.message}` : "Office 预览转换失败");
    }
  }
}

export const isOfficeDocument = (mimeType: string, fileName: string): boolean => {
  const extension = extname(fileName).toLowerCase();
  return mimeType.includes("word") || mimeType.includes("spreadsheet") || [".doc", ".docx", ".xls", ".xlsx"].includes(extension);
};

export const isPdf = (mimeType: string, fileName: string): boolean => mimeType === "application/pdf" || extname(fileName).toLowerCase() === ".pdf";

export const isImage = (mimeType: string, fileName: string): boolean => {
  const extension = extname(fileName).toLowerCase();
  return mimeType.startsWith("image/") || [".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif", ".tif", ".tiff"].includes(extension);
};

export const isSupportedDocument = (mimeType: string, fileName: string): boolean => isPdf(mimeType, fileName) || isOfficeDocument(mimeType, fileName) || isImage(mimeType, fileName);

// Kept as a named export so future preview pipelines can stream without changing their public contract.
export const openPreviewStream = (filePath: string) => createReadStream(filePath);
