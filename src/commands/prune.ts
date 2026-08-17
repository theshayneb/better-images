import { App, TFile } from "obsidian";
import { log } from "../log";
import { Store } from "../store/store";

/**
 * Manual sweep on top of the automatic cleanup already done in
 * vault.on('delete') — a safety net for records that went stale some other
 * way (e.g. the vault was edited while Obsidian wasn't running).
 */
export function pruneCommand(app: App, store: Store): () => void {
  return () => {
    let pruned = 0;
    for (const [path] of store.allEntries()) {
      const file = app.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile)) {
        store.delete(path);
        pruned++;
      }
    }
    log.notice(pruned > 0 ? `Pruned ${pruned} orphaned record${pruned === 1 ? "" : "s"}.` : "No orphaned records found.");
  };
}
