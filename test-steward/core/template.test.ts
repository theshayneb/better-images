import { describe, expect, it } from "vitest";
import { formatDate, parseDate, render, sanitize, TemplateContext } from "../../src/core/template";

function ctx(overrides: Partial<TemplateContext> = {}): TemplateContext {
  return {
    originalName: "Photo",
    extension: "jpg",
    importedAt: 0,
    md5: "ABC123",
    notePath: "Folder/Sub/Note",
    noteName: "Note",
    noteParent: "Folder/Sub",
    dateFormat: "YYYY-MM-DD",
    ...overrides,
  };
}

describe("sanitize", () => {
  it("replaces slashes with a dash when slashes are not allowed", () => {
    expect(sanitize("a/b\\c", false)).toBe("a-b-c");
  });

  it("keeps forward slashes (as path separators) when allowed, normalizing backslashes", () => {
    expect(sanitize("a/b\\c", true)).toBe("a/b/c");
  });

  it("strips illegal filesystem characters", () => {
    expect(sanitize('a:b|c?d*e"f<g>h', false)).toBe("a-b-c-d-e-f-g-h");
  });

  it("collapses whitespace and trims", () => {
    expect(sanitize("  a   b  ", false)).toBe("a b");
  });

  it("strips trailing dots/spaces from each path segment", () => {
    expect(sanitize("folder. /name. ", true)).toBe("folder/name");
  });
});

describe("render", () => {
  it("renders every supported variable", () => {
    const out = render("${notename}-${originalname}-${md5}", ctx(), "filename");
    expect(out).toBe("Note-Photo-ABC123");
  });

  it("renders ${date} using the configured dateFormat, from importedAt not now", () => {
    const out = render("${date}", ctx({ importedAt: 0, dateFormat: "YYYY-MM-DD" }), "filename");
    expect(out).toBe(formatDate(0, "YYYY-MM-DD"));
  });

  it("only allows slashes through for ${notepath} in folder mode", () => {
    const withSlashes = render("${notepath}", ctx(), "folder");
    expect(withSlashes).toBe("Folder/Sub/Note");

    const flattened = render("${notepath}", ctx(), "filename");
    expect(flattened).toBe("Folder-Sub-Note");
  });

  it("does not let ${parent} inject slashes even in folder mode (only ${notepath} is special-cased)", () => {
    const out = render("${parent}", ctx({ noteParent: "A/B" }), "folder");
    expect(out).toBe("A-B");
  });

  it("leaves unknown ${...} tokens untouched (regex only matches the known variable names)", () => {
    expect(render("${unknown}", ctx(), "filename")).toBe("${unknown}");
  });

  it("sanitizes illegal characters coming from field values themselves", () => {
    const out = render("${originalname}", ctx({ originalName: 'weird:name?' }), "filename");
    expect(out).toBe("weird-name-");
  });
});

describe("formatDate / parseDate round-trip", () => {
  it("recovers the original epoch ms through an all-numeric format", () => {
    const ts = Date.UTC(2024, 5, 15, 10, 30, 0, 0);
    const rendered = formatDate(ts, "YYYY-MM-DD-HH_mm_ss_SSS");
    expect(parseDate(rendered, "YYYY-MM-DD-HH_mm_ss_SSS")).toBe(ts);
  });

  it("returns null for text that doesn't match the format at all", () => {
    expect(parseDate("not-a-date", "YYYY-MM-DD")).toBeNull();
  });
});
