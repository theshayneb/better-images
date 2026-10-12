import { App, Notice, setRequestUrlHandler, TFile } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CoverDownloader } from "../src/covers/CoverDownloader";
import { coverBaseName, imageExtension, sanitizeFileName } from "../src/covers/names";
import BetterImagesPlugin from "../src/main";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]).buffer;
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).buffer;
const HTML = new TextEncoder().encode("<!doctype html><html></html>").buffer;

function serve(files: Record<string, { body: ArrayBuffer; type?: string }>) {
  const calls: string[] = [];
  setRequestUrlHandler(async ({ url }) => {
    calls.push(url);
    const file = files[url];
    if (!file) return { status: 404, headers: {}, arrayBuffer: new ArrayBuffer(0) };
    return { status: 200, headers: { "Content-Type": file.type ?? "application/octet-stream" }, arrayBuffer: file.body };
  });
  return calls;
}

function note(app: App, path: string, frontmatter: Record<string, unknown>, tags: string[] = []): TFile {
  const file = app.vault.seedFile(path);
  app.metadataCache.setFileCache(file, { frontmatter, tags: tags.map((tag) => ({ tag })) });
  return file;
}

describe("cover names", () => {
  it("uses the note name, or the album for #song notes", () => {
    expect(coverBaseName("Dune", { Image: "x" }, [])).toEqual({ name: "Dune", shared: false });
    expect(coverBaseName("Love by The Beatles", { Album: "Beatles Album2" }, ["#song"])).toEqual({ name: "Beatles Album2", shared: true });
    expect(coverBaseName("Love", { album: "[[Abbey Road|AR]]" }, ["#song/rock"])).toEqual({ name: "Abbey Road", shared: true });
    expect(coverBaseName("Love", { Album: "" }, ["#song"])).toEqual({ name: "Love", shared: false });
    expect(coverBaseName("Love", { Album: "Help!" }, ["#songs"])).toEqual({ name: "Love", shared: false });
  });

  it("makes names safe for every platform", () => {
    expect(sanitizeFileName('AC/DC: "Live"?')).toBe("AC-DC- -Live--");
    expect(sanitizeFileName("  .hidden. ")).toBe("hidden");
  });

  it("recognizes images by their bytes and rejects web pages", () => {
    expect(imageExtension(new Uint8Array(JPEG), "application/octet-stream", "https://x/a")).toBe("jpg");
    expect(imageExtension(new Uint8Array(PNG), "image/jpeg", "https://x/a.jpg")).toBe("png");
    expect(imageExtension(new Uint8Array(HTML), "text/html", "https://x/a.jpg")).toBeNull();
    expect(imageExtension(new Uint8Array([1, 2, 3]), "image/webp", "https://x/a")).toBe("webp");
  });
});

describe("CoverDownloader", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("saves Image and WideImage next to the note and links the properties to them", async () => {
    const app = new App();
    serve({ "https://img/cover": { body: JPEG }, "https://img/wide.png": { body: PNG, type: "image/png" } });
    const dune = note(app, "Media/Books/Dune.md", { Image: "https://img/cover", WideImage: "https://img/wide.png" });

    const result = await new CoverDownloader(app).processNote(dune);

    expect(result.errors).toEqual([]);
    expect(app.vault.getAbstractFileByPath("Media/Books/Images/Dune.jpg")).toBeInstanceOf(TFile);
    expect(app.vault.getAbstractFileByPath("Media/Books/Images/Dune-wide.png")).toBeInstanceOf(TFile);
    expect(app.metadataCache.getFileCache(dune)?.frontmatter).toMatchObject({ Image: "[[Dune.jpg]]", WideImage: "[[Dune-wide.png]]" });
  });

  it("names song covers after the album and downloads each album only once", async () => {
    const app = new App();
    const calls = serve({ "https://img/a": { body: JPEG }, "https://img/b": { body: PNG } });
    const love = note(app, "Music/Love.md", { Image: "https://img/a", Album: "Beatles Album2" }, ["#song"]);
    const help = note(app, "Music/Help.md", { Image: "https://img/b", Album: "Beatles Album2" }, ["#song"]);
    const downloader = new CoverDownloader(app);

    await downloader.processNote(love);
    await downloader.processNote(help);

    expect(calls).toEqual(["https://img/a"]);
    expect(app.vault.getAbstractFileByPath("Music/Images/Beatles Album2.jpg")).toBeInstanceOf(TFile);
    expect(app.metadataCache.getFileCache(help)?.frontmatter?.Image).toBe("[[Beatles Album2.jpg]]");
  });

  it("replaces an existing cover of a non-song note", async () => {
    const app = new App();
    serve({ "https://img/new": { body: JPEG } });
    const old = app.vault.seedFile("Books/Images/Dune.jpg", { content: new ArrayBuffer(1) });
    const dune = note(app, "Books/Dune.md", { Image: "https://img/new" });

    await new CoverDownloader(app).processNote(dune);

    expect(old._content.byteLength).toBe(JPEG.byteLength);
  });

  it("shows progress while downloading several notes, then a summary", async () => {
    const app = new App();
    serve({ "https://img/a": { body: JPEG }, "https://img/b": { body: PNG } });
    note(app, "Books/Dune.md", { Image: "https://img/a" });
    note(app, "Books/Emma.md", { Image: "https://img/b" });
    note(app, "Books/Plain.md", { Title: "no cover" });
    Notice.log = [];

    await new CoverDownloader(app).processNotes(app.vault.getMarkdownFiles());

    expect(Notice.log).toEqual([
      "Downloading covers for 2 notes…",
      "Downloading covers for 2 notes… (1 done)",
      "Saved cover: 2 images",
    ]);
  });

  it("leaves the property alone when the link isn't an image", async () => {
    const app = new App();
    serve({ "https://site/page": { body: HTML, type: "text/html" } });
    const dune = note(app, "Books/Dune.md", { Image: "https://site/page" });

    const result = await new CoverDownloader(app).processNote(dune);

    expect(result.errors).toHaveLength(1);
    expect(app.metadataCache.getFileCache(dune)?.frontmatter?.Image).toBe("https://site/page");
    expect(app.vault.getAbstractFileByPath("Books/Images/Dune.jpg")).toBeNull();
  });
});

describe("covers and the attachment organizer", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("doesn't move or rename a downloaded cover, even with frontmatter links scanned", async () => {
    const app = new App();
    serve({ "https://img/cover": { body: JPEG } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const plugin = new BetterImagesPlugin(app as any, { id: "better-images", name: "x", version: "1", dir: ".obsidian/plugins/better-images" } as any);
    await plugin.saveData({ attachmentStewardImportChecked: true, attachmentSteward: { schema: 2, settings: { scanFrontmatterLinks: true } } });
    await plugin.onload();
    const dune = note(app, "Books/Dune.md", { Image: "https://img/cover" });

    await plugin.covers.processNote(dune);
    const cover = app.vault.getAbstractFileByPath("Books/Images/Dune.jpg") as TFile;
    app.metadataCache.setFileCache(dune, { frontmatter: { Image: "[[Dune.jpg]]" }, frontmatterLinks: [{ key: "Image", link: "Dune.jpg" }] });
    app.metadataCache.resolvedLinks = { [dune.path]: { [cover.path]: 1 } };
    app.metadataCache.trigger("changed", dune, "", app.metadataCache.getFileCache(dune));
    await vi.advanceTimersByTimeAsync(15000);

    expect(app.vault.getAbstractFileByPath("Books/Images/Dune.jpg")).toBe(cover);
    expect(plugin.steward.store.has(cover.path)).toBe(false);
  });
});
