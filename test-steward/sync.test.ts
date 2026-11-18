import { App, Platform, setRequestUrlHandler, TFile } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BackgroundTasks, SETTLE_MS } from "../src/background";
import BetterImagesPlugin from "../src/main";
import { resolveDestination } from "../src/steward/core/resolve";
import { DEFAULT_SETTINGS } from "../src/steward/settings/types";
import { AttachmentRecord } from "../src/steward/store/types";

// The user's own attachment settings: next to the note, named after it.
const USER_SETTINGS = { ...DEFAULT_SETTINGS, rootMode: "nextToNote", root: "", pathTemplate: "", formatTemplate: "${notename}", dateFormat: "MM-DD-YYYY hh-mm-ss A" };
const SAVED = { attachmentStewardImportChecked: true, attachmentSteward: { schema: 2, settings: USER_SETTINGS }, coverImages: { autoDownload: true } };
const DIR = ".obsidian/plugins/better-images";
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]).buffer;

async function loadPlugin(app: App, saved: unknown = SAVED): Promise<BetterImagesPlugin> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const plugin = new BetterImagesPlugin(app as any, { id: "better-images", name: "x", version: "1", dir: DIR } as any);
  if (saved) await plugin.saveData(JSON.parse(JSON.stringify(saved)));
  await plugin.onload();
  await plugin.steward.recordsLoaded;
  return plugin;
}

function record(notePath: string): AttachmentRecord {
  return { v: 1, originalName: "Pasted image", extension: "png", importedAt: 0, notePath, md5: null, md5For: null, dedupe: 0, applied: null, managed: true, source: "created" };
}

/** A note linking a new image, as Sync delivers it: the image appears and the note's links say so. */
function syncInLinkedImage(app: App, notePath: string, imagePath: string): void {
  const note = app.vault.getAbstractFileByPath(notePath) as TFile;
  app.metadataCache.resolvedLinks = { [note.path]: { [imagePath]: 1 } };
  app.vault.simulateCreate(imagePath);
  app.metadataCache.trigger(note, "", { embeds: [{ link: imagePath.split("/").pop()! }] });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.UTC(2026, 10, 18));
  Platform.isMobile = false;
});
afterEach(() => {
  Platform.isMobile = false;
  vi.useRealTimers();
});

describe("Run background tasks on this device", () => {
  it("defaults to on for desktop and off for phone and tablet, and is stored on the device, not in data.json", async () => {
    const app = new App();
    expect(new BackgroundTasks(app as never, false).enabled).toBe(true);
    expect(new BackgroundTasks(app as never, true).enabled).toBe(false);

    const tasks = new BackgroundTasks(app as never, true);
    tasks.enabled = true;
    expect(new BackgroundTasks(app as never, true).enabled).toBe(true);
    expect(app.localStorage.get("better-images:run-background-tasks")).toBe(true);

    const plugin = await loadPlugin(app);
    expect(JSON.stringify(await plugin.loadData())).not.toContain("background");
  });

  it("waits until the app has been running, or back in the foreground, for the settle time", async () => {
    const tasks = new BackgroundTasks(new App() as never, false);
    const ran = vi.fn();
    tasks.whenReady(ran);
    await vi.advanceTimersByTimeAsync(SETTLE_MS - 1000);
    tasks.restart(); // resumed: start waiting again
    await vi.advanceTimersByTimeAsync(SETTLE_MS - 1000);
    expect(ran).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2000);
    expect(ran).toHaveBeenCalledOnce();
  });
});

