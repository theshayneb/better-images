import { describe, expect, it } from "vitest";
import { App, Plugin } from "obsidian";
import { ensureAdapterFolder, ORPHANS_FILE, pluginDataDir, shardPath } from "../../src/store/shards";

function makePlugin(): Plugin {
  const app = new App();
  return new Plugin(app, { id: "attachment-steward", name: "Attachment Steward", version: "0.5.1", dir: ".obsidian/plugins/attachment-steward" });
}

describe("shardPath", () => {
  it("encodes a short/ASCII note path directly into the filename", () => {
    const plugin = makePlugin();
    const path = shardPath(plugin, "Folder/My Note.md");
    expect(path).toBe(".obsidian/plugins/attachment-steward/records/data_Folder%2FMy%20Note.json");
  });

  it("uses the shared orphans file for a null notePath", () => {
    const plugin = makePlugin();
    expect(shardPath(plugin, null)).toBe(`.obsidian/plugins/attachment-steward/records/${ORPHANS_FILE}`);
  });

  it("strips the .md extension before encoding, so a note rename to itself is a no-op key-wise", () => {
    const plugin = makePlugin();
    expect(shardPath(plugin, "Note.md")).toBe(shardPath(plugin, "Note.md"));
  });

  it("regression (afd173b): falls back to an MD5 hash once the encoded key would exceed the filesystem's filename limit", () => {
    const plugin = makePlugin();
    // Mirrors the real note path that triggered ENAMETOOLONG in production.
    const longNotePath = "Медицина/Vaccine/Archive/Информация о вакцинации после ЦБ Камилы.md";
    const path = shardPath(plugin, longNotePath);

    const filename = path.slice(path.lastIndexOf("/") + 1);
    expect(filename).toMatch(/^data_[0-9a-f]{32}\.json$/);
    expect(filename.length).toBeLessThan(255);
  });

  it("hash fallback is deterministic — the same note path always yields the same shard file", () => {
    const plugin = makePlugin();
    const longNotePath = "A".repeat(300);
    expect(shardPath(plugin, longNotePath)).toBe(shardPath(plugin, longNotePath));
  });

  it("hash fallback still varies with the note path (not a constant filename)", () => {
    const plugin = makePlugin();
    const a = shardPath(plugin, `${"A".repeat(300)}-one.md`);
    const b = shardPath(plugin, `${"A".repeat(300)}-two.md`);
    expect(a).not.toBe(b);
  });

  it("a short ASCII path never gets hashed, so existing shards for ordinary notes keep their filename across this change", () => {
    const plugin = makePlugin();
    expect(shardPath(plugin, "Notes/Groceries.md")).toContain("Notes%2FGroceries");
  });
});

describe("pluginDataDir", () => {
  it("uses the manifest's own dir when set", () => {
    expect(pluginDataDir(makePlugin())).toBe(".obsidian/plugins/attachment-steward");
  });

  it("falls back to vault configDir + manifest id when manifest.dir is unset", () => {
    const app = new App();
    const plugin = new Plugin(app, { id: "attachment-steward", name: "x", version: "1" });
    expect(pluginDataDir(plugin)).toBe(".obsidian/plugins/attachment-steward");
  });
});

describe("ensureAdapterFolder", () => {
  it("creates missing intermediate folders, and is a no-op if they already exist", async () => {
    const plugin = makePlugin();
    await ensureAdapterFolder(plugin.app, "a/b/c");
    expect(await plugin.app.vault.adapter.exists("a/b/c")).toBe(true);
    await expect(ensureAdapterFolder(plugin.app, "a/b/c")).resolves.not.toThrow();
  });

  it("is a no-op for an empty or root path", async () => {
    const plugin = makePlugin();
    await expect(ensureAdapterFolder(plugin.app, "")).resolves.not.toThrow();
    await expect(ensureAdapterFolder(plugin.app, "/")).resolves.not.toThrow();
  });
});
