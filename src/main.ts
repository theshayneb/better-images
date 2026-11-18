import { App, MarkdownView, Notice, Platform, Plugin, PluginSettingTab, Setting, TFile, TFolder } from "obsidian";
import { BackgroundTasks } from "./background";
import { CoverDownloader } from "./covers/CoverDownloader";
import { Crop } from "./crop/Crop";
import { imageLinkedAt, isEditableImage } from "./crop/imageLinks";
import type { StewardHost } from "./steward/host";
import { findAttachmentStewardFolder, importAttachmentSteward } from "./steward/import";
import { pluginDataDir } from "./steward/store/shards";
import { StewardModule } from "./steward/module";
import { Store } from "./steward/store/store";
import type { Settings } from "./steward/settings/types";

/** Key in data.json holding the attachment organizer's settings. */
const ATTACHMENTS_DATA_KEY = "attachmentSteward";
/**
 * Set in data.json once the first-run import from Attachment Steward has been
 * tried. Version 1.0.0 saved default attachment settings without importing,
 * so having settings saved doesn't mean the import already happened.
 */
const IMPORT_CHECKED_KEY = "attachmentStewardImportChecked";

/** Key in data.json holding the cover image settings. */
const COVERS_DATA_KEY = "coverImages";

interface CoverSettings {
    /** Download a cover as soon as a web link appears in Image or WideImage. */
    autoDownload: boolean;
}

const DEFAULT_COVER_SETTINGS: CoverSettings = { autoDownload: true };

/** JSON with object keys sorted, so equal data always gives equal text. */
function canonicalJson(value: unknown): string {
    return JSON.stringify(value, (_key, val: unknown) =>
        val && typeof val === "object" && !Array.isArray(val)
            ? Object.fromEntries(Object.entries(val as Record<string, unknown>).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)))
            : val
    );
}

/**
 * Three-way merge of one settings object: a field this device changed since
 * `base` (what it last read from or wrote to disk) keeps its local value;
 * every other field takes the incoming one.
 */
function mergeFields<T extends object>(base: Partial<T>, local: T, incoming: Partial<T>): Partial<T> {
    const merged: Record<string, unknown> = {};
    const keys = new Set([...Object.keys(local), ...Object.keys(incoming)]);
    for (const key of keys) {
        const localValue = (local as Record<string, unknown>)[key];
        const changedHere = canonicalJson(localValue) !== canonicalJson((base as Record<string, unknown>)[key]);
        merged[key] = changedHere ? localValue : (incoming as Record<string, unknown>)[key];
    }
    return merged as Partial<T>;
}

const DISABLE_STEWARD_HINT = "Turn off the Attachment Steward plugin so attachments aren't organized twice.";

/**
 * Attachment Steward's attachment organizer, plus a crop / rotate / flip
 * editor (from Image Converter) for images, opened from their right-click menu.
 */
export default class BetterImagesPlugin extends Plugin {
    steward!: StewardModule;
    covers!: CoverDownloader;
    background!: BackgroundTasks;
    coverSettings: CoverSettings = { ...DEFAULT_COVER_SETTINGS };
    private stewardData: unknown = null;
    private importChecked = false;
    /** data.json as this device last read or wrote it (canonical JSON): the base for merging and for skipping unchanged writes. */
    private lastSaved: string | null = null;
    private settingTab!: BetterImagesSettingTab;

