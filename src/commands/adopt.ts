import { App, TFile } from "obsidian";
import { referencedAttachments } from "../core/links";
import { InternalMoveTracker } from "../engine/organizer";
import { log } from "../log";
import { Store } from "../store/store";
import { AttachmentRecord } from "../store/types";
import { reapplyRules } from "./reapply";

function collectUnmanaged(app: App, store: Store, notes: TFile[]): Map<string, string> {
  const found = new Map<string, string>(); // attachPath -> notePath (first reference wins)
  for (const note of notes) {
    const cache = app.metadataCache.getFileCache(note);
    if (!cache) continue;
    for (const attachPath of referencedAttachments(app, note, cache)) {
      if (store.has(attachPath)) continue;
      if (!found.has(attachPath)) found.set(attachPath, note.path);
    }
  }
  return found;
}

/**
 * Registers a record for every referenced-but-untracked attachment (its
 * `originalName` is its current basename, since it has never been touched
 * by any rule yet), then hands off to reapplyRules for the actual
 * preview/move — this is how pre-existing damage like the 40 untouched
 * Bürgergeld PDFs gets fixed, on explicit request rather than automatically.
 */
async function adopt(app: App, store: Store, notes: TFile[], internalMoves: InternalMoveTracker, titleText: string): Promise<void> {
  const unmanaged = collectUnmanaged(app, store, notes);
  if (unmanaged.size === 0) {
    log.notice("No unmanaged attachments found.");
    return;
  }

  for (const [attachPath, notePath] of unmanaged) {
    const file = app.vault.getAbstractFileByPath(attachPath);
    if (!(file instanceof TFile)) continue;
    const record: AttachmentRecord = {
      v: 1,
      originalName: file.basename,
      extension: file.extension,
      importedAt: Date.now(),
      notePath,
      md5: null,
      md5For: null,
      dedupe: 0,
      applied: null,
      managed: true,
      source: "adopted",
    };
    store.set(attachPath, record);
  }

  await reapplyRules(app, store, [...unmanaged.keys()], internalMoves, titleText);
}

export function adoptActiveNoteCommand(app: App, store: Store, internalMoves: InternalMoveTracker): () => Promise<void> {
  return async () => {
    const note = app.workspace.getActiveFile();
    if (!note || note.extension !== "md") {
      log.notice("No active note open.");
      return;
    }
    await adopt(app, store, [note], internalMoves, `Adopt unmanaged attachments in "${note.basename}"`);
  };
}

export function adoptVaultCommand(app: App, store: Store, internalMoves: InternalMoveTracker): () => Promise<void> {
  return async () => {
    await adopt(app, store, app.vault.getMarkdownFiles(), internalMoves, "Adopt unmanaged attachments in the whole vault");
  };
}
