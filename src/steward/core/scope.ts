import { App, TFile, TFolder } from "obsidian";

/** All markdown notes at or below `folder`, recursively. */
export function notesUnderFolder(app: App, folder: TFolder): TFile[] {
  const prefix = folder.isRoot() ? "" : folder.path + "/";
  return app.vault.getMarkdownFiles().filter((f) => f.path.startsWith(prefix));
}

/** Every file at or below `folder`, recursively (notes and attachments alike). */
export function filesUnderFolder(app: App, folder: TFolder): TFile[] {
  const out: TFile[] = [];
  const walk = (current: TFolder): void => {
    for (const child of current.children) {
      if (child instanceof TFile) out.push(child);
      else if (child instanceof TFolder) walk(child);
    }
  };
  walk(folder);
  return out;
}

/** True if `path` is at or below `folder`. */
export function isUnderFolder(path: string, folder: TFolder): boolean {
  const prefix = folder.isRoot() ? "" : folder.path + "/";
  return path.startsWith(prefix);
}
