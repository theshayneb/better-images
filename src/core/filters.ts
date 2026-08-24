import { CORE_EXTENSIONS, CoreExtension, ExcludedFolder, ExtensionOverride, Settings } from "../settings/types";

/** True while the given core extension's toggle in settings is on (the default) - i.e. this plugin should leave it alone. */
export function isExcludedCoreExtension(extension: string, settings: Settings): boolean {
  const ext = extension.toLowerCase();
  return (CORE_EXTENSIONS as readonly string[]).includes(ext) && settings.excludedCoreExtensions[ext as CoreExtension] !== false;
}

/** Tests `extension` against a regex `pattern` (e.g. from settings UI). Used
 * both to exclude extensions and to match extension-override rows. */
export function matchesExtensionPattern(extension: string, pattern: string): boolean {
  const trimmed = pattern.trim();
  if (!trimmed) return false;
  try {
    const re = new RegExp(`^(${trimmed})$`, "i");
    return re.test(extension);
  } catch {
    // Invalid regex from the settings UI — fail open (don't match anything)
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
  return overrides.find((o) => matchesExtensionPattern(extension, o.extension)) ?? null;
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
  if (isExcludedCoreExtension(extension, settings)) return false;
  if (matchesExtensionPattern(extension, settings.excludeExtensionPattern)) return false;
  if (isExcludedByPath(parentFolderPath, settings.excludedFolders)) return false;
  return true;
}
