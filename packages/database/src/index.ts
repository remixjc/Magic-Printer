import Database from "better-sqlite3";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { AppSettings, PrintJob } from "@magic-printer/shared";

const defaultSettings = (port = 17890): AppSettings => ({
  selectedPrinterId: null,
  server: { host: "127.0.0.1", port, lanAccess: false },
  theme: "system",
  launchAtStartup: false,
  officePreview: false,
  updatedAt: new Date().toISOString()
});

export class LocalDatabase {
  readonly db: Database.Database;

  constructor(filePath: string) {
    this.db = new Database(filePath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS print_jobs (
        id TEXT PRIMARY KEY, file_name TEXT NOT NULL, mime_type TEXT NOT NULL, status TEXT NOT NULL,
        printer_id TEXT, print_options TEXT, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
    `);
    try { this.db.exec("ALTER TABLE print_jobs ADD COLUMN print_options TEXT"); } catch { /* already migrated */ }
  }

  static async open(dataDir: string): Promise<LocalDatabase> {
    await mkdir(dirname(dataDir), { recursive: true });
    return new LocalDatabase(dataDir);
  }

  readSettings(): AppSettings {
    const row = this.db.prepare("SELECT value FROM app_settings WHERE key = 'app'").get() as { value?: string } | undefined;
    if (!row?.value) return defaultSettings();
    try { return JSON.parse(row.value) as AppSettings; } catch { return defaultSettings(); }
  }

  writeSettings(settings: AppSettings): void {
    this.db.prepare("INSERT INTO app_settings(key, value, updated_at) VALUES('app', ?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at")
      .run(JSON.stringify(settings), settings.updatedAt);
  }

  listJobs(): PrintJob[] {
    const rows = this.db.prepare("SELECT id, file_name as fileName, mime_type as mimeType, status, printer_id as printerId, print_options as printOptionsJson, error, created_at as createdAt, updated_at as updatedAt FROM print_jobs ORDER BY created_at DESC").all() as Array<PrintJob & { printOptionsJson?: string }>;
    return rows.map(({ printOptionsJson, ...job }) => printOptionsJson ? { ...job, printOptions: JSON.parse(printOptionsJson) } : job);
  }

  saveJob(job: PrintJob): void {
    this.db.prepare("INSERT OR REPLACE INTO print_jobs(id,file_name,mime_type,status,printer_id,print_options,error,created_at,updated_at) VALUES (@id,@fileName,@mimeType,@status,@printerId,@printOptions,@error,@createdAt,@updatedAt)").run({
      id: job.id,
      fileName: job.fileName,
      mimeType: job.mimeType,
      status: job.status,
      printerId: job.printerId,
      printOptions: job.printOptions ? JSON.stringify(job.printOptions) : null,
      error: job.error ?? null,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt
    });
  }

  deleteJob(id: string): boolean { return this.db.prepare("DELETE FROM print_jobs WHERE id = ?").run(id).changes > 0; }

  deleteExpiredJobs(cutoffIso: string): string[] {
    const rows = this.db.prepare("SELECT id FROM print_jobs WHERE updated_at < ?").all(cutoffIso) as Array<{ id: string }>;
    const remove = this.db.transaction((ids: string[]) => {
      const statement = this.db.prepare("DELETE FROM print_jobs WHERE id = ?");
      for (const id of ids) statement.run(id);
    });
    const ids = rows.map((row) => row.id);
    remove(ids);
    return ids;
  }

  close(): void { this.db.close(); }
}
