import { App, Plugin } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Watcher } from "../../src/steward/engine/watcher";
import { DEFAULT_SETTINGS, Settings } from "../../src/steward/settings/types";
import { Store } from "../../src/steward/store/store";

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
    claimGraceMs: 2500,
    ...overrides,
  };
}

function setup(overrides: Partial<Settings> = {}) {
  const app = new App();
  const plugin = new Plugin(app, { id: "attachment-steward", name: "x", version: "1", dir: ".obsidian/plugins/attachment-steward" });
  const store = new Store(plugin);
  store.data.settings = settings(overrides);
  const watcher = new Watcher(app, store);
  watcher.register(() => {});
  return { app, store, watcher };
}

describe("Watcher — onCreate", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2024, 0, 1));
  });
  afterEach(() => vi.useRealTimers());

  it("registers a brand-new file, freezing its current basename as originalName", () => {
    const { app, store } = setup();
    app.vault.simulateCreate("Inbox/photo.jpg");
    const rec = store.get("Inbox/photo.jpg");
    expect(rec?.originalName).toBe("photo");
    expect(rec?.source).toBe("created");
    expect(rec?.notePath).toBeNull();
  });

  it("does not re-register a file the store already tracks", () => {
    const { app, store } = setup();
    app.vault.simulateCreate("Inbox/photo.jpg");
    const first = store.get("Inbox/photo.jpg");
    first!.originalName = "MODIFIED";
    app.vault.simulateCreate("Inbox/photo.jpg");
    expect(store.get("Inbox/photo.jpg")?.originalName).toBe("MODIFIED");
  });

  it("ignores a file whose extension isn't managed", () => {
    const { app, store } = setup({ excludeExtensionPattern: "jpg" });
    app.vault.simulateCreate("Inbox/photo.jpg");
    expect(store.has("Inbox/photo.jpg")).toBe(false);
  });

  it("claims the owner immediately when a note already links to the new attachment (e.g. a bulk import with links already inline)", async () => {
    const { app, store } = setup();
    const note = app.vault.seedFile("Folder/Note.md");
    app.metadataCache.resolvedLinks = { [note.path]: { "Inbox/photo.jpg": 1 } };

    app.vault.simulateCreate("Inbox/photo.jpg");
    await vi.advanceTimersByTimeAsync(500); // PROCESS_DEBOUNCE_MS

    expect(store.has("Inbox/photo.jpg")).toBe(false); // moved out of Inbox
    expect(app.vault.getAbstractFileByPath("Folder/_sources/_attachments_Note/2024-01-01-photo.jpg")).not.toBeNull();
    expect(store.get("Folder/_sources/_attachments_Note/2024-01-01-photo.jpg")?.notePath).toBe("Folder/Note.md");
  });

  it("leaves an unlinked attachment unprocessed after the grace period elapses, without discarding its record", async () => {
    const { app, store } = setup({ claimGraceMs: 2500 });
    app.vault.simulateCreate("Inbox/photo.jpg");

    await vi.advanceTimersByTimeAsync(2500);
    await vi.advanceTimersByTimeAsync(500);

    // Still tracked, but never moved out of Inbox — no owner ever showed up.
    expect(store.has("Inbox/photo.jpg")).toBe(true);
    expect(store.get("Inbox/photo.jpg")?.notePath).toBeNull();
    expect(app.vault.getAbstractFileByPath("Inbox/photo.jpg")).not.toBeNull();
  });

  it("regression (7e8257c): recognizes its own already-stamped output on first sight instead of stamping a second date on top", () => {
    const { app, store } = setup({ formatTemplate: "${date}-${originalname}", dateFormat: "YYYY-MM-DD" });
    // This device never saw the true original — sync delivered the already-renamed file.
    app.vault.simulateCreate("Inbox/2024-01-01-Vacation Photo.jpg");
    const rec = store.get("Inbox/2024-01-01-Vacation Photo.jpg");
    expect(rec?.originalName).toBe("Vacation Photo");
    expect(rec?.source).toBe("adopted");
  });
});

describe("Watcher — ownership via metadata changes", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2024, 0, 1));
  });
  afterEach(() => vi.useRealTimers());

  it("claims a pending (not-yet-owned) attachment the moment a note's links change to reference it", async () => {
    const { app, store } = setup();
    app.vault.simulateCreate("Inbox/photo.jpg"); // no owner yet — goes pending
    const note = app.vault.seedFile("Folder/Note.md");

    app.metadataCache.trigger(note, "", { embeds: [{ link: "Inbox/photo.jpg" }] });
    await vi.advanceTimersByTimeAsync(500);

    expect(store.has("Inbox/photo.jpg")).toBe(false);
    expect(app.vault.getAbstractFileByPath("Folder/_sources/_attachments_Note/2024-01-01-photo.jpg")).not.toBeNull();
  });

  it("re-claims an already-tracked orphan (settle grace already expired) once a note later links to it", async () => {
    const { app, store } = setup({ claimGraceMs: 100 });
    app.vault.simulateCreate("Inbox/photo.jpg");
    await vi.advanceTimersByTimeAsync(100); // grace expires — becomes a genuine, tracked orphan
    expect(store.get("Inbox/photo.jpg")?.notePath).toBeNull();

    const note = app.vault.seedFile("Folder/Note.md");
    app.metadataCache.trigger(note, "", { links: [{ link: "Inbox/photo.jpg" }] });
    await vi.advanceTimersByTimeAsync(500);

    expect(store.get("Inbox/photo.jpg")).toBeUndefined(); // moved, so no longer at this path
    expect(store.pathsForNote("Folder/Note.md").length).toBe(1);
  });
});

