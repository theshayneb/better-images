import { Plugin, TFolder } from "obsidian";
import { adoptActiveNoteCommand, adoptFolderCommand, adoptVaultCommand } from "./commands/adopt";
import { findOrphansCommand } from "./commands/findOrphans";
import { pruneCommand, pruneFolderCommand } from "./commands/prune";
import { reapplyActiveNoteCommand, reapplyAllCommand, reapplyFolderCommand } from "./commands/reapply";
import { addExcludedFolder, isFolderListed, removeExcludedFolder, renameExcludedFolders } from "./core/exclusions";
import { Watcher } from "./engine/watcher";
import { configureLogging, log } from "./log";
import { AttachmentOrganizerSettingTab } from "./settings/tab";
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
}

export default class AttachmentOrganizerPlugin extends Plugin {
  store!: Store;
  private watcher!: Watcher;
  private commands!: Commands;
  private settingTab!: AttachmentOrganizerSettingTab;

  async onload(): Promise<void> {
    this.store = new Store(this);
    await this.store.load();
    configureLogging({
      debug: this.store.settings.debugLogging,
      notifications: !this.store.settings.disableNotifications,
    });

    this.watcher = new Watcher(this.app, this.store);
    // 'create' fires for every pre-existing file on vault load too — only
    // start reacting once the initial layout (and initial file flood) settles.
    this.app.workspace.onLayoutReady(() => {
      this.watcher.register((ref) => this.registerEvent(ref));
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
      findOrphansFolder: findOrphansCommand(this.app),
    };

    this.addCommand({
      id: "reapply-all",
      name: "Reapply rules to all managed attachments",
      callback: this.commands.reapplyAll,
    });
    this.addCommand({
      id: "reapply-active-note",
      name: "Reapply rules to active note's attachments",
      callback: this.commands.reapplyActiveNote,
    });
    this.addCommand({
      id: "adopt-active-note",
      name: "Adopt unmanaged attachments in active note",
      callback: this.commands.adoptActiveNote,
    });
    this.addCommand({
      id: "adopt-vault",
      name: "Adopt unmanaged attachments in whole vault",
      callback: this.commands.adoptVault,
    });
    this.addCommand({
      id: "prune-orphaned-records",
      name: "Prune orphaned attachment records",
      callback: this.commands.prune,
    });

    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        if (!(file instanceof TFolder)) return;
        if (renameExcludedFolders(this.store.settings, oldPath, file.path)) {
          this.store.scheduleSave();
          // Deferred: right when this event fires, the vault's in-memory
          // index of this folder's descendants (e.g. a nested excluded
          // subfolder) hasn't settled to the new paths yet — re-rendering
          // synchronously here makes an existing folder briefly show as
          // "not found" until the settings tab is next opened.
          window.setTimeout(() => this.refreshSettingsTab(), 0);
        }
      })
    );

    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (!(file instanceof TFolder)) return;
        menu.addSeparator();
        menu.addItem((item) => {
          item.setTitle("Attachment Steward").setIcon("paperclip");
          const submenu = item.setSubmenu();
          submenu.addItem((si) =>
            si
              .setTitle("Adopt unmanaged attachments")
              .setIcon("file-plus")
              .onClick(() => this.commands.adoptFolder(file))
          );
          submenu.addItem((si) =>
            si
              .setTitle("Reapply rules")
              .setIcon("refresh-cw")
              .onClick(() => this.commands.reapplyFolder(file))
          );
          submenu.addItem((si) =>
            si
              .setTitle("Prune orphaned records")
              .setIcon("trash-2")
              .onClick(() => this.commands.pruneFolder(file))
          );
          submenu.addItem((si) =>
            si
              .setTitle("Find attachments with no links")
              .setIcon("search")
              .onClick(() => this.commands.findOrphansFolder(file))
          );
          submenu.addSeparator();
          const excluded = isFolderListed(this.store.settings.excludedFolders, file.path);
          submenu.addItem((si) =>
            si
              .setTitle(excluded ? "Remove this folder from Exclusions" : "Exclude this folder")
              .setIcon(excluded ? "eye" : "eye-off")
              .onClick(() => {
                if (excluded) {
                  removeExcludedFolder(this.store.settings, file.path);
                  log.notice(`Removed "${file.path}" from Exclusions.`);
                } else {
                  addExcludedFolder(this.store.settings, file.path);
                  log.notice(`Excluded "${file.path}" from Attachment Steward.`);
                }
                this.store.scheduleSave();
                this.refreshSettingsTab();
              })
          );
        });
      })
    );

    this.settingTab = new AttachmentOrganizerSettingTab(this.app, this);
    this.addSettingTab(this.settingTab);
  }

  onunload(): void {
    // Plugin.onunload isn't awaited by Obsidian, so this stays synchronous
    // and fires the flush as a detached promise with its own error handling
    // instead of silently returning one Obsidian will never wait on.
    void this.store.saveNow().catch((err) => log.error("failed to save on unload", err));
  }

  /**
   * Re-render the settings tab so it reflects changes made elsewhere (context menu, folder rename) without the user having to close and reopen it. Cheap no-op if the tab isn't currently open.
   * Calls the deprecated display() — see ROADMAP.md for the getSettingDefinitions() migration this will need to follow.
   */
  private refreshSettingsTab(): void {
    if (this.settingTab.containerEl.isShown()) this.settingTab.display();
  }

  // Thin wrappers so the settings tab's "Maintenance" buttons can trigger the
  // same command implementations the command palette uses.
  reapplyAll = (): void => void this.commands.reapplyAll();
  reapplyActiveNote = (): void => void this.commands.reapplyActiveNote();
  adoptActiveNote = (): void => void this.commands.adoptActiveNote();
  adoptVault = (): void => void this.commands.adoptVault();
  prune = (): void => this.commands.prune();
}
