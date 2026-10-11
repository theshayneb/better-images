import { App } from "obsidian";
import type ImageConverterPlugin from "./main";
import { ImageConverterSettingTab } from "./ImageConverterSettings";

type SettingsSection = "images" | "attachments";

const SECTION_LABELS: Record<SettingsSection, string> = {
    images: "Images",
    attachments: "Attachments",
};

/**
 * One settings tab for both halves of the plugin: the image settings
 * (formerly Image Converter) and the attachment organizer (formerly
 * Attachment Steward), switched with buttons at the top.
 */
export class BetterImagesSettingTab extends ImageConverterSettingTab {
    private section: SettingsSection = "images";

    constructor(app: App, private readonly combinedPlugin: ImageConverterPlugin) {
        super(app, combinedPlugin);
    }

    display(): void {
        const { containerEl } = this;
        if (this.section === "images") {
            containerEl.removeClass("better-images-attachments-section");
            super.display();
            containerEl.prepend(this.createSectionSwitcher());
            return;
        }

        containerEl.empty();
        containerEl.removeClass("image-converter-settings-tab", "global-presets-visible");
        containerEl.addClass("better-images-attachments-section");
        containerEl.appendChild(this.createSectionSwitcher());
        const body = containerEl.createDiv();
        this.combinedPlugin.steward.renderSettings(body, () => this.display());
    }

    /** Redraws the attachments section if it is open, after its settings changed elsewhere (folder menu, folder rename). */
    refreshAttachments(): void {
        if (this.section === "attachments" && this.containerEl.isShown()) this.display();
    }

    private createSectionSwitcher(): HTMLElement {
        const switcher = createDiv({ cls: "better-images-section-switcher" });
        for (const section of Object.keys(SECTION_LABELS) as SettingsSection[]) {
            const button = switcher.createEl("button", { text: SECTION_LABELS[section] });
            if (section === this.section) button.addClass("mod-cta");
            button.addEventListener("click", () => {
                if (this.section === section) return;
                this.section = section;
                this.display();
            });
        }
        return switcher;
    }
}
