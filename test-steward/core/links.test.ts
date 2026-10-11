import { App, CachedMetadata } from "obsidian";
import { describe, expect, it } from "vitest";
import { allLinkedPaths, referencedAttachments } from "../../src/core/links";
import { DEFAULT_SETTINGS, Settings } from "../../src/settings/types";

function settings(overrides: Partial<Settings> = {}): Settings {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

describe("referencedAttachments", () => {
  it("resolves both embeds and links to real attachment files, ignoring markdown-to-markdown links", () => {
    const app = new App();
    const note = app.vault.seedFile("Note.md");
    const image = app.vault.seedFile("Attachments/photo.png");
    const pdf = app.vault.seedFile("Attachments/doc.pdf");
    const otherNote = app.vault.seedFile("Other.md");

    const cache: CachedMetadata = {
      embeds: [{ link: "photo.png" }],
      links: [{ link: "doc.pdf" }, { link: "Other" }],
    };

    const refs = referencedAttachments(app, note, cache, settings());
    expect(refs).toEqual(new Set([image.path, pdf.path]));
    expect(refs.has(otherNote.path)).toBe(false);
  });

  it("ignores external URLs", () => {
    const app = new App();
    const note = app.vault.seedFile("Note.md");
    const cache: CachedMetadata = { links: [{ link: "https://example.com/x.png" }] };
    expect(referencedAttachments(app, note, cache, settings())).toEqual(new Set());
  });

  it("strips a #heading or |alias suffix before resolving the link", () => {
    const app = new App();
    const note = app.vault.seedFile("Note.md");
    const pdf = app.vault.seedFile("doc.pdf");
    const cache: CachedMetadata = { links: [{ link: "doc.pdf#page=2|My doc" }] };
    expect(referencedAttachments(app, note, cache, settings())).toEqual(new Set([pdf.path]));
  });

  it("decodes a URI-encoded link (path-less markdown-style links from imports like Apple Notes)", () => {
    const app = new App();
    const note = app.vault.seedFile("Note.md");
    const file = app.vault.seedFile("Imported File.pdf");
    const cache: CachedMetadata = { links: [{ link: "Imported%20File.pdf" }] };
    expect(referencedAttachments(app, note, cache, settings())).toEqual(new Set([file.path]));
  });

  it("regression (76d36da): picks up frontmatter [[wikilinks]] only when scanFrontmatterLinks is on", () => {
    const app = new App();
    const note = app.vault.seedFile("Note.md");
    const file = app.vault.seedFile("cover.png");
    const cache: CachedMetadata = { frontmatterLinks: [{ link: "cover.png" }] };

    expect(referencedAttachments(app, note, cache, settings({ scanFrontmatterLinks: false }))).toEqual(new Set());
    expect(referencedAttachments(app, note, cache, settings({ scanFrontmatterLinks: true }))).toEqual(new Set([file.path]));
  });
});

describe("allLinkedPaths", () => {
  it("flattens metadataCache.resolvedLinks into a set of every linked-to destination", () => {
    const app = new App();
    app.metadataCache.resolvedLinks = {
      "A.md": { "img1.png": 1, "img2.png": 1 },
      "B.canvas": { "img2.png": 1, "doc.pdf": 1 },
    };
    expect(allLinkedPaths(app)).toEqual(new Set(["img1.png", "img2.png", "doc.pdf"]));
  });

  it("is empty when nothing links to anything", () => {
    const app = new App();
    expect(allLinkedPaths(app)).toEqual(new Set());
  });
});
