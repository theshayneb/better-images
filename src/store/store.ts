import type { Plugin } from "obsidian";
import { log } from "../log";
import { DEFAULT_SETTINGS, ExcludedFolder, Settings } from "../settings/types";
import { ensureAdapterFolder, pluginDataDir, RECORDS_DIR, shardPath } from "./shards";
import { AttachmentRecord, AttachmentShard, PluginData } from "./types";

const SCHEMA = 2;
const SAVE_DEBOUNCE_MS = 500;

/** Pre-v0.2 shape of the exclusion settings, replaced by `excludedFolders`. */
interface LegacyExclusionFields {
  excludedPaths?: string;
  excludeSubpaths?: boolean;
}

/** Pre-v0.3 shape of data.json, which kept every record inline instead of sharded. */
interface LegacyMonolithicData {
  attachments?: Record<string, AttachmentRecord>;
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
 * Owns the plugin's persisted state plus two in-memory indices that are
 * rebuilt on load and never persisted directly.
 *
 * On disk this is split across many small files instead of one data.json:
 * settings live in the regular plugin data file, but attachment records are
 * sharded one-file-per-owning-note (plus a shared bucket for unclaimed
 * ones) under `records/`. Two devices syncing the same vault through
 * iCloud (or any other last-writer-wins file sync) then only ever race on
 * files touched by the SAME note — editing one note on the phone can't
 * clobber another device's just-written records for an unrelated note,
 * which a single shared data.json blob could.
 */
export class Store {
  data: PluginData = { schema: SCHEMA, settings: { ...DEFAULT_SETTINGS }, attachments: {} };

  readonly byNote = new Map<string, Set<string>>();
  readonly byMd5 = new Map<string, string[]>();

  private saveTimer: number | null = null;
  private readonly dirtyShards = new Set<string | null>(); // notePath, or null for the orphans bucket

  constructor(private readonly plugin: Plugin) {}

  async load(): Promise<void> {
    const raw = (await this.plugin.loadData()) as (Partial<PluginData> & LegacyMonolithicData) | null;
    const rawSettings = raw?.settings as (Partial<Settings> & LegacyExclusionFields) | undefined;
    const migratedExcludedFolders = migrateExcludedFolders(rawSettings);
    this.data = {
      schema: SCHEMA,
      settings: {
        ...DEFAULT_SETTINGS,
        ...(rawSettings ?? {}),
        ...(migratedExcludedFolders ? { excludedFolders: migratedExcludedFolders } : {}),
      },
      attachments: await this.loadShards(),
    };

    // One-time upgrade from pre-v0.3 data.json, which kept every record
    // inline. Shard-sourced records win on conflict — they're the newer format.
    if (raw?.attachments) {
      for (const [path, record] of Object.entries(raw.attachments)) {
        if (!(path in this.data.attachments)) {
          this.data.attachments[path] = record;
          this.dirtyShards.add(record.notePath);
        }
      }
    }

    this.rebuildIndices();
    if (this.dirtyShards.size > 0) await this.saveNow();
  }

  get settings(): Settings {
    return this.data.settings;
  }

  private async loadShards(): Promise<Record<string, AttachmentRecord>> {
    const out: Record<string, AttachmentRecord> = {};
    const adapter = this.plugin.app.vault.adapter;
    const dir = `${pluginDataDir(this.plugin)}/${RECORDS_DIR}`;
    if (!(await adapter.exists(dir))) return out;

    const { files } = await adapter.list(dir);
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      try {
        const shard = JSON.parse(await adapter.read(file)) as AttachmentShard;
        Object.assign(out, shard.attachments);
      } catch (err) {
        log.error(`failed to read attachment shard ${file}`, err);
      }
    }
    return out;
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
    if (existing) {
      this.unindexRecord(path, existing);
      this.markDirty(existing.notePath);
    }
    this.data.attachments[path] = record;
    this.indexRecord(path, record);
    this.markDirty(record.notePath);
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
    this.markDirty(record.notePath); // same shard, but its key inside changed
    this.scheduleSave();
  }

  delete(path: string): void {
    const record = this.data.attachments[path];
    if (!record) return;
    this.unindexRecord(path, record);
    delete this.data.attachments[path];
    this.markDirty(record.notePath);
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

  /**
   * Change which note owns a record, keeping the byNote index in sync. This
   * is also what makes a note rename "rename its shard": `noteRename.ts`
   * calls this for every attachment the old note owned, which marks both
   * the old and new note dirty — the next flush writes the new shard and
   * removes the old one (now empty), with nothing extra to do here.
   */
  setNotePath(path: string, notePath: string | null): void {
    const record = this.data.attachments[path];
    if (!record) return;
    const oldNotePath = record.notePath;
    this.unindexRecord(path, record);
    record.notePath = notePath;
    this.indexRecord(path, record);
    this.markDirty(oldNotePath);
    this.markDirty(notePath);
    this.scheduleSave();
  }

  /**
   * Marks the record at `path`'s shard dirty and schedules a flush — for
   * callers that mutate a record's fields in place (e.g. caching a computed
   * hash, or repairing a stamped originalName) without going through
   * `set`/`rekey`/`setNotePath`, so nothing else would otherwise tell the
   * next flush that this shard needs rewriting.
   */
  touch(path: string): void {
    const record = this.data.attachments[path];
    if (!record) return;
    this.markDirty(record.notePath);
    this.scheduleSave();
  }

  allEntries(): Array<[string, AttachmentRecord]> {
    return Object.entries(this.data.attachments);
  }

  count(): number {
    return Object.keys(this.data.attachments).length;
  }

  private markDirty(notePath: string | null): void {
    this.dirtyShards.add(notePath);
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
    const dirty = [...this.dirtyShards];
    this.dirtyShards.clear();

    await this.plugin.saveData({ schema: SCHEMA, settings: this.data.settings });
    for (const notePath of dirty) {
      try {
        await this.flushShard(notePath);
      } catch (err) {
        log.error(`failed to flush attachment shard for ${notePath ?? "(orphans)"}`, err);
      }
    }
  }

  private async flushShard(notePath: string | null): Promise<void> {
    const attachments = this.collectShard(notePath);
    const path = shardPath(this.plugin, notePath);
    const adapter = this.plugin.app.vault.adapter;

    if (Object.keys(attachments).length === 0) {
      if (await adapter.exists(path)) await adapter.remove(path);
      return;
    }

    const parent = path.slice(0, path.lastIndexOf("/"));
    await ensureAdapterFolder(this.plugin.app, parent);
    const shard: AttachmentShard = { schema: 1, notePath, attachments };
    await adapter.write(path, JSON.stringify(shard));
  }

  private collectShard(notePath: string | null): Record<string, AttachmentRecord> {
    const out: Record<string, AttachmentRecord> = {};
    if (notePath === null) {
      for (const [path, record] of Object.entries(this.data.attachments)) {
        if (record.notePath === null) out[path] = record;
      }
      return out;
    }
    for (const path of this.byNote.get(notePath) ?? []) {
      out[path] = this.data.attachments[path];
    }
    return out;
  }
}
