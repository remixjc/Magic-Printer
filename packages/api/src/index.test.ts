import test from "node:test";
import assert from "node:assert/strict";
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
