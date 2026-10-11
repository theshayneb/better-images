import { App, TFile } from "obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ensureFolder, InternalMoveTracker, processAttachment } from "../../src/steward/engine/organizer";
import { DEFAULT_SETTINGS, Settings } from "../../src/steward/settings/types";
import { Store } from "../../src/steward/store/store";
import { AttachmentRecord } from "../../src/steward/store/types";
import { Plugin } from "obsidian";

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
    notePath: "Folder/Note.md",
    md5: null,
    md5For: null,
    dedupe: 0,
    applied: null,
    managed: true,
    source: "created",
    ...overrides,
  };
}

function makeStore(app: App, s: Settings): Store {
  const plugin = new Plugin(app, { id: "attachment-steward", name: "x", version: "1", dir: ".obsidian/plugins/attachment-steward" });
  const store = new Store(plugin);
  store.data.settings = s;
  return store;
}

describe("processAttachment", () => {
  let app: App;
  let s: Settings;
  let store: Store;
  let internalMoves: InternalMoveTracker;

  beforeEach(() => {
    app = new App();
    s = settings();
    store = makeStore(app, s);
    internalMoves = new InternalMoveTracker();
  });

  it("returns 'missing' when the file has no record at all", async () => {
    const file = app.vault.seedFile("Elsewhere/photo.jpg");
    const outcome = await processAttachment(app, store, file, null, internalMoves);
    expect(outcome.action).toBe("missing");
  });

  it("returns 'filtered' and does not touch the file when its extension is excluded", async () => {
    s.excludeExtensionPattern = "jpg";
    const file = app.vault.seedFile("Elsewhere/photo.jpg");
    store.set(file.path, record());

    const outcome = await processAttachment(app, store, file, null, internalMoves);
    expect(outcome.action).toBe("filtered");
    expect(file.path).toBe("Elsewhere/photo.jpg");
  });

  it("returns 'filtered' for a file under an excluded folder", async () => {
    s.excludedFolders = [{ path: "Elsewhere", includeSubpaths: true }];
    const file = app.vault.seedFile("Elsewhere/photo.jpg");
    store.set(file.path, record());

    expect((await processAttachment(app, store, file, null, internalMoves)).action).toBe("filtered");
  });

  it("returns 'skip' when the file already sits where the rules say it should", async () => {
    const note = app.vault.seedFile("Folder/Note.md");
    const file = app.vault.seedFile("Folder/_sources/_attachments_Note/2024-01-01-Photo.jpg");
    store.set(file.path, record());

    const outcome = await processAttachment(app, store, file, note, internalMoves);
    expect(outcome.action).toBe("skip");
    expect(file.path).toBe("Folder/_sources/_attachments_Note/2024-01-01-Photo.jpg");
  });

  it("moves the file, rekeys the store, and freezes an 'applied' snapshot on the record", async () => {
    const note = app.vault.seedFile("Folder/Note.md");
    const file = app.vault.seedFile("Elsewhere/photo.jpg");
    store.set(file.path, record());

    const outcome = await processAttachment(app, store, file, note, internalMoves);
    expect(outcome).toEqual({ action: "moved", from: "Elsewhere/photo.jpg", to: "Folder/_sources/_attachments_Note/2024-01-01-Photo.jpg" });

    // The file object itself was renamed in place.
    expect(file.path).toBe("Folder/_sources/_attachments_Note/2024-01-01-Photo.jpg");
    // The store record followed it to the new key.
    expect(store.has("Elsewhere/photo.jpg")).toBe(false);
    const rec = store.get("Folder/_sources/_attachments_Note/2024-01-01-Photo.jpg");
    expect(rec?.applied?.resultPath).toBe("Folder/_sources/_attachments_Note/2024-01-01-Photo.jpg");
  });

  it("marks and then releases the destination in the internal-move tracker (so the watcher's own rename handler can tell this was our own move)", async () => {
    const note = app.vault.seedFile("Folder/Note.md");
    const file = app.vault.seedFile("Elsewhere/photo.jpg");
    store.set(file.path, record());

    let sawMarkedDuringMove = false;
    const originalRenameFile = app.fileManager.renameFile.bind(app.fileManager);
    app.fileManager.renameFile = async (f, p) => {
      sawMarkedDuringMove = internalMoves.has(p);
      return originalRenameFile(f, p);
    };

    await processAttachment(app, store, file, note, internalMoves);
    expect(sawMarkedDuringMove).toBe(true);
    expect(internalMoves.has("Folder/_sources/_attachments_Note/2024-01-01-Photo.jpg")).toBe(false);
  });

  it("deduplicates against a real name collision end-to-end", async () => {
    const note = app.vault.seedFile("Folder/Note.md");
    app.vault.seedFile("Folder/_sources/_attachments_Note/2024-01-01-Photo.jpg"); // occupies the plain name
    const file = app.vault.seedFile("Elsewhere/photo.jpg");
    store.set(file.path, record());

    const outcome = await processAttachment(app, store, file, note, internalMoves);
    expect(outcome.to).toBe("Folder/_sources/_attachments_Note/2024-01-01-Photo-1.jpg");
    expect(store.get(outcome.to!)?.dedupe).toBe(1);
  });

  it("removes the old folder when it's left empty and cleanEmptyFolders is on", async () => {
    const note = app.vault.seedFile("Folder/Note.md");
    const file = app.vault.seedFile("Elsewhere/photo.jpg");
    store.set(file.path, record());
    s.cleanEmptyFolders = true;

    const rmdirSpy = vi.spyOn(app.vault.adapter, "rmdir");
    await processAttachment(app, store, file, note, internalMoves);
    expect(rmdirSpy).toHaveBeenCalledWith("Elsewhere", true);
  });

  it("leaves a non-empty old folder alone", async () => {
    const note = app.vault.seedFile("Folder/Note.md");
    const file = app.vault.seedFile("Elsewhere/photo.jpg");
    app.vault.seedFile("Elsewhere/other-file.txt"); // still occupied afterwards
    store.set(file.path, record());
    s.cleanEmptyFolders = true;

    const rmdirSpy = vi.spyOn(app.vault.adapter, "rmdir");
    await processAttachment(app, store, file, note, internalMoves);
    expect(rmdirSpy).not.toHaveBeenCalled();
  });

  it("does not touch the old folder when cleanEmptyFolders is off", async () => {
    const note = app.vault.seedFile("Folder/Note.md");
    const file = app.vault.seedFile("Elsewhere/photo.jpg");
    store.set(file.path, record());
    s.cleanEmptyFolders = false;

    const rmdirSpy = vi.spyOn(app.vault.adapter, "rmdir");
    await processAttachment(app, store, file, note, internalMoves);
    expect(rmdirSpy).not.toHaveBeenCalled();
  });

  it("computes the destination from the frozen originalName, never the file's current on-disk name", async () => {
    const note = app.vault.seedFile("Folder/Note.md");
    // Current filename on disk has drifted from the record's frozen originalName
    // (e.g. hand-renamed by the user, or mangled by some other tool).
    const file = app.vault.seedFile("Elsewhere/some-other-name.jpg");
    store.set(file.path, record({ originalName: "Photo" }));

    const outcome = await processAttachment(app, store, file, note, internalMoves);
    expect(outcome.to).toBe("Folder/_sources/_attachments_Note/2024-01-01-Photo.jpg");
  });
});

describe("InternalMoveTracker", () => {
  it("mark/has/consume", () => {
    const t = new InternalMoveTracker();
    expect(t.has("a")).toBe(false);
    t.mark("a");
    expect(t.has("a")).toBe(true);
    expect(t.consume("a")).toBe(true);
    expect(t.has("a")).toBe(false);
    expect(t.consume("a")).toBe(false);
  });
});

describe("ensureFolder", () => {
  it("creates the folder if missing, and is a no-op if it already exists", async () => {
    const app = new App();
    await ensureFolder(app, "A/B/C");
    expect(app.vault.getAbstractFileByPath("A/B/C")).not.toBeNull();
    await expect(ensureFolder(app, "A/B/C")).resolves.not.toThrow();
  });

  it("is a no-op for an empty path", async () => {
    const app = new App();
    await expect(ensureFolder(app, "")).resolves.not.toThrow();
  });
});
