import { App, CachedMetadata, EventRef, TAbstractFile, TFile } from "obsidian";
import { effectiveTemplates, shouldManage } from "../core/filters";
import { referencedAttachments } from "../core/links";
import { parentPath } from "../core/paths";
import { recognizeAppliedName } from "../core/recognize";
import { log } from "../log";
import { Store } from "../store/store";
import { AttachmentRecord } from "../store/types";
import { handleNoteRename } from "./noteRename";
import { cleanupIfEmpty, InternalMoveTracker, processAttachment } from "./organizer";

const PROCESS_DEBOUNCE_MS = 200;

/**
 * How long a tracked attachment's record survives after its file disappears,
 * before being treated as a real deletion. Covers two cases that surface as
 * delete+create instead of a clean rename: another plugin replacing the file
 * in place (e.g. format conversion changes the extension), and iCloud/mobile
 * sync delivering a rename made on another device as two separate events.
 */
const DELETE_GRACE_MS = 3000;

/**
 * Wires vault/metadata-cache events into the organize pipeline. Must be
 * constructed and `register()`-ed only inside `workspace.onLayoutReady()` —
 * 'create' fires for every pre-existing file on vault load otherwise.
 */
export class Watcher {
  private readonly pending = new Map<string, number>(); // attachPath -> seenAt
  private readonly settleTimers = new Map<string, number>();
  private readonly claims = new Map<string, string>(); // attachPath -> notePath
  private readonly toProcess = new Set<string>();
  private readonly pendingDeletes = new Map<string, number>(); // attachPath -> grace timer
  readonly internalMoves = new InternalMoveTracker();
  private processTimer: number | null = null;

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
    if (this.store.isProtected(file.path)) return;
    if (!shouldManage(file.extension, file.parent?.path ?? "", this.store.settings)) return;

    if (this.claimReplacement(file)) return;

    // No local record and no matching tombstone — but this device may
    // simply never have witnessed this file's true first sighting (sync
    // can deliver an already-renamed file before the record explaining it,
    // or before any record at all — see the note-per-device race). Check
    // whether the name already looks like our own output before trusting
    // it as fresh, so we recover the true original instead of stamping a
    // new date on top of one that's already there.
    const { formatTemplate } = effectiveTemplates(file.extension, this.store.settings);
    const recognized = recognizeAppliedName(file.basename, formatTemplate, this.store.settings.dateFormat);
    if (recognized) {
      log.debug(`${file.path} already looks applied, recovered original name "${recognized.originalName}"`);
    }

