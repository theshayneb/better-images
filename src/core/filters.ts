import { ExcludedFolder, ExtensionOverride, Settings } from "../settings/types";

/** Never manage notes/canvases themselves — only their attachments. */
export const MANAGED_BLOCKLIST_EXTENSIONS = new Set(["md", "canvas"]);

export function isExcludedByExtension(extension: string, pattern: string): boolean {
  const trimmed = pattern.trim();
  if (!trimmed) return false;
  try {
    const re = new RegExp(`^(${trimmed})$`, "i");
    return re.test(extension);
  } catch {
    // Invalid regex from the settings UI — fail open (don't exclude anything)
    // rather than throw during a vault event handler.
    return false;
  }
}

export function isExcludedByPath(parentFolderPath: string, excludedFolders: ExcludedFolder[]): boolean {
  for (const folder of excludedFolders) {
    if (parentFolderPath === folder.path) return true;
    if (folder.includeSubpaths && parentFolderPath.startsWith(folder.path + "/")) return true;
  }
  return false;
}

export function findExtensionOverride(extension: string, overrides: ExtensionOverride[]): ExtensionOverride | null {
  const lower = extension.toLowerCase();
  return overrides.find((o) => o.extension.toLowerCase() === lower) ?? null;
}

export interface EffectiveTemplates {
  pathTemplate: string;
  formatTemplate: string;
}

export function effectiveTemplates(extension: string, settings: Settings): EffectiveTemplates {
  const override = findExtensionOverride(extension, settings.extensionOverrides);
  return {
    pathTemplate: override?.pathTemplate || settings.pathTemplate,
    formatTemplate: override?.formatTemplate || settings.formatTemplate,
  };
}

export function shouldManage(extension: string, parentFolderPath: string, settings: Settings): boolean {
  if (MANAGED_BLOCKLIST_EXTENSIONS.has(extension.toLowerCase())) return false;
  if (isExcludedByExtension(extension, settings.excludeExtensionPattern)) return false;
  if (isExcludedByPath(parentFolderPath, settings.excludedFolders)) return false;
  return true;
}
