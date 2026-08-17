import { RootMode, Settings } from "../settings/types";

export interface AppliedSnapshot {
  at: number;
  rootMode: RootMode;
  root: string;
  pathTemplate: string;
  formatTemplate: string;
  dateFormat: string;
  resultPath: string;
}

export type AttachmentSource = "created" | "adopted" | "legacy-import";

export interface AttachmentRecord {
  v: 1;
  /** True original basename (without extension). Frozen at first sight, never rewritten. */
  originalName: string;
  extension: string;
  /** epoch ms, frozen — ${date} renders from this, never from Date.now() on reapply. */
  importedAt: number;
  notePath: string | null;
  md5: string | null;
  md5For: { size: number; mtime: number } | null;
  /** Stable "-n" collision suffix, persisted so reapply doesn't renumber. */
  dedupe: number;
  applied: AppliedSnapshot | null;
  managed: boolean;
  source: AttachmentSource;
}

export interface PluginData {
  schema: 1;
  settings: Settings;
  /** Keyed by current vault path. Rekeyed on every move. */
  attachments: Record<string, AttachmentRecord>;
}
