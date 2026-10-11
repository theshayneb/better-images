import { Platform, Plugin, TFolder } from "obsidian";
import type { StewardHost } from "./host";
import { adoptActiveNoteCommand, adoptFolderCommand, adoptVaultCommand } from "./commands/adopt";
import { findOrphansCommand } from "./commands/findOrphans";
import { pruneCommand, pruneFolderCommand } from "./commands/prune";
import { reapplyActiveNoteCommand, reapplyAllCommand, reapplyFolderCommand } from "./commands/reapply";
import { repairStampedNamesCommand } from "./commands/repair";
import { addExcludedFolder, isFolderListed, removeExcludedFolder, renameExcludedFolders } from "./core/exclusions";
import { Watcher } from "./engine/watcher";
import { configureLogging, flushLog, log } from "./log";
import { renderStewardSettings } from "./settings/tab";
import { Store } from "./store/store";

interface Commands {
  reapplyAll: () => Promise<void>;
  reapplyActiveNote: () => Promise<void>;
  reapplyFolder: (folder: TFolder) => Promise<void>;
  adoptActiveNote: () => Promise<void>;
  adoptVault: () => Promise<void>;
  adoptFolder: (folder: TFolder) => Promise<void>;
  prune: () => void;
  pruneFolder: (folder: TFolder) => void;
  findOrphansFolder: (folder: TFolder) => void;
  repairStampedNames: () => Promise<void>;
}

/**
 * The attachment organizer (formerly the stand-alone Attachment Steward
 * plugin), run as a module of the combined plugin. It registers its events,
 * commands and menus on the host plugin, so Obsidian cleans them up when the
 * plugin unloads.
 */
export class StewardModule {
  store!: Store;
  private watcher!: Watcher;
  private commands!: Commands;

  /** Called after an exclusion changes outside the settings tab, so an open tab can redraw. */
  onExternalSettingsChange: () => void = () => {};

  constructor(
    readonly plugin: Plugin,
    readonly host: StewardHost
  ) {}

  get app() {
    return this.plugin.app;
  }

