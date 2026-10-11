import { App, Modal, Notice } from "obsidian";
import { beforeEach, describe, expect, it } from "vitest";
import { findOrphansCommand } from "../../src/steward/commands/findOrphans";
import { OrphanReportModal } from "../../src/steward/ui/orphanReportModal";
import { DEFAULT_SETTINGS } from "../../src/steward/settings/types";

describe("findOrphansCommand", () => {
  beforeEach(() => {
    Notice.log = [];
    Modal.instances.length = 0;
  });

  it("reports nothing when every file under the folder is linked from somewhere", () => {
    const app = new App();
    app.vault.seedFile("Folder/linked.jpg");
    app.metadataCache.resolvedLinks = { "Note.md": { "Folder/linked.jpg": 1 } };
    const folder = app.vault.seedFolder("Folder");

    findOrphansCommand(app, DEFAULT_SETTINGS)(folder);
    expect(Notice.log.at(-1)).toContain("No unlinked attachments");
    expect(Modal.instances.length).toBe(0);
  });

  it("opens a report listing files with no resolved link pointing at them", () => {
    const app = new App();
    app.vault.seedFile("Folder/linked.jpg");
    app.vault.seedFile("Folder/orphan.jpg");
    app.metadataCache.resolvedLinks = { "Note.md": { "Folder/linked.jpg": 1 } };
    const folder = app.vault.seedFolder("Folder");

    findOrphansCommand(app, DEFAULT_SETTINGS)(folder);
    expect(Modal.instances.length).toBe(1);
    const modal = Modal.instances[0] as OrphanReportModal;
    expect((modal as unknown as { orphans: { path: string }[] })["orphans"].map((f) => f.path)).toEqual(["Folder/orphan.jpg"]);
  });

  it("excludes .md/.canvas/.base files from the orphan sweep even when unlinked", () => {
    const app = new App();
    app.vault.seedFile("Folder/Unlinked.md");
    const folder = app.vault.seedFolder("Folder");

    findOrphansCommand(app, DEFAULT_SETTINGS)(folder);
    expect(Notice.log.at(-1)).toContain("No unlinked attachments");
  });
});
