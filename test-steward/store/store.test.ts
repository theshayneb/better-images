import { App, Plugin } from "obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Store } from "../../src/steward/store/store";
import { AttachmentRecord } from "../../src/steward/store/types";

function makePlugin(): Plugin {
  const app = new App();
  return new Plugin(app, { id: "attachment-steward", name: "Attachment Steward", version: "0.5.1", dir: ".obsidian/plugins/attachment-steward" });
}

function record(overrides: Partial<AttachmentRecord> = {}): AttachmentRecord {
  return {
    v: 1,
    originalName: "Photo",
    extension: "jpg",
    importedAt: 0,
    notePath: "Note.md",
    md5: null,
    md5For: null,
    dedupe: 0,
    applied: null,
    managed: true,
    source: "created",
    ...overrides,
  };
}

describe("Store — in-memory indices", () => {
  let plugin: Plugin;
  let store: Store;

  beforeEach(() => {
    plugin = makePlugin();
    store = new Store(plugin);
  });

  it("indexes a new record by note and by md5", () => {
    store.set("Attachments/a.jpg", record({ notePath: "Note.md", md5: "HASH1" }));
    expect(store.pathsForNote("Note.md")).toEqual(["Attachments/a.jpg"]);
    expect(store.get("Attachments/a.jpg")?.md5).toBe("HASH1");
  });

  it("rekey moves the record to a new path, keeping content and note ownership", () => {
    store.set("old.jpg", record({ notePath: "Note.md" }));
    store.rekey("old.jpg", "new.jpg");
    expect(store.has("old.jpg")).toBe(false);
    expect(store.get("new.jpg")?.originalName).toBe("Photo");
    expect(store.pathsForNote("Note.md")).toEqual(["new.jpg"]);
  });

  it("setNotePath re-indexes byNote for both the old and new owner", () => {
    store.set("a.jpg", record({ notePath: "Note1.md" }));
    store.setNotePath("a.jpg", "Note2.md");
    expect(store.pathsForNote("Note1.md")).toEqual([]);
    expect(store.pathsForNote("Note2.md")).toEqual(["a.jpg"]);
  });

  it("delete removes the record and its indices", () => {
    store.set("a.jpg", record({ notePath: "Note.md", md5: "H" }));
    store.delete("a.jpg");
    expect(store.has("a.jpg")).toBe(false);
    expect(store.pathsForNote("Note.md")).toEqual([]);
  });
});

describe("Store — persistence (shards on disk)", () => {
  let plugin: Plugin;
  let store: Store;

  beforeEach(() => {
    plugin = makePlugin();
    store = new Store(plugin);
  });

  it("flushes a dirty note's shard to its own file, and reloads it correctly from scratch", async () => {
    store.set("Attachments/a.jpg", record({ notePath: "Note.md" }));
    await store.saveNow();

    const reloaded = new Store(plugin);
    await reloaded.load();
    expect(reloaded.get("Attachments/a.jpg")?.originalName).toBe("Photo");
    expect(reloaded.pathsForNote("Note.md")).toEqual(["Attachments/a.jpg"]);
  });

  it("removes a shard file once its note owns no more attachments", async () => {
    store.set("a.jpg", record({ notePath: "Note.md" }));
    await store.saveNow();
    store.delete("a.jpg");
    await store.saveNow();

    const reloaded = new Store(plugin);
    await reloaded.load();
    expect(reloaded.count()).toBe(0);
  });

  it("recovers purely from shard file CONTENT, not from decoding the filename", async () => {
    // The load path (loadShards) reads every *.json under records/ and merges
    // its `attachments`, regardless of what the filename looks like — this is
    // what lets shardPath switch a note over to an opaque MD5-named file
    // (see shards.test.ts) without breaking recovery.
    store.set("a.jpg", record({ notePath: "Some/Deeply/Nested Note.md" }));
    await store.saveNow();

    const dir = ".obsidian/plugins/attachment-steward/records";
    const { files } = await plugin.app.vault.adapter.list(dir);
    const shardFile = files.find((f) => f.endsWith(".json"));
    expect(shardFile).toBeDefined();
    // Overwrite it with an opaquely-named copy to prove the filename itself carries no meaning.
    const content = await plugin.app.vault.adapter.read(shardFile!);
    await plugin.app.vault.adapter.remove(shardFile!);
    await plugin.app.vault.adapter.write(`${dir}/data_totally-opaque-name.json`, content);

    const reloaded = new Store(plugin);
    await reloaded.load();
    expect(reloaded.get("a.jpg")?.notePath).toBe("Some/Deeply/Nested Note.md");
  });

  it("the shared orphans bucket and a note's own shard don't collide", async () => {
    store.set("orphan.jpg", record({ notePath: null }));
    store.set("owned.jpg", record({ notePath: "Note.md" }));
    await store.saveNow();

    const reloaded = new Store(plugin);
    await reloaded.load();
    expect(reloaded.get("orphan.jpg")?.notePath).toBeNull();
    expect(reloaded.get("owned.jpg")?.notePath).toBe("Note.md");
  });

  it("regression: a shard write failure for one note doesn't block flushing other notes queued in the same batch", async () => {
    store.set("ok-before.jpg", record({ notePath: "Before.md" }));
    store.set("bad.jpg", record({ notePath: "Bad.md" }));
    store.set("ok-after.jpg", record({ notePath: "After.md" }));

    const realWrite = plugin.app.vault.adapter.write.bind(plugin.app.vault.adapter);
    const writeSpy = vi.spyOn(plugin.app.vault.adapter, "write").mockImplementation(async (path: string, data: string) => {
      if (path.includes("Bad")) throw new Error("simulated disk failure");
      return realWrite(path, data);
    });

    await expect(store.saveNow()).resolves.not.toThrow();
    writeSpy.mockRestore();

    const reloaded = new Store(plugin);
    await reloaded.load();
    expect(reloaded.get("ok-before.jpg")).toBeDefined();
    expect(reloaded.get("ok-after.jpg")).toBeDefined();
    expect(reloaded.get("bad.jpg")).toBeUndefined(); // the one that actually failed to persist
  });

  it("touch() marks a record's shard dirty for an in-place field mutation", async () => {
    store.set("a.jpg", record({ notePath: "Note.md", md5: null }));
    await store.saveNow();

    const rec = store.get("a.jpg")!;
    rec.md5 = "COMPUTED";
    store.touch("a.jpg");
    await store.saveNow();

    const reloaded = new Store(plugin);
    await reloaded.load();
    expect(reloaded.get("a.jpg")?.md5).toBe("COMPUTED");
  });

  it("migrates pre-sharding legacy data.json attachments on load, then never needs it again", async () => {
    await plugin.saveData({
      schema: 2,
      settings: {},
      attachments: { "legacy.jpg": record({ notePath: "Legacy.md" }) },
    });

    const migrated = new Store(plugin);
    await migrated.load();
    expect(migrated.get("legacy.jpg")?.notePath).toBe("Legacy.md");

    // The migration should have written it out as a proper shard.
    const rereloaded = new Store(plugin);
    await rereloaded.load();
    expect(rereloaded.get("legacy.jpg")?.notePath).toBe("Legacy.md");
  });
});
