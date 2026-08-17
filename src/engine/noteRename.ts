import { App, TFile } from "obsidian";
import { log } from "../log";
import { Store } from "../store/store";
import { InternalMoveTracker, processAttachment } from "./organizer";

export async function handleNoteRename(app: App, store: Store, note: TFile, oldNotePath: string, internalMoves: InternalMoveTracker): Promise<void> {
  if (!store.settings.autoRenameOnNoteRename) return;
  const paths = store.pathsForNote(oldNotePath);
  if (paths.length === 0) return;

  let moved = 0;
  for (const path of paths) {
    store.setNotePath(path, note.path);
    const file = app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) continue;
    const outcome = await processAttachment(app, store, file, note, internalMoves);
    if (outcome.action === "moved") moved++;
  }

  if (moved > 0) {
    log.notice(`Moved ${moved} attachment${moved === 1 ? "" : "s"} for renamed note`);
  }
}
