import { App, TFile, TFolder } from "obsidian";
import { referencedAttachments } from "../core/links";
import { notesUnderFolder } from "../core/scope";
import { InternalMoveTracker } from "../engine/organizer";
import { log } from "../log";
import { Store } from "../store/store";
import { AttachmentRecord } from "../store/types";
import { reapplyRules } from "./reapply";

/**
 * Referenced attachments with no owning note yet - either never tracked at
 * all, or tracked (e.g. auto-claimed on creation, then left orphaned when no
 * note referenced it in time) but with `notePath` still null.
 */
function collectAdoptable(app: App, store: Store, notes: TFile[]): Map<string, string> {
  const found = new Map<string, string>(); // attachPath -> notePath (first reference wins)
  for (const note of notes) {
    const cache = app.metadataCache.getFileCache(note);
    if (!cache) continue;
    for (const attachPath of referencedAttachments(app, note, cache, store.settings)) {
      if (store.get(attachPath)?.notePath) continue;
      if (store.isProtected(attachPath)) continue;
      if (!found.has(attachPath)) found.set(attachPath, note.path);
    }
  }
  return found;
}

/**
 * Assigns the owning note to every referenced-but-ownerless attachment -
 * registering a fresh record (its `originalName` is its current basename,
 * since it has never been touched by any rule yet) for ones never tracked
 * before, or just claiming the existing record for ones already tracked but
 * orphaned - then hands off to reapplyRules for the actual preview/move.
 * This is how pre-existing damage like the 40 untouched Bürgergeld PDFs gets
 * fixed, on explicit request rather than automatically.
 */
async function adopt(app: App, store: Store, notes: TFile[], internalMoves: InternalMoveTracker, titleText: string): Promise<void> {
  const adoptable = collectAdoptable(app, store, notes);
  if (adoptable.size === 0) {
    log.notice("No unmanaged attachments found.");
    return;
  }

  for (const [attachPath, notePath] of adoptable) {
    if (store.has(attachPath)) {
      store.setNotePath(attachPath, notePath);
      continue;
    }
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

  await reapplyRules(app, store, [...adoptable.keys()], internalMoves, titleText);
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

export function adoptFolderCommand(app: App, store: Store, internalMoves: InternalMoveTracker): (folder: TFolder) => Promise<void> {
  return async (folder) => {
    await adopt(app, store, notesUnderFolder(app, folder), internalMoves, `Adopt unmanaged attachments in "${folder.path || "/"}"`);
  };
}
