import type { App, TFile } from "obsidian";
import * as SparkMD5 from "spark-md5";
import { Settings } from "../settings/types";
import { AttachmentRecord } from "../store/types";
import { effectiveTemplates } from "./filters";

export interface HashMeta {
  size: number;
  mtime: number;
}

export interface HashResult {
  md5: string;
  meta: HashMeta;
}

function statOf(file: TFile): HashMeta {
  return { size: file.stat.size, mtime: file.stat.mtime };
}

export function hashMatchesCache(file: TFile, cached: HashMeta | null): boolean {
  if (!cached) return false;
  const current = statOf(file);
  return current.size === cached.size && current.mtime === cached.mtime;
}

/** Uppercase hex to stay byte-for-byte compatible with the legacy
 * attachment-management plugin's MD5 table (needed for the later
 * legacy-import migration command). */
export async function computeMd5(app: App, file: TFile): Promise<HashResult> {
  const buffer = await app.vault.readBinary(file);
  const md5 = SparkMD5.ArrayBuffer.hash(buffer).toUpperCase();
  return { md5, meta: statOf(file) };
}

/**
 * Computes and caches the record's md5 only if the effective templates for
 * this extension actually reference ${md5} — reading full file contents on
 * every attachment otherwise would be wasted I/O for the common case.
 * Mutates `record` in place; returns whether it changed (so the caller
 * knows whether a save is warranted).
 */
export async function ensureRecordHash(app: App, file: TFile, record: AttachmentRecord, settings: Settings): Promise<boolean> {
  const { pathTemplate, formatTemplate } = effectiveTemplates(record.extension, settings);
  if (!pathTemplate.includes("${md5}") && !formatTemplate.includes("${md5}")) return false;
  if (record.md5 && hashMatchesCache(file, record.md5For)) return false;

  const { md5, meta } = await computeMd5(app, file);
  record.md5 = md5;
  record.md5For = meta;
  return true;
}
