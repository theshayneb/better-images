import { App, TFile } from "obsidian";
import { describe, expect, it } from "vitest";
import { contextFor, resolveDestination, rootFolder } from "../../src/core/resolve";
import { DEFAULT_SETTINGS, Settings } from "../../src/settings/types";
import { AttachmentRecord } from "../../src/store/types";

function settings(overrides: Partial<Settings> = {}): Settings {
  return { ...DEFAULT_SETTINGS, extensionOverrides: [], excludedFolders: [], ...overrides };
}

function record(overrides: Partial<AttachmentRecord> = {}): AttachmentRecord {
  return {
    v: 1,
    originalName: "Photo",
    extension: "jpg",
    importedAt: 0,
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

describe("rootFolder", () => {
  it("vaultRoot is always empty", async () => {
    const app = new App();
    expect(await rootFolder(app, null, settings({ rootMode: "vaultRoot" }))).toBe("");
  });

  it("inFolderBelowRoot returns the configured root folder verbatim", async () => {
    const app = new App();
    expect(await rootFolder(app, null, settings({ rootMode: "inFolderBelowRoot", root: "_sources" }))).toBe("_sources");
  });

  it("nextToNote joins the note's own folder with the configured root", async () => {
    const app = new App();
    const note = app.vault.seedFile("Folder/Note.md");
    expect(await rootFolder(app, note, settings({ rootMode: "nextToNote", root: "_sources" }))).toBe("Folder/_sources");
  });

  it("obsidian mode delegates to fileManager.getAvailablePathForAttachment and takes its parent folder", async () => {
    const app = new App();
    const note = app.vault.seedFile("Folder/Note.md");
    app.fileManager.getAvailablePathForAttachment = async () => "Folder/Attachments/probe.bin";
    expect(await rootFolder(app, note, settings({ rootMode: "obsidian" }))).toBe("Folder/Attachments");
  });

  it("obsidian mode falls back to the note's own folder if the probe throws", async () => {
    const app = new App();
    const note = app.vault.seedFile("Folder/Note.md");
    app.fileManager.getAvailablePathForAttachment = async () => {
      throw new Error("boom");
    };
    expect(await rootFolder(app, note, settings({ rootMode: "obsidian" }))).toBe("Folder");
  });
});

describe("contextFor", () => {
  it("strips the .md extension from the note path but not from noteName", () => {
    const app = new App();
    const note = app.vault.seedFile("Folder/My Note.md");
    const ctx = contextFor(record(), note, settings());
    expect(ctx.notePath).toBe("Folder/My Note");
    expect(ctx.noteName).toBe("My Note");
  });

  it("renders empty note fields when there's no owning note", () => {
    const ctx = contextFor(record(), null, settings());
    expect(ctx.notePath).toBe("");
    expect(ctx.noteName).toBe("");
  });
});

describe("resolveDestination", () => {
  it("skips when the file already sits at the computed destination", async () => {
    const app = new App();
    const note = app.vault.seedFile("Folder/Note.md");
    const file = app.vault.seedFile("Folder/_sources/_attachments_Note/2024-01-01-Photo.jpg");
    const s = settings({ rootMode: "nextToNote", root: "_sources", pathTemplate: "_attachments_${notename}", formatTemplate: "${date}-${originalname}", dateFormat: "YYYY-MM-DD" });
    const rec = record({ importedAt: Date.UTC(2024, 0, 1) });

    const result = await resolveDestination(app, file, rec, note, s);
    expect(result.action).toBe("skip");
    expect(result.destPath).toBe(file.path);
  });

  it("moves to the templated destination when not already there", async () => {
    const app = new App();
    const note = app.vault.seedFile("Folder/Note.md");
    const file = app.vault.seedFile("Elsewhere/photo.jpg");
    const s = settings({ rootMode: "nextToNote", root: "_sources", pathTemplate: "_attachments_${notename}", formatTemplate: "${date}-${originalname}", dateFormat: "YYYY-MM-DD" });
    const rec = record({ importedAt: Date.UTC(2024, 0, 1) });

    const result = await resolveDestination(app, file, rec, note, s);
    expect(result.action).toBe("move");
    expect(result.destPath).toBe("Folder/_sources/_attachments_Note/2024-01-01-Photo.jpg");
  });

  it("dedupes against a real name collision by incrementing the suffix", async () => {
    const app = new App();
    const note = app.vault.seedFile("Folder/Note.md");
    app.vault.seedFile("Folder/_sources/_attachments_Note/2024-01-01-Photo.jpg"); // occupied by an unrelated file
    const file = app.vault.seedFile("Elsewhere/photo.jpg");
    const s = settings({ rootMode: "nextToNote", root: "_sources", pathTemplate: "_attachments_${notename}", formatTemplate: "${date}-${originalname}", dateFormat: "YYYY-MM-DD" });
    const rec = record({ importedAt: Date.UTC(2024, 0, 1) });

    const result = await resolveDestination(app, file, rec, note, s);
    expect(result.action).toBe("move");
    expect(result.destPath).toBe("Folder/_sources/_attachments_Note/2024-01-01-Photo-1.jpg");
    expect(result.dedupe).toBe(1);
  });

  it("keeps a previously-assigned dedupe suffix stable across a reapply instead of renumbering from 0", async () => {
    const app = new App();
    const note = app.vault.seedFile("Folder/Note.md");
    // The file itself already sits at the "-2" slot from a past dedupe.
    const file = app.vault.seedFile("Folder/_sources/_attachments_Note/2024-01-01-Photo-2.jpg");
    const s = settings({ rootMode: "nextToNote", root: "_sources", pathTemplate: "_attachments_${notename}", formatTemplate: "${date}-${originalname}", dateFormat: "YYYY-MM-DD" });
    const rec = record({ importedAt: Date.UTC(2024, 0, 1), dedupe: 2 });

    const result = await resolveDestination(app, file, rec, note, s);
    expect(result.action).toBe("skip");
    expect(result.dedupe).toBe(2);
  });

  it("does not treat the file's own current path as a collision with itself", async () => {
    const app = new App();
    const note = app.vault.seedFile("Folder/Note.md");
    const file = app.vault.seedFile("Folder/_sources/_attachments_Note/2024-01-01-Photo.jpg");
    // Settings changed since the file was placed, so the template now points elsewhere...
    const s = settings({ rootMode: "vaultRoot", root: "", pathTemplate: "_attachments_${notename}", formatTemplate: "${date}-${originalname}", dateFormat: "YYYY-MM-DD" });
    const rec = record({ importedAt: Date.UTC(2024, 0, 1) });

    const result = await resolveDestination(app, file, rec, note, s);
    expect(result.action).toBe("move");
    expect(result.destPath).toBe("_attachments_Note/2024-01-01-Photo.jpg");
  });
});
