import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { createApiServer, type ApiContext } from "./index.js";
import { createDefaultPlatformServices } from "@magic-printer/platform";

const makeContext = (lanAccess = false): ApiContext => ({
  dataDir: "/tmp/magic-printer-api-test",
  settings: {
    selectedPrinterId: null,
    server: { host: lanAccess ? "0.0.0.0" : "127.0.0.1", port: 17890, lanAccess },
    theme: "system",
    launchAtStartup: false,
    officePreview: false,
    updatedAt: new Date().toISOString()
  },
  platform: createDefaultPlatformServices(),
  jobs: new Map(),
  files: new Map(),
  previewFiles: new Map(),
  previewTypes: new Map(),
  pairingCode: "123456"
});

test("health and capabilities expose local service state", async () => {
  const app = await createApiServer(makeContext());
  const health = await app.inject({ method: "GET", url: "/api/v1/health" });
  const capabilities = await app.inject({ method: "GET", url: "/api/v1/capabilities" });
  assert.equal(health.statusCode, 200);
  assert.equal(health.json().requiresAuth, false);
  assert.equal(health.headers["x-content-type-options"], "nosniff");
  assert.equal(health.headers["x-frame-options"], "SAMEORIGIN");
  assert.equal(capabilities.statusCode, 200);
  assert.equal(capabilities.json().printers.length, 1);
  assert.match(capabilities.json().dependencies.libreOffice.installUrl, /^https:\/\//);
  assert.equal(typeof capabilities.json().dependencies.libreOffice.installCommand, "string");
  await app.close();
});

test("settings update invokes persistence callback", async () => {
  const context = makeContext();
  let persisted = false;
  context.onSettingsChanged = () => { persisted = true; };
  const app = await createApiServer(context);
  const response = await app.inject({
    method: "PUT",
    url: "/api/v1/settings",
    payload: { ...context.settings, theme: "dark", updatedAt: new Date().toISOString() }
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().theme, "dark");
  assert.equal(persisted, true);
  await app.close();
});

test("LAN pairing returns a short-lived session token", async () => {
  const app = await createApiServer(makeContext(true));
  const invalid = await app.inject({ method: "POST", url: "/api/v1/auth/pair", payload: { token: "000000" } });
  assert.equal(invalid.statusCode, 401);
  const paired = await app.inject({ method: "POST", url: "/api/v1/auth/pair", payload: { token: "123456" } });
  assert.equal(paired.statusCode, 200);
  assert.equal(typeof paired.json().token, "string");
  assert.equal(paired.json().expiresIn, 86400);
  await app.close();
});

test("print options are rejected when printer capabilities do not support them", async () => {
  const context = makeContext();
  const dataDir = join("/tmp", `magic-printer-api-capabilities-${Date.now()}`);
  await mkdir(dataDir, { recursive: true });
  const filePath = join(dataDir, "sample.pdf");
  await writeFile(filePath, "%PDF-1.4\n%%EOF\n");
  const printer = {
    id: "restricted-printer",
    name: "Restricted Printer",
    isDefault: true,
    status: "online" as const,
    capabilities: { color: false, duplex: false, paperSizes: ["A4"] }
  };
  context.settings.selectedPrinterId = printer.id;
  context.platform = {
    ...context.platform,
    printers: {
      listPrinters: async () => [printer],
      printPdf: async () => ({}),
      cancel: async () => undefined
    }
  };
  const job = {
    id: "restricted-job",
    fileName: "sample.pdf",
    mimeType: "application/pdf",
    status: "ready" as const,
    printerId: printer.id,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  context.jobs.set(job.id, job);
  context.files.set(job.id, filePath);
  context.previewFiles.set(job.id, filePath);
  context.previewTypes.set(job.id, "application/pdf");
  const app = await createApiServer(context);
  const response = await app.inject({ method: "POST", url: `/api/v1/jobs/${job.id}/print`, payload: { color: "color", duplex: "long-edge", paperSize: "A4" } });
  assert.equal(response.statusCode, 409);
  assert.equal(response.json().error.code, "UNSUPPORTED_COLOR");
  await app.close();
  await rm(dataDir, { recursive: true, force: true });
});

test("invalid page ranges are rejected before printing", async () => {
  const context = makeContext();
  context.settings.selectedPrinterId = "mock-default";
  const app = await createApiServer(context);
  const job = {
    id: "page-range-job",
    fileName: "sample.pdf",
    mimeType: "application/pdf",
    status: "ready" as const,
    printerId: "mock-default",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  context.jobs.set(job.id, job);
  context.files.set(job.id, "/tmp/sample.pdf");
  context.previewFiles.set(job.id, "/tmp/sample.pdf");
  context.previewTypes.set(job.id, "application/pdf");
  const response = await app.inject({ method: "POST", url: `/api/v1/jobs/${job.id}/print`, payload: { pageRange: "3--1" } });
  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error.code, "INVALID_PRINT_OPTIONS");
  await app.close();
});
