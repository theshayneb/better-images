export type RootMode = "obsidian" | "vaultRoot" | "inFolderBelowRoot" | "nextToNote";

/** File types Obsidian itself owns (notes, canvases, bases) - never real attachments, so this plugin never manages them. */
export const CORE_EXTENSIONS = ["md", "canvas", "base"] as const;
export type CoreExtension = (typeof CORE_EXTENSIONS)[number];

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
  excludedCoreExtensions: Record<CoreExtension, boolean>;
  excludedFolders: ExcludedFolder[];
  extensionOverrides: ExtensionOverride[];
  autoRenameOnNoteRename: boolean;
  cleanEmptyFolders: boolean;
  disableNotifications: boolean;
  debugLogging: boolean;
  debugLogToFile: boolean;
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
  excludedCoreExtensions: { md: true, canvas: true, base: true },
  excludedFolders: [],
  extensionOverrides: [],
  autoRenameOnNoteRename: true,
  cleanEmptyFolders: true,
  disableNotifications: false,
  debugLogging: false,
  debugLogToFile: false,
  claimGraceMs: 2500,
  scanFrontmatterLinks: false,
};