    async onload() {
        this.background = new BackgroundTasks(this.app, Platform.isMobile);
        this.register(() => this.background.dispose());

        const saved = (await this.loadData()) as Record<string, unknown> | null;
        this.lastSaved = saved ? canonicalJson(saved) : null;
        this.stewardData = saved?.[ATTACHMENTS_DATA_KEY] ?? null;
        this.importChecked = saved?.[IMPORT_CHECKED_KEY] === true;
        this.coverSettings = { ...DEFAULT_COVER_SETTINGS, ...(saved?.[COVERS_DATA_KEY] as Partial<CoverSettings> | undefined) };

        const host: StewardHost = {
            app: this.app,
            manifest: this.manifest,
            loadData: () => Promise.resolve(this.stewardData),
            saveData: async (data: unknown) => {
                this.stewardData = data;
                await this.saveAll();
            },
        };

        // First run: take over the stand-alone Attachment Steward's settings and records.
        if (!this.importChecked) {
            const imported = await this.importFromAttachmentSteward(host, false);
            this.importChecked = true;
            if (!imported && this.stewardData !== null) await this.saveAll();
        }

        this.covers = new CoverDownloader(this.app);
        this.steward = new StewardModule(this, host, this.background);
        await this.steward.load();
        // Downloaded covers stay where they are saved, named as they are.
        this.steward.store.isProtected = (path) => this.covers.isCover(path);

        this.settingTab = new BetterImagesSettingTab(this.app, this, host);
        this.addSettingTab(this.settingTab);
        this.steward.onExternalSettingsChange = () => {
            if (this.settingTab.containerEl.isShown()) this.settingTab.display();
        };

        this.registerImageEditing();
        this.registerCoverDownloads();
        this.registerResumeDetection();
    }

    /** Coming back to the foreground or online: let Sync catch up again before automatic work. */
    private registerResumeDetection() {
        if (typeof document === "undefined") return;
        // The main window's visibility (the app going to the background), not a popout's.
        /* eslint-disable obsidianmd/prefer-active-doc */
        this.registerDomEvent(document, "visibilitychange", () => {
            if (document.visibilityState === "visible") this.background.restart();
        });
        /* eslint-enable obsidianmd/prefer-active-doc */
        this.registerDomEvent(window, "online", () => this.background.restart());
    }

    /**
     * Sync (or another program) changed data.json. Take in the new settings,
     * keeping only changes made on this device that haven't been saved yet,
     * instead of letting this device's copy in memory overwrite them later.
     */
    async onExternalSettingsChange() {
        if (!this.steward) return; // still starting up: onload reads the file itself
        const incoming = (await this.loadData()) as Record<string, unknown> | null;
        if (!incoming) return;
        const base = (this.lastSaved ? JSON.parse(this.lastSaved) : {}) as Record<string, unknown>;
        this.lastSaved = canonicalJson(incoming);

        const settingsOf = (data: Record<string, unknown>) =>
            (data[ATTACHMENTS_DATA_KEY] as { settings?: Partial<Settings> } | undefined)?.settings ?? {};
        const attachments = Store.settingsFrom(mergeFields(settingsOf(base), this.steward.store.settings, settingsOf(incoming)));
        const covers = mergeFields((base[COVERS_DATA_KEY] ?? {}) as Partial<CoverSettings>, this.coverSettings, (incoming[COVERS_DATA_KEY] ?? {}) as Partial<CoverSettings>);

        this.steward.store.replaceSettings(attachments);
        this.stewardData = { schema: 2, settings: this.steward.store.settings };
        this.coverSettings = { ...DEFAULT_COVER_SETTINGS, ...covers };
        this.importChecked ||= incoming[IMPORT_CHECKED_KEY] === true;
        this.steward.applyLogging();
        if (this.settingTab.containerEl.isShown()) this.settingTab.display();

        // Only writes if this device had unsaved changes of its own.
        await this.saveAll();
    }

    onunload() {
        this.covers?.cancelAll();
        this.steward?.unload();
    }

    /** Writes data.json, unless it would be exactly what's already there. */
    async saveAll() {
        const data = {
            [ATTACHMENTS_DATA_KEY]: this.stewardData,
            [IMPORT_CHECKED_KEY]: this.importChecked,
            [COVERS_DATA_KEY]: this.coverSettings,
        };
        const json = canonicalJson(data);
        if (json === this.lastSaved) return;
        await this.saveData(data);
        this.lastSaved = json;
    }

