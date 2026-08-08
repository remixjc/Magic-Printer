import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import staticPlugin from "@fastify/static";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AppSettings, DependencyStatus, PrintJob } from "@magic-printer/shared";
import { appSettingsSchema, printOptionsSchema } from "@magic-printer/shared";
import type { PlatformServices } from "@magic-printer/platform";
import { isOfficeDocument, isPdf, isImage, isSupportedDocument } from "@magic-printer/converters";

export type ApiContext = {
  dataDir: string;
  staticDir?: string;
  settings: AppSettings;
  platform: PlatformServices;
  jobs: Map<string, PrintJob>;
  files: Map<string, string>;
  previewFiles: Map<string, string>;
  previewTypes: Map<string, string>;
  pairingCode?: string;
  accessUrls?: () => string[];
  onSettingsChanged?: (settings: AppSettings) => void | Promise<void>;
  onJobChanged?: (job: PrintJob) => void | Promise<void>;
  onJobDeleted?: (id: string) => void | Promise<void>;
};

const now = () => new Date().toISOString();

const libreOfficeGuide = () => {
  if (process.platform === "win32") return { installUrl: "https://www.libreoffice.org/download/download-libreoffice/", installCommand: "winget install --id TheDocumentFoundation.LibreOffice" };
  if (process.platform === "darwin") return { installUrl: "https://www.libreoffice.org/download/download-libreoffice/", installCommand: "brew install --cask libreoffice" };
  return { installUrl: "https://www.libreoffice.org/download/download-libreoffice/", installCommand: "sudo apt install libreoffice" };
};

