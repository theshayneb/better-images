import { ExcludedFolder, Settings } from "../settings/types";

/** Exact membership — is `path` itself one of the listed folders (not "is it covered by one"). */
export function isFolderListed(excludedFolders: ExcludedFolder[], path: string): boolean {
  return excludedFolders.some((f) => f.path === path);
}

export function addExcludedFolder(settings: Settings, path: string): void {
  if (isFolderListed(settings.excludedFolders, path)) return;
  settings.excludedFolders.push({ path, includeSubpaths: true });
}

export function removeExcludedFolder(settings: Settings, path: string): void {
  const index = settings.excludedFolders.findIndex((f) => f.path === path);
  if (index >= 0) settings.excludedFolders.splice(index, 1);
}

/**
 * Keeps excluded-folder entries pointing at the right place when a folder is
 * renamed or moved — both the folder itself (exact match) and any excluded
 * folder nested inside it (prefix match). Returns whether anything changed,
 * so the caller only schedules a save when it actually needs to.
 */
export function renameExcludedFolders(settings: Settings, oldPath: string, newPath: string): boolean {
  let changed = false;
  for (const folder of settings.excludedFolders) {
    if (folder.path === oldPath) {
      folder.path = newPath;
      changed = true;
    } else if (folder.path.startsWith(oldPath + "/")) {
      folder.path = newPath + folder.path.slice(oldPath.length);
      changed = true;
    }
  }
  return changed;
}
