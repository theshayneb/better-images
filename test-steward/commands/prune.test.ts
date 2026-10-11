import { App, Notice, Plugin } from "obsidian";
import { beforeEach, describe, expect, it } from "vitest";
import { pruneCommand, pruneFolderCommand } from "../../src/commands/prune";
import { Store } from "../../src/store/store";
import { AttachmentRecord } from "../../src/store/types";

function record(overrides: Partial<AttachmentRecord> = {}): AttachmentRecord {
  return {
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
    ...overrides,
  };
}

function setup() {
  const app = new App();
  const plugin = new Plugin(app, { id: "attachment-steward", name: "x", version: "1", dir: ".obsidian/plugins/attachment-steward" });
  return { app, store: new Store(plugin) };
}

describe("pruneCommand", () => {
  beforeEach(() => {
    Notice.log = [];
  });

  it("removes records whose file no longer exists on disk", () => {
    const { app, store } = setup();
    store.set("gone.jpg", record());
    app.vault.seedFile("still-here.jpg");
    store.set("still-here.jpg", record());

    pruneCommand(app, store)();
    expect(store.has("gone.jpg")).toBe(false);
    expect(store.has("still-here.jpg")).toBe(true);
    expect(Notice.log.at(-1)).toContain("Pruned 1");
  });

  it("reports nothing to prune when every record still has a real file", () => {
    const { app, store } = setup();
    app.vault.seedFile("a.jpg");
    store.set("a.jpg", record());

    pruneCommand(app, store)();
    expect(Notice.log.at(-1)).toContain("No orphaned records");
  });
});

describe("pruneFolderCommand", () => {
  it("only prunes records whose path sits under the given folder", () => {
    const { app, store } = setup();
    store.set("Keep/gone.jpg", record());
    store.set("Other/gone.jpg", record());
    const folder = app.vault.seedFolder("Keep");

    pruneFolderCommand(app, store)(folder);
    expect(store.has("Keep/gone.jpg")).toBe(false);
    expect(store.has("Other/gone.jpg")).toBe(true);
  });
});
