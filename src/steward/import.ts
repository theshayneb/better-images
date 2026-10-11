import { App, normalizePath } from "obsidian";
import type { StewardHost } from "./host";
import { ensureAdapterFolder, pluginDataDir, RECORDS_DIR } from "./store/shards";

const ATTACHMENT_STEWARD_ID = "attachment-steward";

/**
 * Folder of an installed Attachment Steward plugin (stand-alone, not this
 * one) that has saved settings, or null. Matches on the plugin id, so forks
 * that kept the original id are found too.
 */
export async function findAttachmentStewardFolder(app: App, ownDir: string): Promise<string | null> {
  const adapter = app.vault.adapter;
  const pluginsDir = normalizePath(`${app.vault.configDir}/plugins`);
  if (!(await adapter.exists(pluginsDir))) return null;
  const { folders } = await adapter.list(pluginsDir);
  for (const folder of folders) {
    if (normalizePath(folder) === normalizePath(ownDir)) continue;
    try {
      const manifestPath = `${folder}/manifest.json`;
      if (!(await adapter.exists(manifestPath))) continue;
      const manifest = JSON.parse(await adapter.read(manifestPath)) as { id?: string };
      if (manifest.id !== ATTACHMENT_STEWARD_ID) continue;
      if (await adapter.exists(`${folder}/data.json`)) return folder;
    } catch {
      // Unreadable manifest: not the plugin we're looking for.
    }
  }
  return null;
}

/**
 * Copies Attachment Steward's saved settings and attachment records from
 * `sourceDir`. Returns the settings data for the caller to store; the records
 * are copied into this plugin's own `records/` folder, replacing any there.
 */
export async function importAttachmentSteward(host: StewardHost, sourceDir: string): Promise<{ data: unknown; records: number }> {
  const adapter = host.app.vault.adapter;
  const data = JSON.parse(await adapter.read(`${sourceDir}/data.json`)) as unknown;

  const targetRecords = normalizePath(`${pluginDataDir(host)}/${RECORDS_DIR}`);
  if (await adapter.exists(targetRecords)) {
    for (const file of (await adapter.list(targetRecords)).files) {
      if (file.endsWith(".json")) await adapter.remove(file);
    }
  }

  let records = 0;
  const sourceRecords = normalizePath(`${sourceDir}/${RECORDS_DIR}`);
  if (await adapter.exists(sourceRecords)) {
    await ensureAdapterFolder(host.app, targetRecords);
    for (const file of (await adapter.list(sourceRecords)).files) {
      if (!file.endsWith(".json")) continue;
      const name = file.slice(file.lastIndexOf("/") + 1);
      await adapter.write(`${targetRecords}/${name}`, await adapter.read(file));
      records++;
    }
  }
  return { data, records };
}
