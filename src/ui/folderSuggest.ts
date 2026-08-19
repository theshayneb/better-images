import { AbstractInputSuggest, App, TFolder } from "obsidian";

/** Type-ahead over the vault's existing folders, attached to a plain text input. */
export class FolderSuggest extends AbstractInputSuggest<TFolder> {
  constructor(app: App, private readonly inputEl: HTMLInputElement, private readonly onPick: (folder: TFolder) => void) {
    super(app, inputEl);
  }

  protected getSuggestions(query: string): TFolder[] {
    const q = query.toLowerCase();
    return this.app.vault
      .getAllFolders(true)
      .filter((f) => (f.isRoot() ? "/" : f.path).toLowerCase().includes(q))
      .slice(0, 100);
  }

  renderSuggestion(folder: TFolder, el: HTMLElement): void {
    el.setText(folder.isRoot() ? "/" : folder.path);
  }

  selectSuggestion(folder: TFolder): void {
    this.setValue(folder.path);
    this.onPick(folder);
    this.close();
  }
}
