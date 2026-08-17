import { App, CachedMetadata, EventRef, TAbstractFile, TFile } from "obsidian";
import { shouldManage } from "../core/filters";
import { referencedAttachments } from "../core/links";
import { parentPath } from "../core/paths";
import { log } from "../log";
import { Store } from "../store/store";
import { AttachmentRecord } from "../store/types";
import { handleNoteRename } from "./noteRename";
import { cleanupIfEmpty, InternalMoveTracker, processAttachment } from "./organizer";

const PROCESS_DEBOUNCE_MS = 200;

/**
 * Wires vault/metadata-cache events into the organize pipeline. Must be
 * constructed and `register()`-ed only inside `workspace.onLayoutReady()` —
 * 'create' fires for every pre-existing file on vault load otherwise.
 */
export class Watcher {
  private readonly pending = new Map<string, number>(); // attachPath -> seenAt
  private readonly settleTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly claims = new Map<string, string>(); // attachPath -> notePath
  private readonly toProcess = new Set<string>();
  readonly internalMoves = new InternalMoveTracker();
  private processTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly app: App, private readonly store: Store) {}

  register(registerEvent: (ref: EventRef) => void): void {
    registerEvent(this.app.vault.on("create", this.onCreate));
    registerEvent(this.app.metadataCache.on("changed", this.onMetadataChanged));
    registerEvent(this.app.vault.on("rename", this.onRename));
    registerEvent(this.app.vault.on("delete", this.onDelete));
  }

  private onCreate = (file: TAbstractFile): void => {
    if (!(file instanceof TFile)) return;
    if (this.store.has(file.path)) return;
    if (!shouldManage(file.extension, file.parent?.path ?? "", this.store.settings)) return;

    // Capture the true original name at the very first sighting, before any
    // move can occur — this is what makes reapplying rules idempotent later.
    const record: AttachmentRecord = {
      v: 1,
      originalName: file.basename,
      extension: file.extension,
      importedAt: Date.now(),
      notePath: null,
      md5: null,
      md5For: null,
      dedupe: 0,
      applied: null,
      managed: true,
      source: "created",
    };
    this.store.set(file.path, record);
    this.pending.set(file.path, Date.now());

    // The owning note may already exist and reference this attachment (note
    // created first, e.g. an Apple Notes export with links already inline).
    const owner = this.findOwner(file.path);
    if (owner) {
      this.claim(file.path, owner);
    } else {
      this.scheduleSettle(file.path);
    }
  };

  private onMetadataChanged = (note: TFile, _data: string, cache: CachedMetadata): void => {
    if (note.extension !== "md" || this.pending.size === 0) return;
    for (const attachPath of referencedAttachments(this.app, note, cache)) {
      if (this.pending.has(attachPath)) {
        this.claim(attachPath, note.path);
      }
    }
  };

  private onRename = (file: TAbstractFile, oldPath: string): void => {
    if (this.internalMoves.has(oldPath) || this.internalMoves.has(file.path)) {
      // Our own move — organizer.ts already rekeys the store itself.
      return;
    }
    if (!(file instanceof TFile)) return;

    if (this.store.has(oldPath)) {
      this.store.rekey(oldPath, file.path);
      return;
    }

    if (file.extension === "md") {
      void handleNoteRename(this.app, this.store, file, oldPath, this.internalMoves).catch((err) => log.error("note rename handling failed", err));
    }
  };

  private onDelete = (file: TAbstractFile): void => {
    if (!(file instanceof TFile) || !this.store.has(file.path)) return;
    const parent = parentPath(file.path);
    this.store.delete(file.path);
    if (this.store.settings.cleanEmptyFolders) {
      void cleanupIfEmpty(this.app, parent);
    }
  };

  private findOwner(attachPath: string): string | null {
    const resolved = this.app.metadataCache.resolvedLinks;
    for (const sourcePath in resolved) {
      if (resolved[sourcePath][attachPath]) return sourcePath;
    }
    return null;
  }

  private claim(attachPath: string, notePath: string): void {
    if (!this.pending.has(attachPath)) return;
    this.pending.delete(attachPath);
    this.clearSettle(attachPath);
    this.claims.set(attachPath, notePath);
    this.toProcess.add(attachPath);
    this.scheduleProcess();
  }

  private scheduleSettle(attachPath: string): void {
    const timer = setTimeout(() => {
      this.settleTimers.delete(attachPath);
      if (!this.pending.has(attachPath)) return; // claimed meanwhile
      const owner = this.findOwner(attachPath);
      if (owner) {
        this.claim(attachPath, owner);
      } else {
        // Legitimate orphan: no note references it (yet). Leave it managed
        // but unprocessed — the "adopt" commands handle these explicitly.
        this.pending.delete(attachPath);
        log.debug(`no owner found for ${attachPath}, leaving unprocessed`);
      }
    }, this.store.settings.claimGraceMs);
    this.settleTimers.set(attachPath, timer);
  }

  private clearSettle(attachPath: string): void {
    const timer = this.settleTimers.get(attachPath);
    if (timer) {
      clearTimeout(timer);
      this.settleTimers.delete(attachPath);
    }
  }

  private scheduleProcess(): void {
    if (this.processTimer) return;
    this.processTimer = setTimeout(() => {
      this.processTimer = null;
      void this.drainQueue();
    }, PROCESS_DEBOUNCE_MS);
  }

  private async drainQueue(): Promise<void> {
    const batch = [...this.toProcess];
    this.toProcess.clear();
    let moved = 0;

    for (const attachPath of batch) {
      const notePath = this.claims.get(attachPath);
      this.claims.delete(attachPath);

      const file = this.app.vault.getAbstractFileByPath(attachPath);
      if (!(file instanceof TFile)) continue;
      if (!this.store.has(attachPath)) continue;

      if (notePath) this.store.setNotePath(attachPath, notePath);
      const noteFile = notePath ? this.app.vault.getAbstractFileByPath(notePath) : null;

      const outcome = await processAttachment(this.app, this.store, file, noteFile instanceof TFile ? noteFile : null, this.internalMoves);
      if (outcome.action === "moved") moved++;
    }

    if (moved > 0) {
      log.notice(`Organized ${moved} attachment${moved === 1 ? "" : "s"}`);
    }
  }
}