describe("a phone or tablet (background tasks off) leaves synced files alone", () => {
  beforeEach(() => {
    Platform.isMobile = true;
  });

  it("doesn't rename or record an attachment that arrives through sync", async () => {
    const app = new App();
    const plugin = await loadPlugin(app);
    app.vault.seedFile("Books/Dune.md");

    syncInLinkedImage(app, "Books/Dune.md", "Books/Pasted image 20261118.png");
    await vi.advanceTimersByTimeAsync(SETTLE_MS * 2);

    expect(app.vault.getAbstractFileByPath("Books/Pasted image 20261118.png")).toBeInstanceOf(TFile);
    expect(plugin.steward.store.count()).toBe(0);
  });

  it("doesn't move a note's attachments when the note's rename arrives through sync", async () => {
    const app = new App();
    const plugin = await loadPlugin(app);
    const note = app.vault.seedFile("Books/Dune.md");
    app.vault.seedFile("Books/Dune.png");
    plugin.steward.store.set("Books/Dune.png", record(note.path));

    await app.vault.renameFile(note, "Books/Arrakis.md");
    await vi.advanceTimersByTimeAsync(SETTLE_MS * 2);

    expect(app.vault.getAbstractFileByPath("Books/Dune.png")).toBeInstanceOf(TFile);
    expect(app.vault.getAbstractFileByPath("Books/Arrakis.png")).toBeNull();
  });

  it("doesn't download covers or rename them", async () => {
    const app = new App();
    const calls: string[] = [];
    setRequestUrlHandler(async ({ url }) => {
      calls.push(url);
      return { status: 200, headers: {}, arrayBuffer: JPEG };
    });
    await loadPlugin(app);
    const emma = app.vault.seedFile("Books/Emma.md");
    app.metadataCache.setFileCache(emma, { frontmatter: { Image: "https://img/emma" } });
    app.metadataCache.trigger(emma, "", app.metadataCache.getFileCache(emma));

    const dune = app.vault.seedFile("Books/Dune.md");
    app.vault.seedFile("Books/Images/Dune.jpg", { content: JPEG });
    app.metadataCache.setFileCache(dune, { frontmatter: { Image: "[[Dune.jpg]]" } });
    await app.vault.renameFile(dune, "Books/Arrakis.md");
    await vi.advanceTimersByTimeAsync(SETTLE_MS * 2);

    expect(calls).toEqual([]);
    expect(app.vault.getAbstractFileByPath("Books/Images/Dune.jpg")).toBeInstanceOf(TFile);
  });
});

describe("the desktop (background tasks on)", () => {
  it("organizes a synced-in attachment only after Sync has had time to settle", async () => {
    const app = new App();
    await loadPlugin(app);
    app.vault.seedFile("Books/Dune.md");

    syncInLinkedImage(app, "Books/Dune.md", "Books/Pasted image 20261118.png");
    await vi.advanceTimersByTimeAsync(SETTLE_MS - 5000);
    expect(app.vault.getAbstractFileByPath("Books/Pasted image 20261118.png")).toBeInstanceOf(TFile);

    await vi.advanceTimersByTimeAsync(10000);
    expect(app.vault.getAbstractFileByPath("Books/Pasted image 20261118.png")).toBeNull();
    expect(app.vault.getAbstractFileByPath("Books/Dune.png")).toBeInstanceOf(TFile);
  });

  it("downloads a cover only after Sync has had time to settle", async () => {
    const app = new App();
    const calls: string[] = [];
    setRequestUrlHandler(async ({ url }) => {
      calls.push(url);
      return { status: 200, headers: {}, arrayBuffer: JPEG };
    });
    await loadPlugin(app);
    const dune = app.vault.seedFile("Books/Dune.md");
    app.metadataCache.setFileCache(dune, { frontmatter: { Image: "https://img/dune" } });
    app.metadataCache.trigger(dune, "", app.metadataCache.getFileCache(dune));

    await vi.advanceTimersByTimeAsync(SETTLE_MS - 5000);
    expect(calls).toEqual([]);
    await vi.advanceTimersByTimeAsync(10000);
    expect(calls).toEqual(["https://img/dune"]);
  });

  it("leaves an image that already has its numbered name where it is", async () => {
    const app = new App();
    app.vault.seedFile("Books/Dune.png");
    const file = app.vault.seedFile("Books/Dune-1.png");
    const note = app.vault.seedFile("Books/Dune.md");
    const result = await resolveDestination(app as never, file as never, record(note.path), note as never, USER_SETTINGS as never);
    expect(result.action).toBe("skip");
  });
});

