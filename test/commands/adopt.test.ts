import { App, CachedMetadata, Modal, Notice, Plugin, Setting } from "obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { adoptActiveNoteCommand, adoptFolderCommand, adoptVaultCommand } from "../../src/commands/adopt";
import { InternalMoveTracker } from "../../src/engine/organizer";
import { DEFAULT_SETTINGS, Settings } from "../../src/settings/types";
import { Store } from "../../src/store/store";
import { AttachmentRecord } from "../../src/store/types";

function settings(overrides: Partial<Settings> = {}): Settings {
  return {
    ...DEFAULT_SETTINGS,
    rootMode: "nextToNote",
    root: "_sources",
    pathTemplate: "_attachments_${notename}",
    formatTemplate: "${date}-${originalname}",
    dateFormat: "YYYY-MM-DD",
    extensionOverrides: [],
    excludedFolders: [],
    ...overrides,
  };
}

function setup(s: Partial<Settings> = {}) {
  const app = new App();
  const plugin = new Plugin(app, { id: "attachment-steward", name: "x", version: "1", dir: ".obsidian/plugins/attachment-steward" });
  const store = new Store(plugin);
  store.data.settings = settings(s);
  return { app, store, internalMoves: new InternalMoveTracker() };
}

function apply(): Promise<void> {
  const modal = Modal.instances.at(-1)!;
  const setting = Setting.instances.find((st) => st.containerEl === modal.contentEl)!;
  return setting.buttons[1].click();
}

describe("adopt (active note / vault / folder)", () => {
  beforeEach(() => {
    Notice.log = [];
    Modal.instances.length = 0;
    Setting.instances.length = 0;
  });

  it("reports nothing to adopt when no note references any unmanaged attachment", async () => {
    const { app, store, internalMoves } = setup();
    const note = app.vault.seedFile("Note.md");
    app.workspace.setActiveFile(note);
    app.metadataCache.setFileCache(note, {});

    await adoptActiveNoteCommand(app, store, internalMoves)();
    expect(Notice.log.at(-1)).toContain("No unmanaged attachments");
    expect(Modal.instances.length).toBe(0);
  });

  it("reports when there's no active note", async () => {
    const { app, store, internalMoves } = setup();
    await adoptActiveNoteCommand(app, store, internalMoves)();
    expect(Notice.log.at(-1)).toContain("No active note");
  });

  it("registers a never-before-tracked attachment the active note links to, then moves it on confirm", async () => {
    const { app, store, internalMoves } = setup();
    const note = app.vault.seedFile("Folder/Note.md");
    const file = app.vault.seedFile("Inbox/photo.jpg");
    app.workspace.setActiveFile(note);
    app.metadataCache.setFileCache(note, { embeds: [{ link: "Inbox/photo.jpg" }] });

    const promise = adoptActiveNoteCommand(app, store, internalMoves)();
    await vi.waitFor(() => expect(Modal.instances.length).toBe(1));
    await apply();
    await promise;

    expect(store.has("Inbox/photo.jpg")).toBe(false); // rekeyed to its new home
    expect(file.path).not.toBe("Inbox/photo.jpg");
    expect(store.pathsForNote("Folder/Note.md").length).toBe(1);
  });

  it("re-claims an already-tracked but ownerless (orphaned) attachment instead of duplicating its record", async () => {
    const { app, store, internalMoves } = setup();
    const note = app.vault.seedFile("Folder/Note.md");
    const file = app.vault.seedFile("Inbox/photo.jpg");
    store.set(file.path, {
      v: 1,
      originalName: "FROZEN NAME",
      extension: "jpg",
      importedAt: Date.UTC(2024, 0, 1),
      notePath: null,
      md5: null,
      md5For: null,
      dedupe: 0,
      applied: null,
      managed: true,
      source: "created",
    });
    app.workspace.setActiveFile(note);
    app.metadataCache.setFileCache(note, { embeds: [{ link: "Inbox/photo.jpg" }] });

    const promise = adoptActiveNoteCommand(app, store, internalMoves)();
    await vi.waitFor(() => expect(Modal.instances.length).toBe(1));
    await apply();
    await promise;

    const moved = store.pathsForNote("Folder/Note.md");
    expect(moved.length).toBe(1);
    // The pre-existing record's frozen name was kept — not replaced by a fresh "adopted" one.
    expect(store.get(moved[0])?.originalName).toBe("FROZEN NAME");
  });

  it("does not adopt an attachment that already has an owning note, even if referenced by another note too", async () => {
    const { app, store, internalMoves } = setup();
    const owner = app.vault.seedFile("Owner.md");
    const other = app.vault.seedFile("Other.md");
    const file = app.vault.seedFile("shared.jpg");
    store.set(file.path, {
      v: 1,
      originalName: "shared",
      extension: "jpg",
      importedAt: 0,
      notePath: "Owner.md",
      md5: null,
      md5For: null,
      dedupe: 0,
      applied: null,
      managed: true,
      source: "created",
    });
    app.metadataCache.setFileCache(other, { embeds: [{ link: "shared.jpg" }] });

    await adoptFolderCommand(app, store, internalMoves)(app.vault.seedFolder(""));
    expect(Notice.log.at(-1)).toContain("No unmanaged attachments");
    expect(store.get("shared.jpg")?.notePath).toBe("Owner.md"); // unchanged
  });

  it("adoptVaultCommand scans every markdown note in the vault, not just the active one", async () => {
    const { app, store, internalMoves } = setup();
    app.vault.seedFile("A.md");
    const b = app.vault.seedFile("B.md");
    const file = app.vault.seedFile("photo.jpg");
    app.metadataCache.setFileCache(b, { embeds: [{ link: "photo.jpg" }] });

    const promise = adoptVaultCommand(app, store, internalMoves)();
    await vi.waitFor(() => expect(Modal.instances.length).toBe(1));
    await apply();
    await promise;

    expect(store.pathsForNote("B.md").length).toBe(1);
    void file;
  });
});