    // Capture the true original name at the very first sighting, before any
    // move can occur — this is what makes reapplying rules idempotent later.
    const record: AttachmentRecord = {
      v: 1,
      originalName: recognized?.originalName ?? file.basename,
      extension: file.extension,
      importedAt: recognized?.importedAt ?? Date.now(),
      notePath: null,
      md5: null,
      md5For: null,
      dedupe: 0,
      applied: null,
      managed: true,
      source: recognized ? "adopted" : "created",
    };
    this.store.set(file.path, record);
    this.trackForOwnership(file.path, null);
  };

  /**
   * A file just appeared where a tracked attachment was, moments ago,
   * deleted from the same folder — most likely the same logical attachment,
   * replaced in place rather than cleanly renamed (a conversion plugin
   * rewriting it under a new extension, or another device's rename arriving
   * over iCloud as separate delete+create events). Carries the frozen
   * identity (originalName/importedAt/notePath) over to the new path instead
   * of starting a fresh record, which is what keeps the eventual filename
   * from growing a new date prefix on every such replace.
   */
  private claimReplacement(file: TFile): boolean {
    const parent = file.parent?.path ?? "";
    for (const oldPath of this.pendingDeletes.keys()) {
      if (parentPath(oldPath) !== parent) continue;
      const record = this.store.get(oldPath);
      if (!record) continue;

      this.cancelPendingDelete(oldPath);
      this.store.rekey(oldPath, file.path);
      // Content very likely changed (that's usually why the replace
      // happened at all) — drop the stale hash so it's recomputed on demand.
      record.extension = file.extension;
      record.md5 = null;
      record.md5For = null;
      this.store.scheduleSave();

      log.debug(`treating ${file.path} as a replacement of ${oldPath}, not a new attachment`);
      this.trackForOwnership(file.path, record.notePath);
      return true;
    }
    return false;
  }

  /** Shared tail of onCreate/claimReplacement: hand the path to a known owner, or go find one. */
  private trackForOwnership(attachPath: string, knownNotePath: string | null): void {
    if (knownNotePath) {
      this.claim(attachPath, knownNotePath);
      return;
    }
    this.pending.set(attachPath, Date.now());
    // The owning note may already exist and reference this attachment (note
    // created first, e.g. an Apple Notes export with links already inline).
    const owner = this.findOwner(attachPath);
    if (owner) {
      this.claim(attachPath, owner);
    } else {
      this.scheduleSettle(attachPath);
    }
  }

  private cancelPendingDelete(path: string): void {
    const timer = this.pendingDeletes.get(path);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      this.pendingDeletes.delete(path);
    }
  }

  private onMetadataChanged = (note: TFile, _data: string, cache: CachedMetadata): void => {
    if (note.extension !== "md") return;
    for (const attachPath of referencedAttachments(this.app, note, cache, this.store.settings)) {
      if (this.pending.has(attachPath) || this.isOwnerlessOrphan(attachPath)) {
        this.claim(attachPath, note.path);
      }
    }
  };

  // A file this Watcher already tracks (so `onCreate` isn't going to see it
  // again) but never found an owner for in time — e.g. it sat unlinked in
  // the vault and only got referenced by a note well after `claimGraceMs`
  // expired. Re-checked on every metadata change so linking it later still
  // gets it organized, not just a fresh explicit "adopt" run.
  private isOwnerlessOrphan(attachPath: string): boolean {
    return this.store.get(attachPath)?.notePath === null;
  }

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
    const path = file.path;
    // Don't drop the record immediately: a matching `create` in the same
    // folder within the grace window means this was a replace, not a real
    // deletion (see claimReplacement). Only finalize if nothing claims it.
    const timer = window.setTimeout(() => {
      this.pendingDeletes.delete(path);
      const parent = parentPath(path);
      this.store.delete(path);
      if (this.store.settings.cleanEmptyFolders) {
        void cleanupIfEmpty(this.app, parent);
      }
    }, DELETE_GRACE_MS);
    this.pendingDeletes.set(path, timer);
  };

  private findOwner(attachPath: string): string | null {
    const resolved = this.app.metadataCache.resolvedLinks;
    for (const sourcePath in resolved) {
      if (resolved[sourcePath][attachPath]) return sourcePath;
    }
    return null;
  }

  private claim(attachPath: string, notePath: string): void {
    if (this.pending.has(attachPath)) {
      this.pending.delete(attachPath);
      this.clearSettle(attachPath);
    }
    this.claims.set(attachPath, notePath);
    this.toProcess.add(attachPath);
    this.scheduleProcess();
  }

  private scheduleSettle(attachPath: string): void {
    const timer = window.setTimeout(() => {
      this.settleTimers.delete(attachPath);
      if (!this.pending.has(attachPath)) return; // claimed meanwhile
      const owner = this.findOwner(attachPath);
      if (owner) {
        this.claim(attachPath, owner);
      } else {
        // Legitimate orphan: no note references it (yet). Leave it managed
        // but unprocessed — `onMetadataChanged` claims it the moment some
        // note's links change to reference it, and the "adopt" commands
        // handle the case where that never happens (e.g. a bulk import with
        // no further edits to any note).
        this.pending.delete(attachPath);
        log.debug(`no owner found for ${attachPath}, leaving unprocessed`);
      }
    }, this.store.settings.claimGraceMs);
    this.settleTimers.set(attachPath, timer);
  }

  private clearSettle(attachPath: string): void {
    const timer = this.settleTimers.get(attachPath);
    if (timer) {
      window.clearTimeout(timer);
      this.settleTimers.delete(attachPath);
    }
  }

  private scheduleProcess(): void {
    if (this.processTimer) return;
    this.processTimer = window.setTimeout(() => {
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