describe("writes only when something changed", () => {
  it("doesn't rewrite data.json or record files when nothing changed, including on close", async () => {
    const app = new App();
    const plugin = await loadPlugin(app);
    const note = app.vault.seedFile("Books/Dune.md");
    app.vault.seedFile("Books/Dune.png");
    plugin.steward.store.set("Books/Dune.png", record(note.path));
    await plugin.steward.store.saveNow();

    const saveData = vi.spyOn(plugin, "saveData");
    const write = vi.spyOn(app.vault.adapter, "write");
    plugin.steward.store.touch("Books/Dune.png"); // marks the record file dirty without changing it
    await plugin.steward.store.saveNow();
    plugin.onunload();
    await vi.advanceTimersByTimeAsync(1000);

    expect(saveData).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it("doesn't rewrite a cover with the same picture", async () => {
    const app = new App();
    setRequestUrlHandler(async () => ({ status: 200, headers: {}, arrayBuffer: JPEG }));
    const plugin = await loadPlugin(app);
    const cover = app.vault.seedFile("Books/Images/Dune.jpg", { content: JPEG.slice(0) });
    const dune = app.vault.seedFile("Books/Dune.md");
    app.metadataCache.setFileCache(dune, { frontmatter: { Image: "https://img/dune" } });
    const modify = vi.spyOn(app.vault, "modifyBinary");

    await plugin.covers.processNote(dune);

    expect(modify).not.toHaveBeenCalled();
    expect(app.metadataCache.getFileCache(dune)?.frontmatter?.Image).toBe(`[[${cover.name}]]`);
  });
});

describe("settings that arrive through Sync", () => {
  async function deliver(plugin: BetterImagesPlugin, change: (settings: Record<string, unknown>) => void) {
    const incoming = JSON.parse(JSON.stringify(await plugin.loadData())) as { attachmentSteward: { settings: Record<string, unknown> } };
    change(incoming.attachmentSteward.settings);
    // Written by Sync, not by the plugin: bypass the plugin's own bookkeeping.
    await Object.getPrototypeOf(BetterImagesPlugin.prototype).saveData.call(plugin, incoming);
    await plugin.onExternalSettingsChange();
  }

  it("replace this device's copy instead of being overwritten by it later", async () => {
    const app = new App();
    const plugin = await loadPlugin(app);
    const saveData = vi.spyOn(plugin, "saveData");

    await deliver(plugin, (settings) => (settings.formatTemplate = "${notename} cover"));
    plugin.onunload();
    await vi.advanceTimersByTimeAsync(1000);

    expect(plugin.steward.store.settings.formatTemplate).toBe("${notename} cover");
    expect(saveData).not.toHaveBeenCalled();
  });

  it("are merged with a change made here that wasn't saved yet", async () => {
    const app = new App();
    const plugin = await loadPlugin(app);
    plugin.steward.store.settings.root = "Attachments"; // edited here, save still pending

    await deliver(plugin, (settings) => (settings.formatTemplate = "${notename} cover"));
    await plugin.steward.store.saveNow();

    const saved = (await plugin.loadData()) as { attachmentSteward: { settings: Record<string, unknown> } };
    expect(saved.attachmentSteward.settings).toMatchObject({ root: "Attachments", formatTemplate: "${notename} cover" });
  });
});

describe("start-up", () => {
  it("doesn't wait for the attachment records, and reads them in parallel", async () => {
    const app = new App();
    const { adapter } = app.vault;
    await adapter.mkdir(DIR);
    await adapter.mkdir(`${DIR}/records`);
    for (let i = 0; i < 120; i++) {
      await adapter.write(`${DIR}/records/data_Note${i}.json`, JSON.stringify({ schema: 1, notePath: `Note${i}.md`, attachments: { [`a${i}.png`]: record(`Note${i}.md`) } }));
    }
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let inFlight = 0;
    let maxInFlight = 0;
    const read = adapter.read.bind(adapter);
    adapter.read = async (path: string) => {
      if (!path.includes("/records/")) return read(path);
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await gate;
      inFlight--;
      return read(path);
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const plugin = new BetterImagesPlugin(app as any, { id: "better-images", name: "x", version: "1", dir: DIR } as any);
    await plugin.saveData(SAVED);
    await plugin.onload(); // returns while the records are still being read
    expect(plugin.steward.store.count()).toBe(0);

    release();
    await plugin.steward.recordsLoaded;
    expect(plugin.steward.store.count()).toBe(120);
    expect(maxInFlight).toBeGreaterThan(1);
  });
});
