import type { Plugin } from "obsidian";
import { DEFAULT_SETTINGS, ExcludedFolder, Settings } from "../settings/types";
import { AttachmentRecord, PluginData } from "./types";

const SCHEMA = 1;
const SAVE_DEBOUNCE_MS = 500;

/** Pre-v0.2 shape of the exclusion settings, replaced by `excludedFolders`. */
interface LegacyExclusionFields {
  excludedPaths?: string;
  excludeSubpaths?: boolean;
}

/** One-time upgrade from the old single-textarea exclusion field to the new per-folder list. */
function migrateExcludedFolders(raw: (Partial<Settings> & LegacyExclusionFields) | undefined): ExcludedFolder[] | null {
  if (!raw || raw.excludedFolders || !raw.excludedPaths) return null;
  const paths = raw.excludedPaths
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (paths.length === 0) return null;
  return paths.map((path) => ({ path, includeSubpaths: !!raw.excludeSubpaths }));
}

/**
 * Owns the plugin's persisted state (data.json) plus two in-memory indices
 * that are rebuilt on load and never persisted directly.
 */
export class Store {
  data: PluginData = { schema: SCHEMA, settings: { ...DEFAULT_SETTINGS }, attachments: {} };

  readonly byNote = new Map<string, Set<string>>();
  readonly byMd5 = new Map<string, string[]>();

  private saveTimer: number | null = null;

  constructor(private readonly plugin: Plugin) {}

  async load(): Promise<void> {
    const raw = (await this.plugin.loadData()) as Partial<PluginData> | null;
    const rawSettings = raw?.settings as (Partial<Settings> & LegacyExclusionFields) | undefined;
    const migratedExcludedFolders = migrateExcludedFolders(rawSettings);
    this.data = {
      schema: SCHEMA,
      settings: {
        ...DEFAULT_SETTINGS,
        ...(rawSettings ?? {}),
        ...(migratedExcludedFolders ? { excludedFolders: migratedExcludedFolders } : {}),
      },
      attachments: raw?.attachments ?? {},
    };
    this.rebuildIndices();
  }

  get settings(): Settings {
    return this.data.settings;
  }

  private rebuildIndices(): void {
    this.byNote.clear();
    this.byMd5.clear();
    for (const [path, record] of Object.entries(this.data.attachments)) {
      this.indexRecord(path, record);
    }
  }

  private indexRecord(path: string, record: AttachmentRecord): void {
    if (record.notePath) {
      let set = this.byNote.get(record.notePath);
      if (!set) {
        set = new Set();
        this.byNote.set(record.notePath, set);
      }
      set.add(path);
    }
    if (record.md5) {
      const list = this.byMd5.get(record.md5);
      if (list) {
        list.push(path);
      } else {
        this.byMd5.set(record.md5, [path]);
      }
    }
  }

  private unindexRecord(path: string, record: AttachmentRecord): void {
    if (record.notePath) {
      const set = this.byNote.get(record.notePath);
      set?.delete(path);
      if (set && set.size === 0) this.byNote.delete(record.notePath);
    }
    if (record.md5) {
      const list = this.byMd5.get(record.md5);
      if (list) {
        const idx = list.indexOf(path);
        if (idx >= 0) list.splice(idx, 1);
        if (list.length === 0) this.byMd5.delete(record.md5);
      }
    }
  }

  get(path: string): AttachmentRecord | undefined {
    return this.data.attachments[path];
  }

  has(path: string): boolean {
    return path in this.data.attachments;
  }

  /** Insert or fully replace the record at `path`. */
  set(path: string, record: AttachmentRecord): void {
    const existing = this.data.attachments[path];
    if (existing) this.unindexRecord(path, existing);
    this.data.attachments[path] = record;
    this.indexRecord(path, record);
    this.scheduleSave();
  }

  /** Move a record to a new key (file was renamed/moved), keeping its content. */
  rekey(oldPath: string, newPath: string): void {
    const record = this.data.attachments[oldPath];
    if (!record) return;
    this.unindexRecord(oldPath, record);
    delete this.data.attachments[oldPath];
    this.data.attachments[newPath] = record;
    this.indexRecord(newPath, record);
    this.scheduleSave();
  }

  delete(path: string): void {
    const record = this.data.attachments[path];
    if (!record) return;
    this.unindexRecord(path, record);
    delete this.data.attachments[path];
    this.scheduleSave();
  }

  attachmentsForNote(notePath: string): AttachmentRecord[] {
    const paths = this.byNote.get(notePath);
    if (!paths) return [];
    return [...paths].map((p) => this.data.attachments[p]).filter((r): r is AttachmentRecord => !!r);
  }

  pathsForNote(notePath: string): string[] {
    const paths = this.byNote.get(notePath);
    return paths ? [...paths] : [];
  }

  /** Change which note owns a record, keeping the byNote index in sync. */
  setNotePath(path: string, notePath: string | null): void {
    const record = this.data.attachments[path];
    if (!record) return;
    this.unindexRecord(path, record);
    record.notePath = notePath;
    this.indexRecord(path, record);
    this.scheduleSave();
  }

  allEntries(): Array<[string, AttachmentRecord]> {
    return Object.entries(this.data.attachments);
  }

  count(): number {
    return Object.keys(this.data.attachments).length;
  }

  scheduleSave(): void {
    if (this.saveTimer) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      void this.saveNow();
    }, SAVE_DEBOUNCE_MS);
  }

  async saveNow(): Promise<void> {
    if (this.saveTimer) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    await this.plugin.saveData(this.data);
  }
}
