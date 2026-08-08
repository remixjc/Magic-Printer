import type { PrinterInfo, PrintOptions } from "@magic-printer/shared";
import { LibreOfficeConverter, type DocumentConverter } from "@magic-printer/converters";
import { readFile } from "node:fs/promises";

export type NativePrintResult = { nativeJobId?: string };

export type EncryptionVerdict = "plain" | "encrypted" | "suspected" | "unavailable";
export type EncryptionDetection = { verdict: EncryptionVerdict; provider: string; detail?: string };

export interface EncryptionDetector {
  inspect(filePath: string): Promise<EncryptionDetection>;
}

export interface PrinterAdapter {
  listPrinters(): Promise<PrinterInfo[]>;
  printPdf(input: { filePath: string; printerId: string; options: PrintOptions }): Promise<NativePrintResult>;
  cancel(nativeJobId: string): Promise<void>;
}

export class MockPrinterAdapter implements PrinterAdapter {
  private readonly printers: PrinterInfo[] = [{
    id: "mock-default",
    name: "Magic Printer Test Device",
    systemName: "mock-default",
    isDefault: true,
    status: "online",
    capabilities: { color: true, duplex: true, paperSizes: ["A4", "Letter"] }
  }];

  async listPrinters(): Promise<PrinterInfo[]> {
    return this.printers;
  }

  async printPdf(input: { filePath: string; printerId: string; options: PrintOptions }): Promise<NativePrintResult> {
    const printer = this.printers.find((item) => item.id === input.printerId);
    if (!printer) throw new Error(`Printer not found: ${input.printerId}`);
    return { nativeJobId: `mock-${Date.now()}` };
  }

  async cancel(_nativeJobId: string): Promise<void> {}
}

export class UnconfiguredEncryptionDetector implements EncryptionDetector {
  async inspect(_filePath: string): Promise<EncryptionDetection> {
    return { verdict: "unavailable", provider: "not-configured" };
  }
}

export class HeuristicEncryptionDetector implements EncryptionDetector {
  private readonly markers = [Buffer.from("Esafenet", "ascii"), Buffer.from("E-safe", "ascii"), Buffer.from("ESAFE", "ascii")];

  async inspect(filePath: string): Promise<EncryptionDetection> {
    const content = await readFile(filePath);
    const sample = content.subarray(0, Math.min(content.length, 64 * 1024));
    const marker = this.markers.find((item) => sample.includes(item));
    if (marker) return { verdict: "encrypted", provider: "heuristic-local", detail: `检测到文件标记 ${marker.toString("ascii")}` };
    const extension = filePath.toLowerCase().split(".").pop();
    const office = ["doc", "docx", "xls", "xlsx"].includes(extension ?? "");
    const looksLikeZip = content.subarray(0, 4).toString("ascii") === "PK\u0003\u0004";
    if (office && !looksLikeZip) return { verdict: "suspected", provider: "heuristic-local", detail: "Office 文件不是标准 ZIP 容器" };
    return { verdict: "plain", provider: "heuristic-local" };
  }
}

export type PlatformServices = {
  printers: PrinterAdapter;
  detectLibreOffice: () => Promise<{ available: boolean; version?: string; path?: string }>;
  encryption: EncryptionDetector;
  converter: DocumentConverter;
};

export const createDefaultPlatformServices = (): PlatformServices => ({
  printers: new MockPrinterAdapter(),
  detectLibreOffice: async () => ({ available: false }),
  encryption: new HeuristicEncryptionDetector(),
  converter: new LibreOfficeConverter()
});

export { LibreOfficeConverter };
