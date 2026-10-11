import { App, TFolder } from "obsidian";
import { isExcludedCoreExtension } from "../core/filters";
import { allLinkedPaths } from "../core/links";
import { filesUnderFolder } from "../core/scope";
import { log } from "../log";
import { Settings } from "../settings/types";
import { OrphanReportModal } from "../ui/orphanReportModal";

/**
 * Diagnostic sweep for a folder: files that exist on disk but that no note
 * or canvas anywhere in the vault resolves a link/embed to. This is the
 * class of damage a broken bulk import (e.g. an Apple Notes export where a
 * link didn't parse) leaves behind — distinct from "unmanaged", which still
 * requires a live reference to a file for Adopt to find it.
 */
export function findOrphansCommand(app: App, settings: Settings): (folder: TFolder) => void {
  return (folder) => {
    const linked = allLinkedPaths(app);
    const orphans = filesUnderFolder(app, folder).filter((f) => !isExcludedCoreExtension(f.extension, settings) && !linked.has(f.path));

    if (orphans.length === 0) {
      log.notice(`No unlinked attachments found in "${folder.path || "/"}".`);
      return;
    }
    new OrphanReportModal(app, folder.path || "/", orphans).open();
  };
}