export const createApiServer = async (context: ApiContext): Promise<FastifyInstance> => {
  const app = Fastify({ logger: true, bodyLimit: 100 * 1024 * 1024 });
  const sessions = new Map<string, number>();
  const streams = new Map<string, Set<NodeJS.WritableStream>>();
  const emit = (job: PrintJob) => streams.get(job.id)?.forEach((stream) => stream.write(`data: ${JSON.stringify(job)}\n\n`));
  const save = async (job: PrintJob) => { await context.onJobChanged?.(job); emit(job); };
  app.addHook("onSend", async (_request, reply) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header("X-Frame-Options", "SAMEORIGIN");
    reply.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    reply.header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; frame-src 'self'; connect-src 'self'");
  });
  await app.register(cors, { origin: false });
  await app.register(multipart, { limits: { fileSize: 100 * 1024 * 1024, files: 1 } });
  if (context.staticDir) await app.register(staticPlugin, { root: context.staticDir, wildcard: false });

  const isLoopback = (ip: string) => ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
  app.addHook("onRequest", async (request, reply) => {
    if (!context.settings.server.lanAccess || isLoopback(request.ip) || request.url.startsWith("/api/v1/health") || request.url.startsWith("/api/v1/auth/pair")) return;
    const presented = request.headers.authorization?.replace(/^Bearer\s+/i, "") ?? new URL(request.url, "http://localhost").searchParams.get("access_token");
    const expiresAt = presented ? sessions.get(presented) : undefined;
    if (!presented || !expiresAt || expiresAt <= Date.now()) {
      if (presented) sessions.delete(presented);
      return reply.code(401).send({ error: { code: "AUTH_REQUIRED", message: "局域网访问需要授权口令" } });
    }
  });

  app.get("/api/v1/health", async (request) => ({ ok: true, version: "0.1.0", now: now(), lanAccess: context.settings.server.lanAccess, requiresAuth: context.settings.server.lanAccess && !isLoopback(request.ip) }));

  app.post<{ Body: { token?: string } }>("/api/v1/auth/pair", async (request, reply) => {
    const expected = context.pairingCode;
    const supplied = request.body?.token;
    const valid = expected && supplied && Buffer.byteLength(expected) === Buffer.byteLength(supplied) && timingSafeEqual(Buffer.from(expected), Buffer.from(supplied));
    if (!valid) return reply.code(401).send({ error: { code: "INVALID_PAIRING", message: "配对口令不正确" } });
    const token = randomBytes(32).toString("base64url");
    const expiresIn = 60 * 60 * 24;
    sessions.set(token, Date.now() + expiresIn * 1000);
    return { token, expiresIn };
  });

  app.get("/api/v1/capabilities", async (request) => {
    const [printers, libreOffice] = await Promise.all([
      context.platform.printers.listPrinters(),
      context.platform.detectLibreOffice()
    ]);
    const selected = context.settings.selectedPrinterId;
    const dependencies: DependencyStatus = {
      libreOffice: libreOffice.available ? libreOffice : { ...libreOffice, ...libreOfficeGuide() },
      encryptionDetector: { available: true, provider: "heuristic-local" }
    };
    return { printers, selectedPrinterId: selected, dependencies, settings: context.settings, security: { lanAccess: context.settings.server.lanAccess, pairingCode: isLoopback(request.ip) ? context.pairingCode : undefined, accessUrls: context.settings.server.lanAccess ? context.accessUrls?.() ?? [] : [] } };
  });

  app.get("/api/v1/jobs", async () => ({ jobs: [...context.jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)) }));

  app.post("/api/v1/uploads", async (request, reply) => {
    const part = await request.file();
    if (!part) return reply.code(400).send({ error: { code: "FILE_REQUIRED", message: "请选择要打印的文件" } });
    if (!isSupportedDocument(part.mimetype, part.filename)) return reply.code(415).send({ error: { code: "UNSUPPORTED_FORMAT", message: "仅支持 PDF、Word、Excel 和常见图片格式" } });
    const id = randomUUID();
    const uploadDir = join(context.dataDir, "uploads", id);
    await mkdir(uploadDir, { recursive: true });
    const safeName = part.filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 160) || "document";
    const filePath = join(uploadDir, safeName);
    const fileBuffer = await part.toBuffer();
    await writeFile(filePath, fileBuffer);
    const createdAt = now();
    const job: PrintJob = { id, fileName: part.filename, mimeType: part.mimetype, status: "uploaded", printerId: context.settings.selectedPrinterId, createdAt, updatedAt: createdAt };
    const encryption = await context.platform.encryption.inspect(filePath);
    if (encryption.verdict === "encrypted" || encryption.verdict === "suspected") {
      job.status = "blocked";
      job.error = "文件疑似已被 E-safe 加密，请解密后重新上传";
    }
    context.jobs.set(id, job);
    if (job.status === "blocked") {
      await unlink(filePath).catch(() => undefined);
    } else {
      context.files.set(id, filePath);
    }
    if (job.status !== "blocked" && (isPdf(part.mimetype, part.filename) || isImage(part.mimetype, part.filename))) {
      context.previewFiles.set(id, filePath);
      context.previewTypes.set(id, part.mimetype.startsWith("image/") ? part.mimetype : "application/pdf");
    }
    await save(job);
    return reply.code(201).send({ job });
  });

  app.get<{ Params: { id: string } }>("/api/v1/jobs/:id", async (request, reply) => {
    const job = context.jobs.get(request.params.id);
    if (!job) return reply.code(404).send({ error: { code: "NOT_FOUND", message: "打印任务不存在" } });
    return { job };
  });

  app.get<{ Params: { id: string } }>("/api/v1/jobs/:id/events", async (request, reply) => {
    const job = context.jobs.get(request.params.id);
    if (!job) return reply.code(404).send({ error: { code: "NOT_FOUND", message: "打印任务不存在" } });
    reply.hijack();
    reply.raw.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    reply.raw.write(`data: ${JSON.stringify(job)}\n\n`);
    const set = streams.get(job.id) ?? new Set<NodeJS.WritableStream>();
    set.add(reply.raw); streams.set(job.id, set);
    const heartbeat = setInterval(() => reply.raw.write(": keep-alive\n\n"), 15_000);
    reply.raw.on("close", () => { clearInterval(heartbeat); set.delete(reply.raw); if (set.size === 0) streams.delete(job.id); });
  });

  app.post<{ Params: { id: string } }>("/api/v1/jobs/:id/prepare", async (request, reply) => {
    const job = context.jobs.get(request.params.id);
    const inputPath = context.files.get(request.params.id);
    if (!job) return reply.code(404).send({ error: { code: "NOT_FOUND", message: "打印任务不存在" } });
    if (job.status === "blocked") return reply.code(409).send({ error: { code: "ENCRYPTED_FILE", message: job.error ?? "文件已被阻断" } });
    if (!inputPath) return reply.code(404).send({ error: { code: "NOT_FOUND", message: "打印任务文件不存在" } });
    if (isPdf(job.mimeType, job.fileName) || isImage(job.mimeType, job.fileName)) {
      const ready = { ...job, status: "ready" as const, updatedAt: now() };
      context.jobs.set(job.id, ready); await save(ready); return { job: ready, preview: `/api/v1/jobs/${job.id}/preview` };
    }
    if (!isOfficeDocument(job.mimeType, job.fileName)) return reply.code(415).send({ error: { code: "UNSUPPORTED_FORMAT", message: "当前文件格式暂不支持预览" } });
    if (!context.settings.officePreview) return reply.code(409).send({ error: { code: "OFFICE_PREVIEW_DISABLED", message: "当前设备未启用 Office 预览，请在设置中开启后重试" } });
    const probe = await context.platform.converter.probe();
    if (!probe.available) return reply.code(409).send({ error: { code: "PREVIEW_DEPENDENCY_MISSING", message: "未安装 LibreOffice，当前不支持 Office 文件预览" } });
    try {
      const outputDir = join(context.dataDir, "previews", job.id);
      const pdfPath = await context.platform.converter.convertToPdf(inputPath, outputDir);
      context.previewFiles.set(job.id, pdfPath);
      const ready = { ...job, status: "ready" as const, updatedAt: now() };
      context.jobs.set(job.id, ready); await save(ready); return { job: ready, preview: `/api/v1/jobs/${job.id}/preview` };
    } catch (error) { return reply.code(422).send({ error: { code: "CONVERSION_FAILED", message: error instanceof Error ? error.message : "文档转换失败" } }); }
  });

  app.get<{ Params: { id: string } }>("/api/v1/jobs/:id/preview", async (request, reply) => {
    const path = context.previewFiles.get(request.params.id);
    if (!path) return reply.code(404).send({ error: { code: "PREVIEW_NOT_READY", message: "预览尚未准备完成" } });
    return reply.type(context.previewTypes.get(request.params.id) ?? "application/pdf").send(createReadStream(path));
  });

  app.post<{ Params: { id: string }; Body: unknown }>("/api/v1/jobs/:id/print", async (request, reply) => {
    const job = context.jobs.get(request.params.id);
    const filePath = context.previewFiles.get(request.params.id) ?? context.files.get(request.params.id);
    if (!job || !filePath) return reply.code(404).send({ error: { code: "NOT_FOUND", message: "打印任务不存在" } });
    if (job.status === "blocked") return reply.code(409).send({ error: { code: "ENCRYPTED_FILE", message: "文件疑似已被 E-safe 加密，请解密后重新上传" } });
    if (!isPdf(job.mimeType, job.fileName) && !isImage(job.mimeType, job.fileName)) return reply.code(409).send({ error: { code: "PREVIEW_PIPELINE_PENDING", message: "Office 文件需要先完成预览准备后再打印" } });
    if (!job.printerId) return reply.code(409).send({ error: { code: "PRINTER_NOT_SELECTED", message: "请先在桌面端设置中选择打印机" } });
    const parsed = printOptionsSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: { code: "INVALID_PRINT_OPTIONS", message: parsed.error.message } });
    const printer = (await context.platform.printers.listPrinters()).find((item) => item.id === job.printerId);
    if (!printer) return reply.code(409).send({ error: { code: "PRINTER_NOT_FOUND", message: "已配置的打印机当前不可用，请重新选择打印机" } });
    if (parsed.data.color === "color" && printer.capabilities.color === false) return reply.code(409).send({ error: { code: "UNSUPPORTED_COLOR", message: "当前打印机不支持彩色打印" } });
    if (parsed.data.duplex !== "none" && printer.capabilities.duplex === false) return reply.code(409).send({ error: { code: "UNSUPPORTED_DUPLEX", message: "当前打印机不支持双面打印" } });
    if (printer.capabilities.paperSizes.length > 0 && !printer.capabilities.paperSizes.includes(parsed.data.paperSize)) return reply.code(409).send({ error: { code: "UNSUPPORTED_PAPER", message: `当前打印机不支持 ${parsed.data.paperSize} 纸张` } });
    const update = async (status: PrintJob["status"], error?: string) => {
      const { error: _oldError, ...withoutError } = job;
      const next: PrintJob = error
        ? { ...withoutError, status, error, printOptions: parsed.data, updatedAt: now() }
        : { ...withoutError, status, printOptions: parsed.data, updatedAt: now() };
      context.jobs.set(job.id, next);
      await save(next);
      return next;
    };
    await update("queued");
    try {
      await update("printing");
      await context.platform.printers.printPdf({ filePath, printerId: job.printerId, options: parsed.data });
      return { job: await update("succeeded") };
    } catch (error) {
      const message = error instanceof Error ? error.message : "打印失败";
      return reply.code(500).send({ error: { code: "PRINT_FAILED", message }, job: await update("failed", message) });
    }
  });

  app.delete<{ Params: { id: string } }>("/api/v1/jobs/:id", async (request, reply) => {
    const existed = context.jobs.delete(request.params.id);
    if (!existed) return reply.code(404).send({ error: { code: "NOT_FOUND", message: "打印记录不存在" } });
    await context.onJobDeleted?.(request.params.id);
    const filePath = context.files.get(request.params.id);
    const previewPath = context.previewFiles.get(request.params.id);
    context.files.delete(request.params.id);
    context.previewFiles.delete(request.params.id);
    context.previewTypes.delete(request.params.id);
    if (filePath) await unlink(filePath).catch(() => undefined);
    if (previewPath && previewPath !== filePath) await unlink(previewPath).catch(() => undefined);
    return reply.code(204).send();
  });

  app.get("/api/v1/settings", async () => context.settings);
  app.put<{ Body: unknown }>("/api/v1/settings", async (request, reply) => {
    const result = appSettingsSchema.safeParse(request.body);
    if (!result.success) return reply.code(400).send({ error: { code: "INVALID_SETTINGS", message: result.error.message } });
    context.settings = result.data;
    await context.onSettingsChanged?.(context.settings);
    return context.settings;
  });

  if (context.staticDir) app.setNotFoundHandler(async (request, reply) => {
    if (request.raw.method === "GET" && !request.url.startsWith("/api/")) return reply.sendFile("index.html");
    return reply.code(404).send({ error: { code: "NOT_FOUND", message: "资源不存在" } });
  });

  return app;
};
