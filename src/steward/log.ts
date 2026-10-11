import { Notice } from "obsidian";
import type { StewardHost } from "./host";
import { ensureAdapterFolder, pluginDataDir } from "./store/shards";

const PREFIX = "[better-images]";
const LOG_FILE_NAME = "debug.log";
const FLUSH_DEBOUNCE_MS = 1000;
/** Oldest lines get trimmed once the file passes this size, so an idle debug session left on for days can't grow it without bound. */
const MAX_LOG_FILE_CHARS = 1_000_000;

let debugEnabled = false;
let notificationsEnabled = true;
let fileLoggingEnabled = false;
let owner: StewardHost | null = null;

let pending: string[] = [];
let flushTimer: number | null = null;

export function configureLogging(opts: { debug: boolean; notifications: boolean; logToFile: boolean; plugin: StewardHost }): void {
  debugEnabled = opts.debug;
  notificationsEnabled = opts.notifications;
  // File logging is a sub-feature of debug logging, never independent of it — see settings/tab.ts.
  fileLoggingEnabled = opts.debug && opts.logToFile;
  owner = opts.plugin;
}

function logFilePath(plugin: StewardHost): string {
  return `${pluginDataDir(plugin)}/${LOG_FILE_NAME}`;
}

function formatArg(arg: unknown): string {
  if (typeof arg === "string") return arg;
  if (arg instanceof Error) return arg.stack ?? arg.message;
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

function queue(level: string, args: unknown[]): void {
  if (!fileLoggingEnabled) return;
  pending.push(`${new Date().toISOString()} [${level}] ${args.map(formatArg).join(" ")}`);
  if (flushTimer) return;
  flushTimer = window.setTimeout(() => {
    flushTimer = null;
    void flushLog();
  }, FLUSH_DEBOUNCE_MS);
}

/** Writes any buffered lines out now. Safe to call with nothing pending (no-op) or with file logging off (buffer is empty in that case anyway). */
export async function flushLog(): Promise<void> {
  if (flushTimer) {
    window.clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (!owner || pending.length === 0) return;
  const plugin = owner;
  const addition = `${pending.join("\n")}\n`;
  pending = [];
  const path = logFilePath(plugin);
  const adapter = plugin.app.vault.adapter;
  try {
    await ensureAdapterFolder(plugin.app, pluginDataDir(plugin));
    const existing = (await adapter.exists(path)) ? await adapter.read(path) : "";
    let combined = existing + addition;
    if (combined.length > MAX_LOG_FILE_CHARS) combined = combined.slice(combined.length - MAX_LOG_FILE_CHARS);
    await adapter.write(path, combined);
  } catch (err) {
    console.error(PREFIX, "failed to write debug log file", err);
  }
}

/** Full current content of the debug log file, flushing any pending lines first — or null if nothing's ever been recorded. */
export async function readLogFile(plugin: StewardHost): Promise<string | null> {
  await flushLog();
  const path = logFilePath(plugin);
  const adapter = plugin.app.vault.adapter;
  if (!(await adapter.exists(path))) return null;
  return adapter.read(path);
}

export const log = {
  debug(...args: unknown[]): void {
    if (debugEnabled) console.debug(PREFIX, ...args);
    queue("DEBUG", args);
  },
  warn(...args: unknown[]): void {
    console.warn(PREFIX, ...args);
    queue("WARN", args);
  },
  error(...args: unknown[]): void {
    console.error(PREFIX, ...args);
    queue("ERROR", args);
  },
  notice(message: string): void {
    if (notificationsEnabled) new Notice(`${PREFIX} ${message}`);
  },
};
