import { App, TFile } from "obsidian";
import { shouldManage } from "../core/filters";
import { ensureRecordHash } from "../core/hash";
import { resolveDestination } from "../core/resolve";
import { InternalMoveTracker, processAttachment } from "../engine/organizer";
import { log } from "../log";
import { Store } from "../store/store";
import { DiffItem, PreviewModal, PreviewSummary } from "../ui/previewModal";

async function buildSummary(app: App, store: Store, paths: string[]): Promise<{ summary: PreviewSummary; movable: string[] }> {
  const moves: DiffItem[] = [];
  const movable: string[] = [];
  let skipped = 0;
  let filtered = 0;

  for (const path of paths) {
    const file = app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) continue;
    const record = store.get(path);
    if (!record) continue;

    const parent = file.parent?.path ?? "";
    if (!shouldManage(record.extension, parent, store.settings)) {
      filtered++;
      continue;
    }

    if (await ensureRecordHash(app, file, record, store.settings)) {
      store.scheduleSave();
    }

    const note = record.notePath ? app.vault.getAbstractFileByPath(record.notePath) : null;
    const result = await resolveDestination(app, file, record, note instanceof TFile ? note : null, store.settings);
    if (result.action === "skip") {
      skipped++;
    } else {
      moves.push({ from: path, to: result.destPath });
      movable.push(path);
    }
  }

  return { summary: { moves, skipped, filtered }, movable };
}

async function applyMoves(app: App, store: Store, paths: string[], internalMoves: InternalMoveTracker): Promise<number> {
  let moved = 0;
  for (const path of paths) {
    const file = app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) continue;
    const record = store.get(path);
    if (!record) continue;
    const note = record.notePath ? app.vault.getAbstractFileByPath(record.notePath) : null;
    const outcome = await processAttachment(app, store, file, note instanceof TFile ? note : null, internalMoves);
    if (outcome.action === "moved") moved++;
  }
  return moved;
}

/**
 * Recomputes the destination of every given (already-managed) attachment
 * from its frozen original name + current settings, previews the diff, and
 * moves on confirmation. Idempotent by construction: a second run over the
 * same paths with no settings change reports 0 moves.
 */
export async function reapplyRules(app: App, store: Store, paths: string[], internalMoves: InternalMoveTracker, titleText: string): Promise<void> {
  if (paths.length === 0) {
    log.notice("No managed attachments found.");
    return;
  }

  const { summary, movable } = await buildSummary(app, store, paths);
  const confirmed = await new PreviewModal(app, titleText, summary).waitForChoice();
  if (!confirmed) return;

  const moved = await applyMoves(app, store, movable, internalMoves);
  log.notice(`Reapplied rules: ${moved} moved, ${summary.skipped} already correct.`);
}

export function reapplyAllCommand(app: App, store: Store, internalMoves: InternalMoveTracker): () => Promise<void> {
  return () =>
    reapplyRules(
      app,
      store,
      store.allEntries().map(([path]) => path),
      internalMoves,
      "Reapply rules to all managed attachments"
    );
}

export function reapplyActiveNoteCommand(app: App, store: Store, internalMoves: InternalMoveTracker): () => Promise<void> {
  return async () => {
    const note = app.workspace.getActiveFile();
    if (!note) {
      log.notice("No active note open.");
      return;
    }
    await reapplyRules(app, store, store.pathsForNote(note.path), internalMoves, `Reapply rules for "${note.basename}"`);
  };
}
