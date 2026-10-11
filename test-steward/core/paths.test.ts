import { describe, expect, it } from "vitest";
import { baseName, joinPath, nfc, parentPath, pathsEqual } from "../../src/steward/core/paths";

describe("joinPath", () => {
  it("joins non-empty segments with a single slash", () => {
    expect(joinPath("a", "b", "c")).toBe("a/b/c");
  });

  it("drops empty segments", () => {
    expect(joinPath("a", "", "c")).toBe("a/c");
    expect(joinPath("", "b")).toBe("b");
  });

  it("collapses accidental double slashes and trailing slash", () => {
    expect(joinPath("a/", "/b")).toBe("a/b");
  });
});

describe("parentPath / baseName", () => {
  it("splits a nested path", () => {
    expect(parentPath("a/b/c.png")).toBe("a/b");
    expect(baseName("a/b/c.png")).toBe("c.png");
  });

  it("handles a top-level path (no slash)", () => {
    expect(parentPath("c.png")).toBe("");
    expect(baseName("c.png")).toBe("c.png");
  });
});

describe("pathsEqual", () => {
  it("treats NFC and NFD forms of the same string as equal", () => {
    const nfcForm = "Кот́"; // "Кот" + combining acute accent, decomposed
    const nfcNormalized = nfcForm.normalize("NFC");
    expect(pathsEqual(nfcForm, nfcNormalized)).toBe(true);
    expect(nfc(nfcForm)).toBe(nfcNormalized);
  });

  it("is still sensitive to actually different paths", () => {
    expect(pathsEqual("a/b.png", "a/c.png")).toBe(false);
  });
});
