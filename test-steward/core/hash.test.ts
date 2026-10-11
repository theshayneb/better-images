import { App } from "obsidian";
import { describe, expect, it } from "vitest";
import { computeMd5, ensureRecordHash, hashMatchesCache } from "../../src/steward/core/hash";
import { DEFAULT_SETTINGS, Settings } from "../../src/steward/settings/types";
import { AttachmentRecord } from "../../src/steward/store/types";

function settings(overrides: Partial<Settings> = {}): Settings {
  return { ...DEFAULT_SETTINGS, extensionOverrides: [], ...overrides };
}

function record(overrides: Partial<AttachmentRecord> = {}): AttachmentRecord {
  return {
    v: 1,
    originalName: "Photo",
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

function textBuffer(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer as ArrayBuffer;
}

describe("computeMd5", () => {
  it("hashes the file's binary content and captures its stat", async () => {
    const app = new App();
    const file = app.vault.seedFile("a.jpg", { content: textBuffer("hello"), size: 5, mtime: 123 });
    const result = await computeMd5(app, file);
    expect(result.md5).toBe(result.md5.toUpperCase()); // uppercase, for legacy-plugin table compatibility
    expect(result.meta).toEqual({ size: 5, mtime: 123 });
  });

  it("is deterministic for the same content", async () => {
    const app = new App();
    const f1 = app.vault.seedFile("a.jpg", { content: textBuffer("same content") });
    const f2 = app.vault.seedFile("b.jpg", { content: textBuffer("same content") });
    expect((await computeMd5(app, f1)).md5).toBe((await computeMd5(app, f2)).md5);
  });
});

describe("hashMatchesCache", () => {
  it("is false with no cached meta", () => {
    const app = new App();
    const file = app.vault.seedFile("a.jpg", { size: 5, mtime: 1 });
    expect(hashMatchesCache(file, null)).toBe(false);
  });

  it("is true only when both size and mtime match", () => {
    const app = new App();
    const file = app.vault.seedFile("a.jpg", { size: 5, mtime: 1 });
    expect(hashMatchesCache(file, { size: 5, mtime: 1 })).toBe(true);
    expect(hashMatchesCache(file, { size: 5, mtime: 2 })).toBe(false);
    expect(hashMatchesCache(file, { size: 6, mtime: 1 })).toBe(false);
  });
});

describe("ensureRecordHash", () => {
  it("skips computing md5 entirely when no active template references ${md5} (avoids needless file reads)", async () => {
    const app = new App();
    const file = app.vault.seedFile("a.jpg", { content: textBuffer("x") });
    const rec = record();
    const s = settings({ pathTemplate: "${notename}", formatTemplate: "${originalname}" });
    const changed = await ensureRecordHash(app, file, rec, s);
    expect(changed).toBe(false);
    expect(rec.md5).toBeNull();
  });

  it("computes and caches md5 when the format template references it", async () => {
    const app = new App();
    const file = app.vault.seedFile("a.jpg", { content: textBuffer("x"), size: 1, mtime: 1 });
    const rec = record();
    const s = settings({ formatTemplate: "${md5}" });
    const changed = await ensureRecordHash(app, file, rec, s);
    expect(changed).toBe(true);
    expect(rec.md5).not.toBeNull();
    expect(rec.md5For).toEqual({ size: 1, mtime: 1 });
  });

  it("does not recompute when the cached hash still matches the file's current stat", async () => {
    const app = new App();
    const file = app.vault.seedFile("a.jpg", { content: textBuffer("x"), size: 1, mtime: 1 });
    const rec = record({ md5: "CACHED", md5For: { size: 1, mtime: 1 } });
    const s = settings({ formatTemplate: "${md5}" });
    const changed = await ensureRecordHash(app, file, rec, s);
    expect(changed).toBe(false);
    expect(rec.md5).toBe("CACHED");
  });

  it("recomputes when the file's stat has moved on since the cached hash", async () => {
    const app = new App();
    const file = app.vault.seedFile("a.jpg", { content: textBuffer("new content"), size: 11, mtime: 2 });
    const rec = record({ md5: "STALE", md5For: { size: 1, mtime: 1 } });
    const s = settings({ formatTemplate: "${md5}" });
    const changed = await ensureRecordHash(app, file, rec, s);
    expect(changed).toBe(true);
    expect(rec.md5).not.toBe("STALE");
  });

  it("checks the extension override's own templates, not just the global ones", async () => {
    const app = new App();
    const file = app.vault.seedFile("a.pdf", { content: textBuffer("x") });
    const rec = record({ extension: "pdf" });
    const s = settings({
      formatTemplate: "${originalname}",
      extensionOverrides: [{ extension: "pdf", pathTemplate: "${notename}", formatTemplate: "${md5}" }],
    });
    const changed = await ensureRecordHash(app, file, rec, s);
    expect(changed).toBe(true);
  });
});
