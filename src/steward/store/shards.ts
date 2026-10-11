import { App, normalizePath } from "obsidian";
import type { StewardHost } from "../host";
import SparkMD5 from "spark-md5";

export const RECORDS_DIR = "records";
export const ORPHANS_FILE = "orphans.json";

/**
 * Headroom under the ~255-byte filename limit most filesystems enforce,
 * after accounting for the "data_" prefix and ".json" suffix. `encodeURIComponent`
 * output is pure ASCII, so its `.length` already equals its byte count.
 */
const MAX_ENCODED_KEY_LENGTH = 200;

/** Vault-relative path to this plugin's own data folder (inside .obsidian/). */
export function pluginDataDir(plugin: StewardHost): string {
  return plugin.manifest.dir ?? `${plugin.app.vault.configDir}/plugins/${plugin.manifest.id}`;
}

function stripMdExtension(notePath: string): string {
  return notePath.endsWith(".md") ? notePath.slice(0, -3) : notePath;
}

/**
 * Deriving the shard filename from `notePath` slashes and all (rather than
 * just its basename) means a note rename needs no extra "rename the shard"
 * step, but a deep, non-ASCII path can blow past the filesystem's filename
 * length limit once percent-encoded (each Cyrillic character alone expands
 * to 6 ASCII bytes) — `adapter.write` then fails with ENAMETOOLONG. Falling
 * back to an MD5 of the full path keeps the name short regardless, at the
 * cost of it no longer being human-readable; kept as a fallback rather than
 * the default so existing shards for short/ASCII paths don't get orphaned.
 */
function shardKey(notePath: string): string {
  const encoded = encodeURIComponent(notePath);
  if (encoded.length <= MAX_ENCODED_KEY_LENGTH) return encoded;
  return SparkMD5.hash(notePath);
}

/**
 * Vault-relative path to the shard file holding one note's attachment
 * records (or the shared bucket for not-yet-claimed ones, when `notePath`
 * is null). The note's own current path is the shard's identity, flatly
 * encoded — so a note rename needs no extra "rename the shard" step: the
 * next flush just derives a different filename from the new path and the
 * old one, now empty, gets removed. Lives under the plugin's own data
 * folder, never inside the vault proper, so it's invisible to `Vault`
 * events (and to the user) and never collides with anything the watcher
 * scans for manageable attachments.
 */
export function shardPath(plugin: StewardHost, notePath: string | null): string {
  const dir = pluginDataDir(plugin);
  if (notePath === null) return normalizePath(`${dir}/${RECORDS_DIR}/${ORPHANS_FILE}`);
  const key = shardKey(stripMdExtension(notePath));
  return normalizePath(`${dir}/${RECORDS_DIR}/data_${key}.json`);
}

/** mkdir -p over the raw adapter (the records folder sits outside the vault's own tree, so `Vault.createFolder` doesn't apply). */
export async function ensureAdapterFolder(app: App, folderPath: string): Promise<void> {
  if (!folderPath || folderPath === "/") return;
  if (await app.vault.adapter.exists(folderPath)) return;
  const parent = folderPath.split("/").slice(0, -1).join("/");
  if (parent) await ensureAdapterFolder(app, parent);
  try {
    await app.vault.adapter.mkdir(folderPath);
  } catch {
    // Race: created concurrently — fine.
  }
}
