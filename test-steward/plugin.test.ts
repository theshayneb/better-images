import { App } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import BetterImagesPlugin from "../src/main";

const DIR = ".obsidian/plugins/better-images";

async function loadPlugin(app: App, savedData: unknown = null): Promise<BetterImagesPlugin> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const plugin = new BetterImagesPlugin(app as any, { id: "better-images", name: "Better Images & Attachments", version: "1", dir: DIR } as any);
  if (savedData) await plugin.saveData(savedData);
  await plugin.onload();
  return plugin;
}

async function installAttachmentSteward(app: App, settings: Record<string, unknown>): Promise<void> {
  const { adapter } = app.vault;
  for (const dir of [".obsidian/plugins", DIR, ".obsidian/plugins/attachment-steward"]) await adapter.mkdir(dir);
  await adapter.write(".obsidian/plugins/attachment-steward/manifest.json", JSON.stringify({ id: "attachment-steward" }));
  await adapter.write(".obsidian/plugins/attachment-steward/data.json", JSON.stringify({ schema: 2, settings }));
}

describe("the whole plugin organizes a pasted image", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2024, 0, 1));
  });
  afterEach(() => vi.useRealTimers());

  it("moves a new image linked from a note, with default settings", async () => {
    const app = new App();
    await loadPlugin(app);
    const note = app.vault.seedFile("Folder/Note.md");
    app.metadataCache.resolvedLinks = { [note.path]: { "Folder/Pasted image.png": 1 } };

    app.vault.simulateCreate("Folder/Pasted image.png");
    await vi.advanceTimersByTimeAsync(3000);

    expect(app.vault.getAbstractFileByPath("Folder/Pasted image.png")).toBeNull();
  });

  it("uses settings imported from Attachment Steward", async () => {
    const app = new App();
    await installAttachmentSteward(app, { rootMode: "inFolderBelowRoot", root: "Attachments", pathTemplate: "", formatTemplate: "${originalname}" });
    await loadPlugin(app);
    const note = app.vault.seedFile("Folder/Note.md");
    app.metadataCache.resolvedLinks = { [note.path]: { "Folder/cat.png": 1 } };

    app.vault.simulateCreate("Folder/cat.png");
    await vi.advanceTimersByTimeAsync(3000);

    expect(app.vault.getAbstractFileByPath("Folder/cat.png")).toBeNull();
  });

  it("still imports when upgrading from 1.0.0, which saved default attachment settings", async () => {
    const app = new App();
    await installAttachmentSteward(app, { root: "Imported" });
    const plugin = await loadPlugin(app, { enableImageCaptions: false, attachmentSteward: { schema: 2, settings: { root: "_sources" } } });
    expect(plugin.steward.store.settings.root).toBe("Imported");

    // Only once: a later restart keeps whatever is saved now.
    plugin.steward.store.settings.root = "Changed later";
    await plugin.steward.store.saveNow();
    const saved = await plugin.loadData();
    const again = await loadPlugin(app, saved);
    expect(again.steward.store.settings.root).toBe("Changed later");
  });
});
