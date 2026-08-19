import { App, moment, PluginSettingTab, Setting, TFolder } from "obsidian";
import type AttachmentOrganizerPlugin from "../main";
import { configureLogging } from "../log";
import { FolderSuggest } from "../ui/folderSuggest";
import { ExcludedFolder, ExtensionOverride, RootMode } from "./types";

const ROOT_MODE_LABELS: Record<RootMode, string> = {
  obsidian: "Wherever Obsidian puts it (core setting)",
  vaultRoot: "Vault root",
  inFolderBelowRoot: "Fixed folder",
  nextToNote: "Next to note, in folder specified below",
};

export class AttachmentOrganizerSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: AttachmentOrganizerPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("attachment-organizer-settings");

    const settings = this.plugin.store.settings;
    const save = (): void => {
      this.plugin.store.scheduleSave();
      configureLogging({ debug: settings.debugLogging, notifications: !settings.disableNotifications });
    };

    containerEl.createEl("h2", { text: "Exclusions" });

    new Setting(containerEl)
      .setName("Exclude extension pattern")
      .setDesc("Regular expression. File extensions that match are left completely alone by this plugin (Obsidian's own default attachment handling still applies to them).")
      .addText((text) =>
        text
          .setPlaceholder("pdf|docx?|xlsx?|pptx?|zip")
          .setValue(settings.excludeExtensionPattern)
          .onChange((v) => {
            settings.excludeExtensionPattern = v;
            save();
          })
      );

    containerEl.createEl("h3", { text: "Excluded folders" });
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: 'Attachments already inside these folders are never touched. Start typing to pick from your existing folders, or type a path that doesn\'t exist yet (e.g. for a folder you plan to create). Same effect as right-clicking a folder → Attachment Steward → "Exclude this folder".',
    });
    this.renderExcludedFolders(containerEl, settings.excludedFolders, save);

    new Setting(containerEl).addButton((btn) =>
      btn.setButtonText("Add excluded folder").onClick(() => {
        settings.excludedFolders.push({ path: "", includeSubpaths: true });
        save();
        this.display();
      })
    );

    containerEl.createEl("h2", { text: "Location" });
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "These settings are independent from Obsidian's own \"Default location for new attachments\" under Settings → Files and links. That core setting only decides where a file lands the instant you attach it — this plugin then reorganizes it from there, right away, using the rules below.",
    });

    new Setting(containerEl)
      .setName("Attachment root location")
      .setDesc("The base folder this plugin files attachments into.")
      .addDropdown((dd) => {
        for (const [value, label] of Object.entries(ROOT_MODE_LABELS)) {
          dd.addOption(value, label);
        }
        dd.setValue(settings.rootMode).onChange((value) => {
          settings.rootMode = value as RootMode;
          save();
          this.display();
        });
      });

    if (settings.rootMode === "inFolderBelowRoot" || settings.rootMode === "nextToNote") {
      new Setting(containerEl)
        .setName("Root folder name")
        .setDesc('Folder name appended after the location above, e.g. "_sources". Only used by the "Fixed folder" and "Next to note" locations.')
        .addText((text) =>
          text.setValue(settings.root).onChange((value) => {
            settings.root = value;
            save();
          })
        );
    }

    new Setting(containerEl)
      .setName("Attachment folder template")
      .setDesc(
        "Subfolder path built inside the root above. Variables: ${notepath} (note's folder + title, no extension), ${notename} (title only), ${parent} (note's parent folder name)."
      )
      .addText((text) =>
        text.setValue(settings.pathTemplate).onChange((value) => {
          settings.pathTemplate = value;
          save();
        })
      );

    new Setting(containerEl)
      .setName("Attachment filename template")
      .setDesc(
        "New filename, without extension — the original extension is always kept as-is. Variables: ${date}, ${notename}, ${md5}, ${originalname} (the file's true original name, frozen the first time it was seen)."
      )
      .addText((text) =>
        text.setValue(settings.formatTemplate).onChange((value) => {
          settings.formatTemplate = value;
          save();
        })
      );

    const dateFormatSetting = new Setting(containerEl).setName("Date format").setDesc("Moment.js format used to render ${date} above.");
    const dateExampleEl = dateFormatSetting.descEl.createDiv();
    const updateExample = (): void => {
      try {
        dateExampleEl.setText(`Example: ${moment().format(settings.dateFormat)}`);
      } catch {
        dateExampleEl.setText("Invalid moment.js format");
      }
    };
    dateFormatSetting.addText((text) =>
      text.setValue(settings.dateFormat).onChange((value) => {
        settings.dateFormat = value;
        save();
        updateExample();
      })
    );
    updateExample();

    containerEl.createEl("h2", { text: "Behaviour" });

    new Setting(containerEl)
      .setName("Automatically rename attachment")
      .setDesc("When you rename or move a note, move its attachments along with it and update every link that points to them, everywhere in the vault.")
      .addToggle((t) =>
        t.setValue(settings.autoRenameOnNoteRename).onChange((v) => {
          settings.autoRenameOnNoteRename = v;
          save();
        })
      );

    new Setting(containerEl)
      .setName("Clean up empty folders")
      .setDesc("After moving an attachment out, delete its old folder if this plugin just emptied it. Never touches a folder that still holds a note or other files.")
      .addToggle((t) =>
        t.setValue(settings.cleanEmptyFolders).onChange((v) => {
          settings.cleanEmptyFolders = v;
          save();
        })
      );

    new Setting(containerEl)
      .setName("Disable notifications")
      .setDesc('Hide the small popup shown after attachments are organized (e.g. "Organized 3 attachments"). Errors are still printed to the developer console either way.')
      .addToggle((t) =>
        t.setValue(settings.disableNotifications).onChange((v) => {
          settings.disableNotifications = v;
          save();
        })
      );

    new Setting(containerEl)
      .setName("Debug logging")
      .setDesc(
        "Print detailed step-by-step logs to the developer console, prefixed [attachment-organizer]. Open the console with Cmd+Option+I (Mac) or Ctrl+Shift+I (Windows/Linux). Leave off for everyday use — it's noisy."
      )
      .addToggle((t) =>
        t.setValue(settings.debugLogging).onChange((v) => {
          settings.debugLogging = v;
          save();
        })
      );

    containerEl.createEl("h2", { text: "Extension overrides" });
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "Use a different folder/filename template for specific file extensions — e.g. keep PDFs in their own folder, separate from images.",
    });
    this.renderExtensionOverrides(containerEl, settings.extensionOverrides, save);

    new Setting(containerEl).addButton((btn) =>
      btn.setButtonText("Add extension override").onClick(() => {
        settings.extensionOverrides.push({
          extension: "",
          pathTemplate: settings.pathTemplate,
          formatTemplate: settings.formatTemplate,
        });
        save();
        this.display();
      })
    );

    containerEl.createEl("h2", { text: "Maintenance" });

    new Setting(containerEl).setName("Managed attachments").setDesc(`${this.plugin.store.count()} tracked`);

    new Setting(containerEl)
      .setName("Reapply rules to all managed attachments")
      .addButton((btn) => btn.setButtonText("Run").onClick(() => this.plugin.reapplyAll()));

    new Setting(containerEl)
      .setName("Reapply rules to active note's attachments")
      .addButton((btn) => btn.setButtonText("Run").onClick(() => this.plugin.reapplyActiveNote()));

    new Setting(containerEl)
      .setName("Adopt unmanaged attachments in active note")
      .addButton((btn) => btn.setButtonText("Run").onClick(() => this.plugin.adoptActiveNote()));

    new Setting(containerEl)
      .setName("Adopt unmanaged attachments in whole vault")
      .addButton((btn) => btn.setButtonText("Run").onClick(() => this.plugin.adoptVault()));

    new Setting(containerEl).setName("Prune orphaned records").addButton((btn) => btn.setButtonText("Run").onClick(() => this.plugin.prune()));
  }

  private renderExcludedFolders(containerEl: HTMLElement, excludedFolders: ExcludedFolder[], save: () => void): void {
    excludedFolders.forEach((entry, index) => {
      const row = containerEl.createDiv({ cls: "ao-excluded-folder-row" });
      const exists = entry.path === "" || this.app.vault.getAbstractFileByPath(entry.path) instanceof TFolder;
      if (!exists) row.addClass("ao-excluded-folder-missing");

      const setting = new Setting(row).setName("");
      setting.addText((text) => {
        text.setPlaceholder("e.g. Attachments, or Exports/Telegram").setValue(entry.path);
        text.onChange((v) => {
          entry.path = v;
          save();
        });
        new FolderSuggest(this.app, text.inputEl, (folder) => {
          entry.path = folder.path;
          text.setValue(folder.path);
          save();
          this.display();
        });
      });
      if (!exists) {
        setting.controlEl.createSpan({ cls: "ao-excluded-folder-warning", text: "⚠ folder not found" });
      }
      setting.controlEl.createSpan({ cls: "ao-excluded-folder-hint", text: "Include subfolders" });
      setting.addToggle((t) =>
        t.setValue(entry.includeSubpaths).onChange((v) => {
          entry.includeSubpaths = v;
          save();
        })
      );
      setting.addExtraButton((btn) =>
        btn
          .setIcon("trash")
          .setTooltip("Remove")
          .onClick(() => {
            excludedFolders.splice(index, 1);
            save();
            this.display();
          })
      );
    });
  }

  private renderExtensionOverrides(containerEl: HTMLElement, overrides: ExtensionOverride[], save: () => void): void {
    overrides.forEach((override, index) => {
      const row = containerEl.createDiv({ cls: "ao-extension-override-row" });
      new Setting(row)
        .setName("")
        .addText((text) =>
          text
            .setPlaceholder("pdf")
            .setValue(override.extension)
            .onChange((v) => {
              override.extension = v;
              save();
            })
        )
        .addText((text) =>
          text
            .setPlaceholder("path template")
            .setValue(override.pathTemplate)
            .onChange((v) => {
              override.pathTemplate = v;
              save();
            })
        )
        .addText((text) =>
          text
            .setPlaceholder("format template")
            .setValue(override.formatTemplate)
            .onChange((v) => {
              override.formatTemplate = v;
              save();
            })
        )
        .addExtraButton((btn) =>
          btn
            .setIcon("trash")
            .setTooltip("Remove")
            .onClick(() => {
              overrides.splice(index, 1);
              save();
              this.display();
            })
        );
    });
  }
}
