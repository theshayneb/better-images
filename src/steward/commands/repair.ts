import { App } from "obsidian";
import { effectiveTemplates } from "../core/filters";
import { recognizeAppliedName } from "../core/recognize";
import { InternalMoveTracker } from "../engine/organizer";
import { log } from "../log";
import { Store } from "../store/store";
import { reapplyRules } from "./reapply";

/**
 * Fixes attachments whose frozen `originalName` already contains one or
 * more of this plugin's own date stamps — permanent damage left behind by
 * the cross-device naming race (see recognize.ts): a device that never saw
 * a file's true first sighting would adopt its already-stamped name as
 * fresh and stamp another date on top. recognizeAppliedName's onCreate
 * check (added alongside this command) stops new occurrences, but it only
 * runs when a file is first sighted — it can't retroactively fix a name
 * that's already frozen into an existing record. This unstamps every
 * affected record's originalName/importedAt in place, then hands off to
 * the regular reapplyRules preview/confirm flow to move the files.
 */
export function repairStampedNamesCommand(app: App, store: Store, internalMoves: InternalMoveTracker): () => Promise<void> {
  return async () => {
    const repaired: string[] = [];

    for (const [path, record] of store.allEntries()) {
      const { formatTemplate } = effectiveTemplates(record.extension, store.settings);
      const recognized = recognizeAppliedName(record.originalName, formatTemplate, store.settings.dateFormat);
      if (!recognized) continue;

      record.originalName = recognized.originalName;
      if (recognized.importedAt !== null) record.importedAt = recognized.importedAt;
      store.touch(path);
      repaired.push(path);
    }

    if (repaired.length === 0) {
      log.notice("No stamped names found to repair.");
      return;
    }

    await reapplyRules(app, store, repaired, internalMoves, `Repair ${repaired.length} stamped attachment name${repaired.length === 1 ? "" : "s"}`);
  };
}
