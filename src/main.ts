import { Plugin } from "obsidian";
import { adoptActiveNoteCommand, adoptVaultCommand } from "./commands/adopt";
import { pruneCommand } from "./commands/prune";
import { reapplyActiveNoteCommand, reapplyAllCommand } from "./commands/reapply";
import { Watcher } from "./engine/watcher";
import { configureLogging } from "./log";
import { AttachmentOrganizerSettingTab } from "./settings/tab";
import { Store } from "./store/store";

interface Commands {
  reapplyAll: () => Promise<void>;
  reapplyActiveNote: () => Promise<void>;
  adoptActiveNote: () => Promise<void>;
  adoptVault: () => Promise<void>;
  prune: () => void;
}

export default class AttachmentOrganizerPlugin extends Plugin {
  store!: Store;
  private watcher!: Watcher;
  private commands!: Commands;

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
      adoptActiveNote: adoptActiveNoteCommand(this.app, this.store, this.watcher.internalMoves),
      adoptVault: adoptVaultCommand(this.app, this.store, this.watcher.internalMoves),
      prune: pruneCommand(this.app, this.store),
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

    this.addSettingTab(new AttachmentOrganizerSettingTab(this.app, this));
  }

  async onunload(): Promise<void> {
    await this.store.saveNow();
  }

  // Thin wrappers so the settings tab's "Maintenance" buttons can trigger the
  // same command implementations the command palette uses.
  reapplyAll = (): void => void this.commands.reapplyAll();
  reapplyActiveNote = (): void => void this.commands.reapplyActiveNote();
  adoptActiveNote = (): void => void this.commands.adoptActiveNote();
  adoptVault = (): void => void this.commands.adoptVault();
  prune = (): void => this.commands.prune();
}
