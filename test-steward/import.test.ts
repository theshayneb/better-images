import { App, Plugin } from "obsidian";
import { describe, expect, it } from "vitest";
import { findAttachmentStewardFolder, importAttachmentSteward } from "../src/steward/import";
import { Store } from "../src/steward/store/store";

const OWN_DIR = ".obsidian/plugins/better-images";
const STEWARD_DIR = ".obsidian/plugins/attachment-steward";

async function setup(): Promise<{ app: App; plugin: Plugin }> {
  const app = new App();
  const plugin = new Plugin(app, { id: "better-images", name: "Better Images & Attachments", version: "1", dir: OWN_DIR });
  const { adapter } = app.vault;
  // The fake adapter only lists folders that were created explicitly.
  for (const dir of [".obsidian/plugins", OWN_DIR, STEWARD_DIR, `${OWN_DIR}/records`, `${STEWARD_DIR}/records`]) await adapter.mkdir(dir);
  await adapter.write(`${OWN_DIR}/manifest.json`, JSON.stringify({ id: "better-images" }));
  await adapter.write(`${STEWARD_DIR}/manifest.json`, JSON.stringify({ id: "attachment-steward" }));
  await adapter.write(
    `${STEWARD_DIR}/data.json`,
    JSON.stringify({ schema: 2, settings: { root: "Files", formatTemplate: "${originalname}" } })
  );
  await adapter.write(
    `${STEWARD_DIR}/records/data_Note.json`,
    JSON.stringify({
      schema: 1,
      notePath: "Note.md",
      attachments: {
        "Files/cat.png": { v: 1, originalName: "cat", extension: "png", importedAt: 1, notePath: "Note.md", md5: null, md5For: null, dedupe: 0, applied: null, managed: true, source: "created" },
      },
    })
  );
  return { app, plugin };
}

describe("importing from Attachment Steward", () => {
  it("finds the installed plugin by id, skipping this plugin's own folder", async () => {
    const { app } = await setup();
    expect(await findAttachmentStewardFolder(app, OWN_DIR)).toBe(STEWARD_DIR);
  });

  it("finds nothing when Attachment Steward has no saved settings", async () => {
    const { app } = await setup();
    await app.vault.adapter.remove(`${STEWARD_DIR}/data.json`);
    expect(await findAttachmentStewardFolder(app, OWN_DIR)).toBeNull();
  });

  it("copies settings and records, replacing existing records, so the store loads them", async () => {
    const { app, plugin } = await setup();
    await app.vault.adapter.write(`${OWN_DIR}/records/data_Stale.json`, "{}");

    const { data, records } = await importAttachmentSteward(plugin, STEWARD_DIR);
    expect(records).toBe(1);
    expect(await app.vault.adapter.exists(`${OWN_DIR}/records/data_Stale.json`)).toBe(false);

    await plugin.saveData(data);
    const store = new Store(plugin);
    await store.load();
    expect(store.settings.root).toBe("Files");
    expect(store.settings.formatTemplate).toBe("${originalname}");
    expect(store.get("Files/cat.png")?.originalName).toBe("cat");
  });
});
