import { describe, expect, it } from "vitest";
import { effectiveTemplates, findExtensionOverride, isExcludedByPath, isExcludedCoreExtension, matchesExtensionPattern, shouldManage } from "../../src/steward/core/filters";
import { DEFAULT_SETTINGS, Settings } from "../../src/steward/settings/types";

function settings(overrides: Partial<Settings> = {}): Settings {
  return { ...DEFAULT_SETTINGS, excludedFolders: [], extensionOverrides: [], ...overrides };
}

describe("isExcludedCoreExtension", () => {
  it("excludes md/canvas/base by default", () => {
    const s = settings();
    expect(isExcludedCoreExtension("md", s)).toBe(true);
    expect(isExcludedCoreExtension("canvas", s)).toBe(true);
    expect(isExcludedCoreExtension("base", s)).toBe(true);
  });

  it("is case-insensitive and respects the per-extension toggle", () => {
    const s = settings({ excludedCoreExtensions: { md: true, canvas: true, base: false } });
    expect(isExcludedCoreExtension("BASE", s)).toBe(false);
  });

  it("does not touch extensions outside the core set", () => {
    expect(isExcludedCoreExtension("jpg", settings())).toBe(false);
  });

  it("regression (96dea0c): .base files are excluded like .md/.canvas, not treated as regular attachments", () => {
    const s = settings();
    expect(shouldManage("base", "Any/Folder", s)).toBe(false);
  });
});

describe("matchesExtensionPattern", () => {
  it("matches a single extension", () => {
    expect(matchesExtensionPattern("pdf", "pdf")).toBe(true);
    expect(matchesExtensionPattern("png", "pdf")).toBe(false);
  });

  it("regression (68a3d3d): matches several extensions via one regex alternation", () => {
    expect(matchesExtensionPattern("jpeg", "jpe?g|png|gif|webp")).toBe(true);
    expect(matchesExtensionPattern("jpg", "jpe?g|png|gif|webp")).toBe(true);
    expect(matchesExtensionPattern("webp", "jpe?g|png|gif|webp")).toBe(true);
    expect(matchesExtensionPattern("pdf", "jpe?g|png|gif|webp")).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(matchesExtensionPattern("PNG", "png")).toBe(true);
  });

  it("is anchored — a pattern for 'p' must not match 'pdf'", () => {
    expect(matchesExtensionPattern("pdf", "p")).toBe(false);
  });

  it("fails open (no match) on an invalid regex instead of throwing", () => {
    expect(() => matchesExtensionPattern("pdf", "(unclosed")).not.toThrow();
    expect(matchesExtensionPattern("pdf", "(unclosed")).toBe(false);
  });

  it("treats a blank pattern as matching nothing", () => {
    expect(matchesExtensionPattern("pdf", "")).toBe(false);
    expect(matchesExtensionPattern("pdf", "   ")).toBe(false);
  });
});

describe("isExcludedByPath", () => {
  it("matches the exact folder", () => {
    expect(isExcludedByPath("Attachments", [{ path: "Attachments", includeSubpaths: false }])).toBe(true);
  });

  it("only matches subfolders when includeSubpaths is set", () => {
    const folders = [{ path: "Attachments", includeSubpaths: false }];
    expect(isExcludedByPath("Attachments/Sub", folders)).toBe(false);
    expect(isExcludedByPath("Attachments/Sub", [{ path: "Attachments", includeSubpaths: true }])).toBe(true);
  });

  it("does not match a sibling folder with a shared prefix", () => {
    // "Attachments2" starts with "Attachments" as a raw string but is not a subpath of it.
    expect(isExcludedByPath("Attachments2", [{ path: "Attachments", includeSubpaths: true }])).toBe(false);
  });
});

describe("findExtensionOverride / effectiveTemplates", () => {
  it("falls back to the global templates when no override matches", () => {
    const s = settings({ pathTemplate: "GLOBAL_PATH", formatTemplate: "GLOBAL_FMT" });
    expect(effectiveTemplates("pdf", s)).toEqual({ pathTemplate: "GLOBAL_PATH", formatTemplate: "GLOBAL_FMT" });
  });

  it("uses the matching override's templates", () => {
    const s = settings({
      pathTemplate: "GLOBAL_PATH",
      formatTemplate: "GLOBAL_FMT",
      extensionOverrides: [{ extension: "pdf", pathTemplate: "PDF_PATH", formatTemplate: "PDF_FMT" }],
    });
    expect(findExtensionOverride("pdf", s.extensionOverrides)?.pathTemplate).toBe("PDF_PATH");
    expect(effectiveTemplates("pdf", s)).toEqual({ pathTemplate: "PDF_PATH", formatTemplate: "PDF_FMT" });
  });

  it("falls back to the global template when an override leaves a field blank", () => {
    const s = settings({
      pathTemplate: "GLOBAL_PATH",
      formatTemplate: "GLOBAL_FMT",
      extensionOverrides: [{ extension: "pdf", pathTemplate: "", formatTemplate: "PDF_FMT" }],
    });
    expect(effectiveTemplates("pdf", s).pathTemplate).toBe("GLOBAL_PATH");
  });
});

describe("shouldManage", () => {
  it("manages a plain attachment by default", () => {
    expect(shouldManage("jpg", "Some/Folder", settings())).toBe(true);
  });

  it("does not manage an excluded extension pattern", () => {
    expect(shouldManage("pdf", "Some/Folder", settings({ excludeExtensionPattern: "pdf" }))).toBe(false);
  });

  it("does not manage a file under an excluded folder", () => {
    const s = settings({ excludedFolders: [{ path: "Vault/Keep", includeSubpaths: true }] });
    expect(shouldManage("jpg", "Vault/Keep/Sub", s)).toBe(false);
  });
});