    private registerCoverDownloads() {
        this.app.workspace.onLayoutReady(() => {
            this.registerEvent(
                this.app.metadataCache.on("changed", (file) => {
                    this.covers.invalidate();
                    // Only on the device running background tasks, once Sync has settled.
                    if (!this.coverSettings.autoDownload || !this.background.enabled) return;
                    if (file.extension !== "md" || !this.covers.hasWebCover(file)) return;
                    this.background.whenReady(() => {
                        const current = this.app.vault.getAbstractFileByPath(file.path);
                        if (current instanceof TFile && this.covers.hasWebCover(current)) this.covers.schedule(current);
                    });
                })
            );
            this.registerEvent(
                this.app.vault.on("rename", (file, oldPath) => {
                    this.covers.invalidate();
                    if (!(file instanceof TFile) || file.extension !== "md" || !this.background.enabled) return;
                    // Only on the device running background tasks, once Sync has settled; then give
                    // Obsidian a moment to finish updating links and its metadata cache.
                    this.background.whenReady(() =>
                        window.setTimeout(() => {
                            void this.covers.onNoteRenamed(file, oldPath).catch((err) =>
                                console.error("[better-images] cover rename failed", err)
                            );
                        }, 500)
                    );
                })
            );
            this.registerEvent(this.app.vault.on("delete", () => this.covers.invalidate()));
        });

        this.addCommand({
            id: "download-cover-images-current-note",
            name: "Download cover images in current note",
            checkCallback: (checking) => {
                const note = this.app.workspace.getActiveFile();
                if (!(note instanceof TFile) || note.extension !== "md") return false;
                if (!checking) void this.covers.processNotes([note]);
                return true;
            },
        });
        this.addCommand({
            id: "download-cover-images-all-notes",
            name: "Download cover images in all notes",
            callback: () => void this.covers.processNotes(this.app.vault.getMarkdownFiles()),
        });

        this.registerEvent(
            this.app.workspace.on("file-menu", (menu, file) => {
                if (!(file instanceof TFolder)) return;
                menu.addItem((item) =>
                    item
                        .setTitle("Download cover images")
                        .setIcon("image-down")
                        .onClick(() => {
                            const prefix = file.isRoot() ? "" : `${file.path}/`;
                            void this.covers.processNotes(this.app.vault.getMarkdownFiles().filter((note) => note.path.startsWith(prefix)));
                        })
                );
            })
        );
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
        const { background } = this.plugin;

        new Setting(containerEl).setName("This device").setHeading();
        new Setting(containerEl)
            .setName("Run background tasks on this device")
            .setDesc(
                "Downloads cover images, renames covers when notes are renamed, and organizes attachments that arrive through sync. Keep this on for one always-on device only. Saved on this device, not synced. Default: on for desktop, off for phone and tablet."
            )
            .addToggle((toggle) =>
                toggle.setValue(background.enabled).onChange((value) => {
                    background.enabled = value;
                    this.display();
                })
            );

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

        new Setting(containerEl).setName("Cover images").setHeading();
        new Setting(containerEl)
            .setName("Download cover images automatically")
            .setDesc(
                // eslint-disable-next-line obsidianmd/ui/sentence-case -- Image, WideImage and Album are property names
                "When a note's Image or WideImage property holds a web link, save the image to the Images folder next to the note and link the property to it. Named after the note (WideImage adds -wide); notes tagged #song use their Album property instead, so songs on one album share an image. Only happens on a device with background tasks on; the commands and the folder menu work on every device."
            )
            .addToggle((toggle) =>
                toggle.setValue(this.plugin.coverSettings.autoDownload).onChange(async (value) => {
                    this.plugin.coverSettings.autoDownload = value;
                    await this.plugin.saveAll();
                })
            );

        new Setting(containerEl).setName("Attachments").setHeading();
        if (!background.enabled) {
            containerEl.createEl("p", {
                cls: "setting-item-description",
                text: "Background tasks are off on this device: attachments here are left as they are, and the device running background tasks organizes them once they sync. The commands and the folder menu still work here.",
            });
        }
        this.plugin.steward.renderSettings(containerEl.createDiv(), () => this.display());
    }
}
