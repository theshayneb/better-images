import { App, Modal, Notice, Plugin, Setting } from "obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InternalMoveTracker } from "../../src/steward/engine/organizer";
import { reapplyActiveNoteCommand, reapplyAllCommand, reapplyFolderCommand } from "../../src/steward/commands/reapply";
import { DEFAULT_SETTINGS, Settings } from "../../src/steward/settings/types";
import { Store } from "../../src/steward/store/store";
import { AttachmentRecord } from "../../src/steward/store/types";

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

function setup(s: Partial<Settings> = {}) {
  const app = new App();
  const plugin = new Plugin(app, { id: "attachment-steward", name: "x", version: "1", dir: ".obsidian/plugins/attachment-steward" });
  const store = new Store(plugin);
  store.data.settings = settings(s);
  return { app, store, internalMoves: new InternalMoveTracker() };
}

/** Finds the Setting the currently-open modal built, so a test can click one of its buttons. */
function modalButtons(): { cancel: () => Promise<void>; apply: () => Promise<void> } {
  const modal = Modal.instances.at(-1)!;
  const setting = Setting.instances.find((s) => s.containerEl === modal.contentEl)!;
  return { cancel: () => setting.buttons[0].click(), apply: () => setting.buttons[1].click() };
}

describe("reapplyRules (via reapplyAllCommand)", () => {
  beforeEach(() => {
    Notice.log = [];
    Modal.instances.length = 0;
    Setting.instances.length = 0;
  });

  it("reports and opens no modal when there's nothing tracked at all", async () => {
    const { app, store, internalMoves } = setup();
    await reapplyAllCommand(app, store, internalMoves)();
    expect(Notice.log.at(-1)).toContain("No managed attachments");
    expect(Modal.instances.length).toBe(0);
  });

  it("moves nothing when the user cancels the preview", async () => {
    const { app, store, internalMoves } = setup();
    app.vault.seedFile("Folder/Note.md");
    const file = app.vault.seedFile("Elsewhere/photo.jpg");
    store.set(file.path, record());

    const promise = reapplyAllCommand(app, store, internalMoves)();
    await vi.waitFor(() => expect(Modal.instances.length).toBe(1));
    await modalButtons().cancel();
    await promise;

    expect(file.path).toBe("Elsewhere/photo.jpg");
    expect(Notice.log.some((m) => m.includes("Reapplied"))).toBe(false);
  });

  it("moves every previewed attachment once the user confirms", async () => {
    const { app, store, internalMoves } = setup();
    app.vault.seedFile("Folder/Note.md");
    const file = app.vault.seedFile("Elsewhere/photo.jpg");
    store.set(file.path, record());

    const promise = reapplyAllCommand(app, store, internalMoves)();
    await vi.waitFor(() => expect(Modal.instances.length).toBe(1));
    await modalButtons().apply();
    await promise;

    expect(file.path).toBe("Folder/_sources/_attachments_Note/2024-01-01-Photo.jpg");
    expect(Notice.log.at(-1)).toContain("1 moved");
  });

  it("is idempotent — reapplying a second time with no settings change previews 0 moves and leaves the file exactly where it is", async () => {
    const { app, store, internalMoves } = setup();
    app.vault.seedFile("Folder/Note.md");
    const file = app.vault.seedFile("Elsewhere/photo.jpg");
    store.set(file.path, record());

    let promise = reapplyAllCommand(app, store, internalMoves)();
    await vi.waitFor(() => expect(Modal.instances.length).toBe(1));
    await modalButtons().apply();
    await promise;
    const settledPath = file.path;

    promise = reapplyAllCommand(app, store, internalMoves)();
    await vi.waitFor(() => expect(Modal.instances.length).toBe(2));
    // Nothing left to move, so the modal's second button reads "Close", not
    // "Apply" — clicking it resolves waitForChoice(false), and reapplyRules
    // returns before logging anything (see reapply.ts): no new Notice fires.
    const noticesBefore = Notice.log.length;
    await modalButtons().apply();
    await promise;

    expect(file.path).toBe(settledPath);
    expect(Notice.log.length).toBe(noticesBefore);
  });

  it("skips (does not preview) an attachment whose extension became excluded since it was tracked", async () => {
    const { app, store, internalMoves } = setup({ excludeExtensionPattern: "jpg" });
    app.vault.seedFile("Folder/Note.md");
    const file = app.vault.seedFile("Elsewhere/photo.jpg");
    store.set(file.path, record());

    const promise = reapplyAllCommand(app, store, internalMoves)();
    await vi.waitFor(() => expect(Modal.instances.length).toBe(1));
    await modalButtons().apply();
    await promise;

    expect(file.path).toBe("Elsewhere/photo.jpg"); // filtered, never previewed as a move
  });
});

describe("reapplyActiveNoteCommand / reapplyFolderCommand", () => {
  beforeEach(() => {
    Notice.log = [];
    Modal.instances.length = 0;
    Setting.instances.length = 0;
  });

  it("reapplyActiveNoteCommand scopes to the active note's own attachments only", async () => {
    const { app, store, internalMoves } = setup();
    const note1 = app.vault.seedFile("Folder/Note1.md");
    app.vault.seedFile("Folder/Note2.md");
    app.workspace.setActiveFile(note1);
    const f1 = app.vault.seedFile("Elsewhere/a.jpg");
    const f2 = app.vault.seedFile("Elsewhere/b.jpg");
    store.set(f1.path, record({ notePath: "Folder/Note1.md" }));
    store.set(f2.path, record({ notePath: "Folder/Note2.md", originalName: "Other" }));

    const promise = reapplyActiveNoteCommand(app, store, internalMoves)();
    await vi.waitFor(() => expect(Modal.instances.length).toBe(1));
    await modalButtons().apply();
    await promise;

    expect(f1.path).not.toBe("Elsewhere/a.jpg"); // Note1's attachment moved
    expect(f2.path).toBe("Elsewhere/b.jpg"); // Note2's attachment untouched
  });

  it("reapplyFolderCommand scopes to attachments owned by notes under that folder", async () => {
    const { app, store, internalMoves } = setup();
    app.vault.seedFile("Inside/Note.md");
    app.vault.seedFile("Outside/Note.md");
    const inside = app.vault.seedFile("a.jpg");
    const outside = app.vault.seedFile("b.jpg");
    store.set(inside.path, record({ notePath: "Inside/Note.md" }));
    store.set(outside.path, record({ notePath: "Outside/Note.md", originalName: "Other" }));

    const folder = app.vault.seedFolder("Inside");
    const promise = reapplyFolderCommand(app, store, internalMoves)(folder);
    await vi.waitFor(() => expect(Modal.instances.length).toBe(1));
    await modalButtons().apply();
    await promise;

    expect(inside.path).not.toBe("a.jpg");
    expect(outside.path).toBe("b.jpg");
  });
});
