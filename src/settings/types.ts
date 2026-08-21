export type RootMode = "obsidian" | "vaultRoot" | "inFolderBelowRoot" | "nextToNote";

export interface ExtensionOverride {
  extension: string;
  pathTemplate: string;
  formatTemplate: string;
}

export interface ExcludedFolder {
  path: string;
  includeSubpaths: boolean;
}

export interface Settings {
  rootMode: RootMode;
  root: string;
  pathTemplate: string;
  formatTemplate: string;
  dateFormat: string;
  excludeExtensionPattern: string;
  excludedFolders: ExcludedFolder[];
  extensionOverrides: ExtensionOverride[];
  autoRenameOnNoteRename: boolean;
  cleanEmptyFolders: boolean;
  disableNotifications: boolean;
  debugLogging: boolean;
  claimGraceMs: number;
  scanFrontmatterLinks: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  rootMode: "nextToNote",
  root: "_sources",
  pathTemplate: "_attachments_${notename}",
  formatTemplate: "${date}-${originalname}",
  dateFormat: "YYYY-MM-DD-HH_mm_ss_SSS",
  excludeExtensionPattern: "",
  excludedFolders: [],
  extensionOverrides: [],
  autoRenameOnNoteRename: true,
  cleanEmptyFolders: true,
  disableNotifications: false,
  debugLogging: false,
  claimGraceMs: 2500,
  scanFrontmatterLinks: false,
};
