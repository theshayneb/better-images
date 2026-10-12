import { App, TFile } from "obsidian";
import { shouldManage } from "../core/filters";
import { ensureRecordHash } from "../core/hash";
import { parentPath } from "../core/paths";
import { resolveDestination } from "../core/resolve";
import { log } from "../log";
import { Store } from "../store/store";

/**
 * Paths we just wrote to via renameFile — lets the vault 'rename' handler
 * recognize our own moves and avoid reprocessing them, distinct from a
 * user-initiated move of a managed attachment.
 */
export class InternalMoveTracker {
  private readonly paths = new Set<string>();

  mark(path: string): void {
    this.paths.add(path);
  }

  has(path: string): boolean {
    return this.paths.has(path);
  }

  consume(path: string): boolean {
    const had = this.paths.has(path);
    this.paths.delete(path);
    return had;
  }
}

export interface ProcessOutcome {
  action: "skip" | "moved" | "filtered" | "missing";
  from?: string;
  to?: string;
}

export async function processAttachment(app: App, store: Store, file: TFile, note: TFile | null, internalMoves: InternalMoveTracker): Promise<ProcessOutcome> {
  const record = store.get(file.path);
  if (!record) return { action: "missing" };

  const parent = file.parent?.path ?? "";
  if (!shouldManage(record.extension, parent, store.settings) || store.isProtected(file.path)) {
    return { action: "filtered" };
  }

  if (await ensureRecordHash(app, file, record, store.settings)) {
    store.touch(file.path);
  }

  const result = await resolveDestination(app, file, record, note, store.settings);
  if (result.action === "skip") {
    return { action: "skip" };
  }

  // Capture before the move: renameFile mutates `file` in place, so
  // `file.path` reflects the NEW path by the time the await resolves.
  const fromPath = file.path;
  const oldParent = parentPath(fromPath);

  await ensureFolder(app, parentPath(result.destPath));

  internalMoves.mark(result.destPath);
  try {
    await app.fileManager.renameFile(file, result.destPath);
  } finally {
    internalMoves.consume(result.destPath);
  }

  record.dedupe = result.dedupe;
  record.applied = {
    at: Date.now(),
    rootMode: store.settings.rootMode,
    root: store.settings.root,
    pathTemplate: store.settings.pathTemplate,
    formatTemplate: store.settings.formatTemplate,
    dateFormat: store.settings.dateFormat,
    resultPath: result.destPath,
  };
  store.rekey(fromPath, result.destPath);
  store.set(result.destPath, record);

  if (store.settings.cleanEmptyFolders) {
    await cleanupIfEmpty(app, oldParent);
  }

  log.debug(`moved ${fromPath} -> ${result.destPath}`);

  return { action: "moved", from: fromPath, to: result.destPath };
}

export async function ensureFolder(app: App, folderPath: string): Promise<void> {
  if (!folderPath) return;
  const existing = app.vault.getAbstractFileByPath(folderPath);
  if (existing) return;
  try {
    await app.vault.createFolder(folderPath);
  } catch {
    // Race: another concurrent move already created it — fine.
  }
}

export async function cleanupIfEmpty(app: App, folderPath: string): Promise<void> {
  if (!folderPath) return;
  const folder = app.vault.getAbstractFileByPath(folderPath);
  if (!folder) return;
  const children = (folder as unknown as { children?: unknown[] }).children;
  if (!Array.isArray(children) || children.length > 0) return;
  try {
    // Recursive, not just "empty": Obsidian hides dotfiles (e.g. macOS's
    // .DS_Store) from `children`, so the folder can look empty to us while
    // a non-recursive rmdir still fails against the real filesystem.
    await app.vault.adapter.rmdir(folder.path, true);
  } catch (err) {
    log.error(`failed to remove empty folder ${folder.path}`, err);
  }
}