  async load(): Promise<void> {
    this.store = new Store(this.host);
    await this.store.load();
    this.applyLogging();

    this.watcher = new Watcher(this.app, this.store);
    // 'create' fires for every pre-existing file on vault load too — only
    // start reacting once the initial layout (and initial file flood) settles.
    this.app.workspace.onLayoutReady(() => {
      this.watcher.register((ref) => this.plugin.registerEvent(ref));
    });

    this.commands = {
      reapplyAll: reapplyAllCommand(this.app, this.store, this.watcher.internalMoves),
      reapplyActiveNote: reapplyActiveNoteCommand(this.app, this.store, this.watcher.internalMoves),
      reapplyFolder: reapplyFolderCommand(this.app, this.store, this.watcher.internalMoves),
      adoptActiveNote: adoptActiveNoteCommand(this.app, this.store, this.watcher.internalMoves),
      adoptVault: adoptVaultCommand(this.app, this.store, this.watcher.internalMoves),
      adoptFolder: adoptFolderCommand(this.app, this.store, this.watcher.internalMoves),
      prune: pruneCommand(this.app, this.store),
      pruneFolder: pruneFolderCommand(this.app, this.store),
      findOrphansFolder: findOrphansCommand(this.app, this.store.settings),
      repairStampedNames: repairStampedNamesCommand(this.app, this.store, this.watcher.internalMoves),
    };

    this.plugin.addCommand({
      id: "attachments-reapply-all",
      name: "Reapply rules to all managed attachments",
      callback: this.commands.reapplyAll,
    });
    this.plugin.addCommand({
      id: "attachments-reapply-active-note",
      name: "Reapply rules to active note's attachments",
      callback: this.commands.reapplyActiveNote,
    });
    this.plugin.addCommand({
      id: "attachments-adopt-active-note",
      name: "Adopt unmanaged attachments in active note",
      callback: this.commands.adoptActiveNote,
    });
    this.plugin.addCommand({
      id: "attachments-adopt-vault",
      name: "Adopt unmanaged attachments in whole vault",
      callback: this.commands.adoptVault,
    });
    this.plugin.addCommand({
      id: "attachments-prune-orphaned-records",
      name: "Prune orphaned attachment records",
      callback: this.commands.prune,
    });
    this.plugin.addCommand({
      id: "attachments-repair-stamped-names",
      name: "Repair attachment names stamped by a past sync bug",
      callback: this.commands.repairStampedNames,
    });

    this.plugin.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        if (!(file instanceof TFolder)) return;
        if (renameExcludedFolders(this.store.settings, oldPath, file.path)) {
          this.store.scheduleSave();
          // Deferred: right when this event fires, the vault's in-memory
          // index of this folder's descendants (e.g. a nested excluded
          // subfolder) hasn't settled to the new paths yet — re-rendering
          // synchronously here makes an existing folder briefly show as
          // "not found" until the settings tab is next opened.
          window.setTimeout(() => this.onExternalSettingsChange(), 0);
        }
      })
    );

    this.plugin.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (!(file instanceof TFolder)) return;
        const excluded = isFolderListed(this.store.settings.excludedFolders, file.path);
        const items = [
          {
            title: "Adopt unmanaged attachments",
            icon: "file-plus",
            onClick: () => this.commands.adoptFolder(file),
          },
          {
            title: "Reapply rules",
            icon: "refresh-cw",
            onClick: () => this.commands.reapplyFolder(file),
          },
          {
            title: "Prune orphaned records",
            icon: "trash-2",
            onClick: () => this.commands.pruneFolder(file),
          },
          {
            title: "Find attachments with no links",
            icon: "search",
            onClick: () => this.commands.findOrphansFolder(file),
          },
        ];
        const exclusionItem = {
          title: excluded ? "Remove this folder from Exclusions" : "Exclude this folder",
          icon: excluded ? "eye" : "eye-off",
          onClick: () => {
            if (excluded) {
              removeExcludedFolder(this.store.settings, file.path);
              log.notice(`Removed "${file.path}" from Exclusions.`);
            } else {
              addExcludedFolder(this.store.settings, file.path);
              log.notice(`Excluded "${file.path}" from attachment organizing.`);
            }
            this.store.scheduleSave();
            this.onExternalSettingsChange();
          },
        };

        menu.addSeparator();
        if (Platform.isMobile) {
          // A submenu (below) only opens on mobile via long-tap, an undiscoverable
          // gesture — see https://forum.obsidian.md/t/87532. Flatten into the root
          // menu instead, under a non-clickable label so the group still reads as one
          // unit without repeating the plugin name on every line.
          menu.addItem((mi) => mi.setTitle("Organize attachments").setIcon("paperclip").setIsLabel(true));
          for (const { title, icon, onClick } of [...items, exclusionItem]) {
            menu.addItem((mi) => mi.setTitle(title).setIcon(icon).onClick(onClick));
          }
        } else {
          menu.addItem((item) => {
            item.setTitle("Organize attachments").setIcon("paperclip");
            const submenu = item.setSubmenu();
            for (const { title, icon, onClick } of items) {
              submenu.addItem((si) => si.setTitle(title).setIcon(icon).onClick(onClick));
            }
            submenu.addSeparator();
            submenu.addItem((si) =>
              si.setTitle(exclusionItem.title).setIcon(exclusionItem.icon).onClick(exclusionItem.onClick)
            );
          });
        }
      })
    );
  }

  /** Re-reads the logging switches from settings; call after they change. */
  applyLogging(): void {
    configureLogging({
      debug: this.store.settings.debugLogging,
      notifications: !this.store.settings.disableNotifications,
      logToFile: this.store.settings.debugLogToFile,
      plugin: this.host,
    });
  }

  renderSettings(containerEl: HTMLElement, redraw: () => void): void {
    renderStewardSettings(containerEl, this, redraw);
  }

  unload(): void {
    // Plugin.onunload isn't awaited by Obsidian, so this stays synchronous
    // and fires the flushes as detached promises with their own error
    // handling instead of silently returning ones Obsidian will never wait on.
    if (!this.store) return;
    void this.store.saveNow().catch((err) => log.error("failed to save on unload", err));
    void flushLog().catch((err) => console.error("[better-images] failed to flush debug log on unload", err));
  }

  // Thin wrappers so the settings tab's "Maintenance" buttons can trigger the
  // same command implementations the command palette uses.
  reapplyAll = (): void => void this.commands.reapplyAll();
  reapplyActiveNote = (): void => void this.commands.reapplyActiveNote();
  adoptActiveNote = (): void => void this.commands.adoptActiveNote();
  adoptVault = (): void => void this.commands.adoptVault();
  prune = (): void => this.commands.prune();
}
