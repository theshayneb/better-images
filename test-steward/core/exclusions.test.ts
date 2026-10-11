import { describe, expect, it } from "vitest";
import { addExcludedFolder, isFolderListed, removeExcludedFolder, renameExcludedFolders } from "../../src/steward/core/exclusions";
import { DEFAULT_SETTINGS, Settings } from "../../src/steward/settings/types";

function settings(): Settings {
  return { ...DEFAULT_SETTINGS, excludedFolders: [] };
}

describe("addExcludedFolder / removeExcludedFolder / isFolderListed", () => {
  it("adds a folder with subpaths included by default, and doesn't duplicate it", () => {
    const s = settings();
    addExcludedFolder(s, "Vault/Keep");
    addExcludedFolder(s, "Vault/Keep");
    expect(s.excludedFolders).toEqual([{ path: "Vault/Keep", includeSubpaths: true }]);
    expect(isFolderListed(s.excludedFolders, "Vault/Keep")).toBe(true);
  });

  it("removes only the exact folder listed", () => {
    const s = settings();
    addExcludedFolder(s, "A");
    addExcludedFolder(s, "B");
    removeExcludedFolder(s, "A");
    expect(s.excludedFolders.map((f) => f.path)).toEqual(["B"]);
  });
});

describe("renameExcludedFolders", () => {
  it("updates an exact match", () => {
    const s = settings();
    s.excludedFolders.push({ path: "Old", includeSubpaths: true });
    const changed = renameExcludedFolders(s, "Old", "New");
    expect(changed).toBe(true);
    expect(s.excludedFolders[0].path).toBe("New");
  });

  it("updates a folder nested inside the renamed one", () => {
    const s = settings();
    s.excludedFolders.push({ path: "Old/Nested", includeSubpaths: true });
    renameExcludedFolders(s, "Old", "New");
    expect(s.excludedFolders[0].path).toBe("New/Nested");
  });

  it("does not touch an unrelated folder with a shared prefix", () => {
    const s = settings();
    s.excludedFolders.push({ path: "OldStuff", includeSubpaths: true });
    const changed = renameExcludedFolders(s, "Old", "New");
    expect(changed).toBe(false);
    expect(s.excludedFolders[0].path).toBe("OldStuff");
  });

  it("reports no change when nothing matches", () => {
    const s = settings();
    s.excludedFolders.push({ path: "Unrelated", includeSubpaths: true });
    expect(renameExcludedFolders(s, "Old", "New")).toBe(false);
  });
});
