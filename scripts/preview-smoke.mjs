#!/usr/bin/env node
import { mkdir, rm, stat } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";

const input = process.argv[2] === "--" ? process.argv[3] : process.argv[2];
if (!input) {
  console.error("用法：pnpm smoke:file -- <文件路径>");
  process.exitCode = 2;
  process.exit();
}

const filePath = resolve(input);
const { HeuristicEncryptionDetector, LibreOfficeConverter } = await import("../packages/platform/dist/index.js");
const detection = await new HeuristicEncryptionDetector().inspect(filePath);
const result = { fileName: basename(filePath), detection, preview: { ready: false } };

if (detection.verdict !== "plain") {
  result.preview = { ready: false, reason: "风险文件已阻断，不进入预览转换" };
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = 10;
  process.exit();
}

const extension = extname(filePath).toLowerCase();
if (![".doc", ".docx", ".xls", ".xlsx"].includes(extension)) {
  result.preview = { ready: true, type: extension === ".pdf" ? "pdf" : "image", path: filePath, size: (await stat(filePath)).size };
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = 0;
  process.exit();
}

const converter = new LibreOfficeConverter();
const probe = await converter.probe();
if (!probe.available) {
  result.preview = { ready: false, reason: "LibreOffice 未安装" };
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = 20;
  process.exit();
}

const outputDir = join("/tmp", `magic-printer-smoke-${Date.now()}`);
try {
  const pdfPath = await converter.convertToPdf(filePath, outputDir);
  const previewType = extname(pdfPath).toLowerCase() === ".html" ? "html" : "pdf";
  result.preview = { ready: true, type: previewType, path: pdfPath, size: (await stat(pdfPath)).size, converter: previewType === "html" ? "macOS textutil" : probe.version ?? probe.path };
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = 0;
} finally {
  await rm(outputDir, { recursive: true, force: true });
}
