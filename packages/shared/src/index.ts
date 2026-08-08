import { z } from "zod";

export const printerInfoSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  systemName: z.string().optional(),
  isDefault: z.boolean(),
  status: z.enum(["online", "offline", "unknown"]),
  capabilities: z.object({
    color: z.boolean().optional(),
    duplex: z.boolean().optional(),
    paperSizes: z.array(z.string()).default([])
  }).default({ paperSizes: [] })
});

export const appSettingsSchema = z.object({
  selectedPrinterId: z.string().nullable(),
  server: z.object({
    host: z.string(),
    port: z.number().int().min(1024).max(65535),
    lanAccess: z.boolean()
  }),
  theme: z.enum(["system", "dark", "light"]),
  launchAtStartup: z.boolean(),
  officePreview: z.boolean(),
  updatedAt: z.string()
});

export type PrinterInfo = z.infer<typeof printerInfoSchema>;
export type AppSettings = z.infer<typeof appSettingsSchema>;
export type ThemeMode = AppSettings["theme"];

export type DependencyStatus = {
  libreOffice: { available: boolean; version?: string; path?: string; installUrl?: string; installCommand?: string };
  encryptionDetector: { available: boolean; provider: string };
};

export type JobStatus = "uploaded" | "validating" | "blocked" | "ready" | "queued" | "printing" | "succeeded" | "failed" | "cancelled";

export type PrintJob = {
  id: string;
  fileName: string;
  mimeType: string;
  status: JobStatus;
  printerId: string | null;
  printOptions?: PrintOptions;
  error?: string;
  createdAt: string;
  updatedAt: string;
};

export const printOptionsSchema = z.object({
  copies: z.number().int().min(1).max(99).default(1),
  pageRange: z.string().max(100).optional(),
  orientation: z.enum(["portrait", "landscape"]).default("portrait"),
  color: z.enum(["color", "grayscale"]).default("color"),
  duplex: z.enum(["none", "long-edge", "short-edge"]).default("none"),
  paperSize: z.string().max(32).default("A4")
});

export type PrintOptions = z.infer<typeof printOptionsSchema>;

export const apiError = (code: string, message: string) => ({ error: { code, message } });
