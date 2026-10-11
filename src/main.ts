import { App, MarkdownView, Notice, Plugin, PluginSettingTab, Setting } from "obsidian";
import { Crop } from "./crop/Crop";
import { imageLinkedAt, isEditableImage } from "./crop/imageLinks";
import type { StewardHost } from "./steward/host";
import { findAttachmentStewardFolder, importAttachmentSteward } from "./steward/import";
import { pluginDataDir } from "./steward/store/shards";
import { StewardModule } from "./steward/module";

/** Key in data.json holding the attachment organizer's settings. */
const ATTACHMENTS_DATA_KEY = "attachmentSteward";
/**
 * Set in data.json once the first-run import from Attachment Steward has been
 * tried. Version 1.0.0 saved default attachment settings without importing,
 * so having settings saved doesn't mean the import already happened.
 */
const IMPORT_CHECKED_KEY = "attachmentStewardImportChecked";

const DISABLE_STEWARD_HINT = "Turn off the Attachment Steward plugin so attachments aren't organized twice.";

/**
 * Attachment Steward's attachment organizer, plus a crop / rotate / flip
 * editor (from Image Converter) for images, opened from their right-click menu.
 */
export default class BetterImagesPlugin extends Plugin {
    steward!: StewardModule;
    private stewardData: unknown = null;
    private settingTab!: BetterImagesSettingTab;

    async onload() {
        const saved = (await this.loadData()) as Record<string, unknown> | null;
        this.stewardData = saved?.[ATTACHMENTS_DATA_KEY] ?? null;
        const importChecked = saved?.[IMPORT_CHECKED_KEY] === true;

        const host: StewardHost = {
            app: this.app,
            manifest: this.manifest,
            loadData: () => Promise.resolve(this.stewardData),
            saveData: async (data: unknown) => {
                this.stewardData = data;
                await this.saveData({ [ATTACHMENTS_DATA_KEY]: data, [IMPORT_CHECKED_KEY]: true });
            },
        };

        // First run: take over the stand-alone Attachment Steward's settings and records.
        if (!importChecked) {
            const imported = await this.importFromAttachmentSteward(host, false);
            if (!imported && this.stewardData !== null) await host.saveData(this.stewardData);
        }

        this.steward = new StewardModule(this, host);
        await this.steward.load();

        this.settingTab = new BetterImagesSettingTab(this.app, this, host);
        this.addSettingTab(this.settingTab);
        this.steward.onExternalSettingsChange = () => {
            if (this.settingTab.containerEl.isShown()) this.settingTab.display();
        };

        this.registerImageEditing();
    }

    onunload() {
        this.steward?.unload();
    }

    /**
     * Copies Attachment Steward's settings and records into this plugin.
     * Returns whether anything was imported. With `explicit`, reports when
     * nothing was found; otherwise stays quiet in that case.
     */
    async importFromAttachmentSteward(host: StewardHost, explicit: boolean): Promise<boolean> {
        try {
            const source = await findAttachmentStewardFolder(this.app, pluginDataDir(host));
            if (!source) {
                // eslint-disable-next-line obsidianmd/ui/sentence-case -- Attachment Steward is a plugin name
                if (explicit) new Notice("No Attachment Steward settings found in this vault.");
                return false;
            }
            const { data, records } = await importAttachmentSteward(host, source);
            await host.saveData(data);
            new Notice(`Imported Attachment Steward settings and ${records} record file(s). ${DISABLE_STEWARD_HINT}`, 10000);
            return true;
        } catch (err) {
            console.error("[better-images] failed to import Attachment Steward settings", err);
            // eslint-disable-next-line obsidianmd/ui/sentence-case -- Attachment Steward is a plugin name
            new Notice("Couldn't import Attachment Steward settings. See the developer console for details.");
            return false;
        }
    }

    private openCrop(file: Parameters<typeof isEditableImage>[0]) {
        if (isEditableImage(file)) new Crop(this.app, file).open();
    }

    private registerImageEditing() {
        // Images in the file list, and embedded images in notes (Obsidian
        // shows the same file menu when you right-click those).
        this.registerEvent(
            this.app.workspace.on("file-menu", (menu, file) => {
                if (!isEditableImage(file)) return;
                menu.addItem((item) =>
                    item.setTitle("Crop, rotate or flip").setIcon("crop").onClick(() => this.openCrop(file))
                );
            })
        );

        // Right-clicking an image link in the editor.
        this.registerEvent(
            this.app.workspace.on("editor-menu", (menu, editor, info) => {
                if (!info.file) return;
                const cursor = editor.getCursor();
                const image = imageLinkedAt(this.app, editor.getLine(cursor.line), cursor.ch, info.file.path);
                if (!image) return;
                menu.addItem((item) =>
                    item.setTitle("Crop, rotate or flip image").setIcon("crop").onClick(() => this.openCrop(image))
                );
            })
        );

        this.addCommand({
            id: "crop-rotate-flip-image",
            name: "Crop, rotate or flip image",
            checkCallback: (checking) => {
                const image = this.currentImage();
                if (!image) return false;
                if (!checking) this.openCrop(image);
                return true;
            },
        });
    }

    /** The open image file, or the image linked under the cursor in the active note. */
    private currentImage() {
        const active = this.app.workspace.getActiveFile();
        if (isEditableImage(active)) return active;
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view?.file) return null;
        const cursor = view.editor.getCursor();
        return imageLinkedAt(this.app, view.editor.getLine(cursor.line), cursor.ch, view.file.path);
    }
}

class BetterImagesSettingTab extends PluginSettingTab {
    constructor(app: App, private readonly plugin: BetterImagesPlugin, private readonly host: StewardHost) {
        super(app, plugin);
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        new Setting(containerEl)
            // eslint-disable-next-line obsidianmd/ui/sentence-case -- Attachment Steward is a plugin name
            .setName("Import from Attachment Steward")
            .setDesc(
                // eslint-disable-next-line obsidianmd/ui/sentence-case -- Attachment Steward is a plugin name
                "Copies the settings and attachment records of the Attachment Steward plugin installed in this vault, replacing the ones below. This happens automatically the first time this plugin runs."
            )
            .addButton((button) =>
                button.setButtonText("Import").onClick(async () => {
                    button.setDisabled(true);
                    // Flush pending writes first so they can't land on top of the imported records.
                    await this.plugin.steward.store.saveNow();
                    if (await this.plugin.importFromAttachmentSteward(this.host, true)) {
                        await this.plugin.steward.store.load();
                        this.plugin.steward.applyLogging();
                    }
                    this.display();
                })
            );

        this.plugin.steward.renderSettings(containerEl.createDiv(), () => this.display());
    }
}
