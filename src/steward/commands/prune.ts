import { App, TFile, TFolder } from "obsidian";
import { isUnderFolder } from "../core/scope";
import { log } from "../log";
import { Store } from "../store/store";

/**
 * Manual sweep on top of the automatic cleanup already done in
 * vault.on('delete') — a safety net for records that went stale some other
 * way (e.g. the vault was edited while Obsidian wasn't running).
 */
export function pruneCommand(app: App, store: Store): () => void {
  return () => pruneWhere(app, store, () => true);
}

/** Same sweep, but limited to records whose (last known) path sits under `folder`. */
export function pruneFolderCommand(app: App, store: Store): (folder: TFolder) => void {
  return (folder) => pruneWhere(app, store, (path) => isUnderFolder(path, folder), folder.path || "/");
}

function pruneWhere(app: App, store: Store, matches: (path: string) => boolean, scopeLabel?: string): void {
  let pruned = 0;
  for (const [path] of store.allEntries()) {
    if (!matches(path)) continue;
    const file = app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      store.delete(path);
      pruned++;
    }
  }
  const scope = scopeLabel ? ` under "${scopeLabel}"` : "";
  log.notice(pruned > 0 ? `Pruned ${pruned} orphaned record${pruned === 1 ? "" : "s"}${scope}.` : `No orphaned records found${scope}.`);
}