describe("Watcher — onRename", () => {
  it("ignores its own moves (already rekeyed by organizer.ts, marked via InternalMoveTracker)", () => {
    const { app, store, watcher } = setup();
    store.set("a.jpg", {
      v: 1,
      originalName: "a",
      extension: "jpg",
      importedAt: 0,
      notePath: null,
      md5: null,
      md5For: null,
      dedupe: 0,
      applied: null,
      managed: true,
      source: "created",
    });
    const file = app.vault.seedFile("a.jpg");
    // Simulate organizer.ts having already rekeyed the store itself before the rename event fires.
    store.rekey("a.jpg", "b.jpg");
    watcher.internalMoves.mark("b.jpg");
    app.vault.renameFile(file, "b.jpg");
    // Nothing should have double-rekeyed or thrown.
    expect(store.get("b.jpg")).toBeDefined();
  });

  it("rekeys a tracked attachment renamed externally (e.g. by the user, or another plugin)", () => {
    const { app, store } = setup();
    store.set("a.jpg", {
      v: 1,
      originalName: "a",
      extension: "jpg",
      importedAt: 0,
      notePath: "Note.md",
      md5: null,
      md5For: null,
      dedupe: 0,
      applied: null,
      managed: true,
      source: "created",
    });
    const file = app.vault.seedFile("a.jpg");
    app.vault.renameFile(file, "renamed.jpg");
    expect(store.has("a.jpg")).toBe(false);
    expect(store.get("renamed.jpg")?.notePath).toBe("Note.md");
  });

  it("delegates a renamed .md note (not itself a tracked attachment) to handleNoteRename", async () => {
    const { app, store } = setup();
    const note = app.vault.seedFile("Old.md");
    store.set("a.jpg", {
      v: 1,
      originalName: "a",
      extension: "jpg",
      importedAt: Date.UTC(2024, 0, 1),
      notePath: "Old.md",
      md5: null,
      md5For: null,
      dedupe: 0,
      applied: null,
      managed: true,
      source: "created",
    });
    app.vault.seedFile("a.jpg");

    await app.vault.renameFile(note, "New.md");
    // Let the fire-and-forget handleNoteRename promise settle.
    await Promise.resolve();
    await Promise.resolve();

    expect(store.pathsForNote("New.md")).toContain("a.jpg");
  });
});

describe("Watcher — onDelete / claimReplacement", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("finalizes a real deletion after the grace period, dropping the record", async () => {
    const { app, store } = setup();
    store.set("a.jpg", {
      v: 1,
      originalName: "a",
      extension: "jpg",
      importedAt: 0,
      notePath: null,
      md5: "H",
      md5For: null,
      dedupe: 0,
      applied: null,
      managed: true,
      source: "created",
    });
    app.vault.seedFile("a.jpg");
    app.vault.simulateDelete("a.jpg");

    await vi.advanceTimersByTimeAsync(3000); // DELETE_GRACE_MS
    expect(store.has("a.jpg")).toBe(false);
  });

  it("regression (7e8257c): treats a delete+create in the same folder within the grace window as an in-place replacement, not a fresh import", async () => {
    const { app, store } = setup();
    app.vault.seedFile("Note.md"); // the owning note must actually exist for the later reprocessing pass below
    store.set("a.jpg", {
      v: 1,
      originalName: "Vacation Photo",
      extension: "jpg",
      importedAt: 111,
      notePath: "Note.md",
      md5: "OLD_HASH",
      md5For: { size: 1, mtime: 1 },
      dedupe: 3,
      applied: null,
      managed: true,
      source: "created",
    });
    app.vault.seedFile("a.jpg");
    app.vault.simulateDelete("a.jpg");

    await vi.advanceTimersByTimeAsync(500); // well within the 3s grace window
    app.vault.simulateCreate("a.png"); // e.g. a format-conversion plugin rewrote it under a new extension

    const rec = store.get("a.png");
    expect(rec).toBeDefined();
    expect(rec?.originalName).toBe("Vacation Photo"); // identity carried over, not reset
    expect(rec?.notePath).toBe("Note.md"); // ownership carried over too
    expect(rec?.md5).toBeNull(); // stale hash dropped, recomputed on demand
    expect(rec?.dedupe).toBe(3);
    expect(store.has("a.jpg")).toBe(false);

    // The grace timer for the old path must not still fire and delete the
    // (now rekeyed) record out from under it — it only gets reprocessed
    // (moved to wherever the rules now say "a.png" belongs), never dropped.
    await vi.advanceTimersByTimeAsync(3000);
    const stillTracked = [...store.allEntries()].find(([, r]) => r.originalName === "Vacation Photo");
    expect(stillTracked).toBeDefined();
  });

  it("does not treat a replacement in a DIFFERENT folder as the same attachment", async () => {
    const { app, store } = setup();
    store.set("Folder1/a.jpg", {
      v: 1,
      originalName: "a",
      extension: "jpg",
      importedAt: 0,
      notePath: null,
      md5: null,
      md5For: null,
      dedupe: 0,
      applied: null,
      managed: true,
      source: "created",
    });
    app.vault.seedFile("Folder1/a.jpg");
    app.vault.simulateDelete("Folder1/a.jpg");
    await vi.advanceTimersByTimeAsync(500);

    app.vault.simulateCreate("Folder2/a.jpg");
    const rec = store.get("Folder2/a.jpg");
    expect(rec?.source).toBe("created"); // a fresh record, not a carried-over replacement
  });
});
