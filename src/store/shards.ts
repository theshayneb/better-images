import { App, normalizePath, Plugin } from "obsidian";

export const RECORDS_DIR = "records";
export const ORPHANS_FILE = "orphans.json";

/** Vault-relative path to this plugin's own data folder (inside .obsidian/). */
export function pluginDataDir(plugin: Plugin): string {
  return plugin.manifest.dir ?? `${plugin.app.vault.configDir}/plugins/${plugin.manifest.id}`;
}

function stripMdExtension(notePath: string): string {
  return notePath.endsWith(".md") ? notePath.slice(0, -3) : notePath;
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
export function shardPath(plugin: Plugin, notePath: string | null): string {
  const dir = pluginDataDir(plugin);
  if (notePath === null) return normalizePath(`${dir}/${RECORDS_DIR}/${ORPHANS_FILE}`);
  const key = encodeURIComponent(stripMdExtension(notePath));
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
