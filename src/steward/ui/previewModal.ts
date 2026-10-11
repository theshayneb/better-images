import { App, Modal, Setting } from "obsidian";

export interface DiffItem {
  from: string;
  to: string;
}

export interface PreviewSummary {
  moves: DiffItem[];
  skipped: number;
  filtered: number;
}

const MAX_ROWS_SHOWN = 200;

/** Dry-run preview shown before any command actually moves files. */
export class PreviewModal extends Modal {
  private resolveFn: ((confirmed: boolean) => void) | null = null;

  constructor(app: App, private readonly titleText: string, private readonly summary: PreviewSummary) {
    super(app);
  }

  waitForChoice(): Promise<boolean> {
    this.open();
    return new Promise((resolve) => {
      this.resolveFn = resolve;
    });
  }

  private finish(confirmed: boolean): void {
    const fn = this.resolveFn;
    this.resolveFn = null;
    fn?.(confirmed);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass("attachment-organizer-preview-modal");
    contentEl.createEl("h2", { text: this.titleText });

    contentEl
      .createDiv({ cls: "ao-summary" })
      .setText(`${this.summary.moves.length} to move, ${this.summary.skipped} already correct, ${this.summary.filtered} filtered out`);

    if (this.summary.moves.length === 0) {
      contentEl.createEl("p", { text: "Nothing to do." });
    } else {
      const list = contentEl.createDiv();
      for (const item of this.summary.moves.slice(0, MAX_ROWS_SHOWN)) {
        const row = list.createDiv({ cls: "ao-diff-row" });
        row.createDiv({ cls: "ao-from", text: item.from });
        row.createDiv({ cls: "ao-to", text: item.to });
      }
      if (this.summary.moves.length > MAX_ROWS_SHOWN) {
        contentEl.createEl("p", { text: `…and ${this.summary.moves.length - MAX_ROWS_SHOWN} more` });
      }
    }

    new Setting(contentEl)
      .addButton((btn) =>
        btn.setButtonText("Cancel").onClick(() => {
          this.finish(false);
          this.close();
        })
      )
      .addButton((btn) =>
        btn
          .setButtonText(this.summary.moves.length === 0 ? "Close" : "Apply")
          .setCta()
          .onClick(() => {
            this.finish(this.summary.moves.length > 0);
            this.close();
          })
      );
  }

  onClose(): void {
    this.finish(false);
    this.contentEl.empty();
  }
}
