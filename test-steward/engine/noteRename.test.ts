import { App, Plugin, TFile } from "obsidian";
import { describe, expect, it } from "vitest";
import { handleNoteRename } from "../../src/engine/noteRename";
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

function record(overrides: Partial<AttachmentRecord> = {}): AttachmentRecord {
  return {
    v: 1,
    originalName: "Photo",
    extension: "jpg",
    importedAt: Date.UTC(2024, 0, 1),
    notePath: "Old.md",
    md5: null,
    md5For: null,
    dedupe: 0,
    applied: null,
    managed: true,
    source: "created",
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

describe("handleNoteRename", () => {
  it("does nothing when autoRenameOnNoteRename is off", async () => {
    const { app, store, internalMoves } = setup({ autoRenameOnNoteRename: false });
    const note = app.vault.seedFile("New.md");
    const file = app.vault.seedFile("a.jpg");
    store.set("a.jpg", record());

    await handleNoteRename(app, store, note, "Old.md", internalMoves);
    expect(file.path).toBe("a.jpg"); // untouched
  });

  it("does nothing when the renamed note owned no attachments", async () => {
    const { app, store, internalMoves } = setup();
    const note = app.vault.seedFile("New.md");
    await expect(handleNoteRename(app, store, note, "Old.md", internalMoves)).resolves.toBeUndefined();
  });

  it("re-owns and moves every attachment that belonged to the old note path", async () => {
    const { app, store, internalMoves } = setup();
    const note = app.vault.seedFile("Folder/New.md");
    app.vault.seedFile("a.jpg");
    store.set("a.jpg", record({ notePath: "Old.md" }));

    await handleNoteRename(app, store, note, "Old.md", internalMoves);

    const rec = store.get("Folder/_sources/_attachments_New/2024-01-01-Photo.jpg");
    expect(rec).toBeDefined();
    expect(rec?.notePath).toBe("Folder/New.md");
    expect(store.pathsForNote("Old.md")).toEqual([]);
  });

  it("moves every attachment the note owned, not just the first", async () => {
    const { app, store, internalMoves } = setup();
    const note = app.vault.seedFile("Folder/New.md");
    app.vault.seedFile("a.jpg");
    app.vault.seedFile("b.png");
    store.set("a.jpg", record({ notePath: "Old.md", originalName: "A" }));
    store.set("b.png", record({ notePath: "Old.md", originalName: "B", extension: "png" }));

    await handleNoteRename(app, store, note, "Old.md", internalMoves);
    expect(store.pathsForNote("Folder/New.md").length).toBe(2);
  });
});
