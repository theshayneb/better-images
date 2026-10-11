import { App, Modal, Notice, Plugin, Setting } from "obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { repairStampedNamesCommand } from "../../src/steward/commands/repair";
import { formatDate } from "../../src/steward/core/template";
import { InternalMoveTracker } from "../../src/steward/engine/organizer";
import { DEFAULT_SETTINGS, Settings } from "../../src/steward/settings/types";
import { Store } from "../../src/steward/store/store";
import { AttachmentRecord } from "../../src/steward/store/types";

const FORMAT = "${date}-${originalname}";
const DATE_FORMAT = "YYYY-MM-DD-HH_mm_ss_SSS"; // full precision, so the recovered importedAt round-trips exactly

function settings(overrides: Partial<Settings> = {}): Settings {
  return {
    ...DEFAULT_SETTINGS,
    rootMode: "vaultRoot",
    root: "",
    pathTemplate: "",
    formatTemplate: FORMAT,
    dateFormat: DATE_FORMAT,
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
    importedAt: 111,
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

describe("repairStampedNamesCommand", () => {
  beforeEach(() => {
    Notice.log = [];
    Modal.instances.length = 0;
    Setting.instances.length = 0;
  });

  it("reports nothing to repair when no originalName looks stamped", async () => {
    const { app, store, internalMoves } = setup();
    app.vault.seedFile("a.jpg");
    store.set("a.jpg", record({ originalName: "Photo" }));

    await repairStampedNamesCommand(app, store, internalMoves)();
    expect(Notice.log.at(-1)).toContain("No stamped names");
    expect(Modal.instances.length).toBe(0);
  });

  it("regression (repair command for 7e8257c damage): unstamps a corrupted originalName and moves the file to the corrected destination on confirm", async () => {
    const { app, store, internalMoves } = setup();
    const damagedStamp = `${formatDate(222, DATE_FORMAT)}-Vacation Photo`; // a date got baked into the "frozen" original name itself
    const file = app.vault.seedFile("wrong-name.jpg");
    store.set(file.path, record({ originalName: damagedStamp, importedAt: 111 }));

    const promise = repairStampedNamesCommand(app, store, internalMoves)();
    await vi.waitFor(() => expect(Modal.instances.length).toBe(1));
    await apply();
    await promise;

    const rec = store.get(file.path);
    expect(rec?.originalName).toBe("Vacation Photo");
    expect(rec?.importedAt).toBe(222); // recovered from the stamp, not left at the old frozen value
    expect(file.path).toBe(`${formatDate(222, DATE_FORMAT)}-Vacation Photo.jpg`);
  });

  it("leaves an unaffected record's originalName untouched", async () => {
    const { app, store, internalMoves } = setup();
    app.vault.seedFile("a.jpg");
    store.set("a.jpg", record({ originalName: "Perfectly Normal Name" }));

    await repairStampedNamesCommand(app, store, internalMoves)();
    expect(store.get("a.jpg")?.originalName).toBe("Perfectly Normal Name");
  });
});
