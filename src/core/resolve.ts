import { App, normalizePath, TFile } from "obsidian";
import { Settings } from "../settings/types";
import { AttachmentRecord } from "../store/types";
import { effectiveTemplates } from "./filters";
import { joinPath, parentPath, pathsEqual } from "./paths";
import { render, TemplateContext } from "./template";

function stripExtension(path: string): string {
  const idx = path.lastIndexOf(".");
  return idx <= 0 ? path : path.slice(0, idx);
}

export function contextFor(record: AttachmentRecord, note: TFile | null, settings: Settings): TemplateContext {
  return {
    originalName: record.originalName,
    extension: record.extension,
    importedAt: record.importedAt,
    md5: record.md5 ?? "",
    notePath: note ? stripExtension(note.path) : "",
    noteName: note?.basename ?? "",
    noteParent: note?.parent?.path ?? "",
    dateFormat: settings.dateFormat,
  };
}

/**
 * Where the managed folder root sits for a given note, per rootMode.
 * `obsidian` uses the documented FileManager.getAvailablePathForAttachment
 * probe (async) rather than the internal/undocumented
 * Vault.getConfig("attachmentFolderPath").
 */
export async function rootFolder(app: App, note: TFile | null, settings: Settings): Promise<string> {
  switch (settings.rootMode) {
    case "vaultRoot":
      return "";
    case "inFolderBelowRoot":
      return settings.root;
    case "nextToNote":
      return joinPath(note?.parent?.path ?? "", settings.root);
    case "obsidian":
      try {
        const probe = await app.fileManager.getAvailablePathForAttachment("__ao_probe__.bin", note?.path ?? "");
        return parentPath(probe);
      } catch {
        return note?.parent?.path ?? "";
      }
  }
}

export interface ResolveResult {
  action: "skip" | "move";
  destPath: string;
  dedupe: number;
}

/**
 * Computes where `file` should live under current settings, using ONLY the
 * frozen record (originalName/importedAt) — never the file's current name —
 * so calling this twice in a row with no settings change is a no-op.
 */
export async function resolveDestination(app: App, file: TFile, record: AttachmentRecord, note: TFile | null, settings: Settings): Promise<ResolveResult> {
  const { pathTemplate, formatTemplate } = effectiveTemplates(record.extension, settings);
  const ctx = contextFor(record, note, settings);

  const root = await rootFolder(app, note, settings);
  const folder = normalizePath(joinPath(root, render(pathTemplate, ctx, "folder")));
  const base = render(formatTemplate, ctx, "filename");
  const nameWithSuffix = (n: number) => (n > 0 ? `${base}-${n}` : base);

  let n = record.dedupe;
  let destPath = normalizePath(joinPath(folder, `${nameWithSuffix(n)}.${record.extension}`));

  if (pathsEqual(file.path, destPath)) {
    return { action: "skip", destPath, dedupe: n };
  }

  // Walk up from the previously-chosen suffix so a deduped file keeps its
  // number across reapplies instead of renumbering.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const existing = app.vault.getAbstractFileByPath(destPath);
    if (!existing || pathsEqual(existing.path, file.path)) break;
    n += 1;
    destPath = normalizePath(joinPath(folder, `${nameWithSuffix(n)}.${record.extension}`));
  }

  return { action: "move", destPath, dedupe: n };
}
