import { App, Modal, Setting, TFile } from "obsidian";

const MAX_ROWS_SHOWN = 500;

/**
 * Read-only report of attachment files that exist on disk but have no
 * resolved link/embed pointing at them from anywhere in the vault — the
 * files a broken bulk import can leave behind, which "Adopt" can't see
 * because Adopt only catches attachments a note still references.
 */
export class OrphanReportModal extends Modal {
  constructor(app: App, private readonly scopeLabel: string, private readonly orphans: TFile[]) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass("attachment-organizer-preview-modal");
    contentEl.createEl("h2", { text: `Attachments with no links in "${this.scopeLabel}"` });
    contentEl
      .createDiv({ cls: "ao-summary" })
      .setText(`${this.orphans.length} file${this.orphans.length === 1 ? "" : "s"} found on disk with no note or canvas linking to them.`);

    const list = contentEl.createDiv();
    for (const file of this.orphans.slice(0, MAX_ROWS_SHOWN)) {
      list.createDiv({ cls: "ao-orphan-row", text: file.path });
    }
    if (this.orphans.length > MAX_ROWS_SHOWN) {
      contentEl.createEl("p", { text: `…and ${this.orphans.length - MAX_ROWS_SHOWN} more` });
    }

    new Setting(contentEl)
      .addButton((btn) =>
        btn.setButtonText("Copy paths").onClick(async () => {
          await navigator.clipboard.writeText(this.orphans.map((f) => f.path).join("\n"));
        })
      )
      .addButton((btn) =>
        btn
          .setButtonText("Close")
          .setCta()
          .onClick(() => this.close())
      );
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
