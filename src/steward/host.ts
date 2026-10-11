import type { App, PluginManifest } from "obsidian";

/**
 * The slice of a Plugin the attachment organizer needs. In Better Images &
 * Attachments the organizer is a module of the combined plugin, so its
 * settings are stored under their own key inside the shared data.json
 * rather than owning the whole file.
 */
export interface StewardHost {
  app: App;
  manifest: PluginManifest;
  loadData(): Promise<unknown>;
  saveData(data: unknown): Promise<void>;
}
