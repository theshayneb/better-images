import { App, getAllTags, normalizePath, Notice, requestUrl, TFile, TFolder } from "obsidian";
import { COVER_PROPERTIES, coverBaseName, coverFolderFor, IMAGE_EXTENSIONS, imageExtension, isWebUrl, propertyText, sanitizeFileName, stripWikiLink } from "./names";

/** Wait this long after a note changes before downloading, so a URL being typed or pasted has settled. */
const SETTLE_MS = 1500;

export interface CoverResult {
    saved: string[];
    errors: string[];
}

/**
 * Downloads web images linked in a note's Image / WideImage properties into
 * the "Images" folder next to the note, named after the note (or, for #song
 * notes, after their Album), and points the property at the saved file.
 */
export class CoverDownloader {
    /** Covers being written right now, before any note links to them yet. */
    private readonly inFlight = new Set<string>();
    private readonly running = new Set<string>();
    private readonly timers = new Map<string, number>();
    private coverPaths: Set<string> | null = null;

    constructor(private readonly app: App) {}

    /** Forget the cached set of cover files; call when notes or files change. */
    invalidate(): void {
        this.coverPaths = null;
    }

    /** Whether `path` is a cover image: being downloaded now, or linked from any note's Image / WideImage property. */
    isCover(path: string): boolean {
        if (this.inFlight.has(path)) return true;
        if (!this.coverPaths) this.coverPaths = this.collectCoverPaths();
        return this.coverPaths.has(path);
    }

    private collectCoverPaths(): Set<string> {
        const out = new Set<string>();
        const keys = new Set<string>(COVER_PROPERTIES.map((prop) => prop.key));
        for (const note of this.app.vault.getMarkdownFiles()) {
            for (const ref of this.app.metadataCache.getFileCache(note)?.frontmatterLinks ?? []) {
                if (!keys.has(ref.key.split(".")[0])) continue;
                const dest = this.app.metadataCache.getFirstLinkpathDest(ref.link.split("#")[0].split("|")[0], note.path);
                if (dest) out.add(dest.path);
            }
        }
        return out;
    }

    /** True if the note has a web link in Image or WideImage. */
    hasWebCover(note: TFile): boolean {
        const frontmatter = this.app.metadataCache.getFileCache(note)?.frontmatter;
        return COVER_PROPERTIES.some((prop) => isWebUrl(propertyText(frontmatter?.[prop.key])));
    }

    /** Process `note` shortly, unless it changes again first. */
    schedule(note: TFile): void {
        const pending = this.timers.get(note.path);
        if (pending) window.clearTimeout(pending);
        this.timers.set(
            note.path,
            window.setTimeout(() => {
                this.timers.delete(note.path);
                void this.processNote(note).then((result) => this.report(result, false));
            }, SETTLE_MS)
        );
    }

    cancelAll(): void {
        for (const timer of this.timers.values()) window.clearTimeout(timer);
        this.timers.clear();
    }

    /** Downloads the covers of every note given, one after another, and reports a summary. */
    async processNotes(notes: TFile[]): Promise<void> {
        const todo = notes.filter((note) => this.hasWebCover(note));
        if (todo.length === 0) {
            // eslint-disable-next-line obsidianmd/ui/sentence-case -- Image and WideImage are property names
            new Notice("No notes with a web link in Image or WideImage.");
            return;
        }
        const noun = (count: number) => (count === 1 ? "note" : "notes");
        // Stays up (duration 0) until the batch is done, counting notes as they finish.
        const progress = new Notice(`Downloading covers for ${todo.length} ${noun(todo.length)}…`, 0);
        const total: CoverResult = { saved: [], errors: [] };
        try {
            for (const [index, note] of todo.entries()) {
                const result = await this.processNote(note);
                total.saved.push(...result.saved);
                total.errors.push(...result.errors);
                if (index + 1 < todo.length) {
                    progress.setMessage(`Downloading covers for ${todo.length} ${noun(todo.length)}… (${index + 1} done)`);
                }
            }
        } finally {
            progress.hide();
        }
        this.report(total, true);
    }

    async processNote(note: TFile): Promise<CoverResult> {
        const result: CoverResult = { saved: [], errors: [] };
        if (this.running.has(note.path)) return result;
        this.running.add(note.path);
        try {
            const cache = this.app.metadataCache.getFileCache(note);
            const frontmatter = cache?.frontmatter as Record<string, unknown> | undefined;
            const base = coverBaseName(note.basename, frontmatter, cache ? getAllTags(cache) ?? [] : []);
            const updates: Record<string, string> = {};

            for (const { key, suffix } of COVER_PROPERTIES) {
                const url = propertyText(frontmatter?.[key]);
                if (!isWebUrl(url)) continue;
                try {
                    const file = await this.saveCover(note, url, `${base.name}${suffix}`, base.shared);
                    updates[key] = `[[${this.app.metadataCache.fileToLinktext(file, note.path, true)}]]`;
                    result.saved.push(file.path);
                } catch (err) {
                    const reason = err instanceof Error ? err.message : String(err);
                    result.errors.push(`${note.basename} (${key}): ${reason}`);
                    console.error(`[better-images] couldn't download ${key} for ${note.path}`, err);
                }
            }

            if (Object.keys(updates).length > 0) {
                await this.app.fileManager.processFrontMatter(note, (fm: Record<string, unknown>) => {
                    for (const [key, link] of Object.entries(updates)) {
                        // Only replace what we downloaded, in case the property changed meanwhile.
                        if (isWebUrl(propertyText(fm[key]))) fm[key] = link;
                    }
                });
            }
        } finally {
            this.running.delete(note.path);
            this.invalidate();
        }
        return result;
    }

    /**
     * Saves the image at `url` as `Images/<name>.<ext>` next to `note`. For a
     * shared (album) cover that already exists, the existing file is reused
     * without downloading; otherwise an existing file of that name is replaced.
     */
    private async saveCover(note: TFile, url: string, name: string, shared: boolean): Promise<TFile> {
        const folder = normalizePath(coverFolderFor(note.parent?.path ?? ""));

        if (shared) {
            const existing = this.findExisting(folder, name);
            if (existing) return existing;
        }

        const response = await requestUrl({ url, throw: false });
        if (response.status < 200 || response.status >= 300) throw new Error(`download failed (HTTP ${response.status})`);
        const data = response.arrayBuffer;
        const headers = response.headers ?? {};
        const contentType = Object.entries(headers).find(([k]) => k.toLowerCase() === "content-type")?.[1];
        const ext = imageExtension(new Uint8Array(data.slice(0, 512)), contentType, url);
        if (!ext) throw new Error("the link isn't an image");

        await this.ensureFolder(folder);
        const path = normalizePath(`${folder}/${name}.${ext}`);
        this.inFlight.add(path);
        try {
            const existing = this.app.vault.getAbstractFileByPath(path);
            if (existing instanceof TFile) {
                await this.app.vault.modifyBinary(existing, data);
                return existing;
            }
            return await this.app.vault.createBinary(path, data);
        } finally {
            // Keep it protected until the note's property links to it.
            window.setTimeout(() => this.inFlight.delete(path), 10000);
        }
    }

    /**
     * After a note is renamed or moved, renames its own covers to match
     * (`Images/<new name>.jpg`, `<new name>-wide.jpg`) and moves them to the
     * Images folder next to the note's new location. Only covers named after
     * the note's old name, in the Images folder next to its old location, are
     * touched; album covers of #song notes are shared, so they stay put.
     */
    async onNoteRenamed(note: TFile, oldPath: string): Promise<void> {
        const cache = this.app.metadataCache.getFileCache(note);
        const frontmatter = cache?.frontmatter as Record<string, unknown> | undefined;
        if (!frontmatter) return;
        const base = coverBaseName(note.basename, frontmatter, cache ? getAllTags(cache) ?? [] : []);
        if (base.shared) return;

        const oldParent = oldPath.includes("/") ? oldPath.slice(0, oldPath.lastIndexOf("/")) : "";
        const oldBasename = oldPath.slice(oldPath.lastIndexOf("/") + 1).replace(/\.md$/i, "");
        const oldFolder = normalizePath(coverFolderFor(oldParent));
        const newFolder = normalizePath(coverFolderFor(note.parent?.path ?? ""));
        const updates: Record<string, string> = {};

        for (const { key, suffix } of COVER_PROPERTIES) {
            const text = propertyText(frontmatter[key]);
            if (!text || isWebUrl(text)) continue;
            const cover = this.app.metadataCache.getFirstLinkpathDest(stripWikiLink(text), note.path);
            if (!cover || cover.parent?.path !== oldFolder || cover.basename !== `${sanitizeFileName(oldBasename)}${suffix}`) continue;

            const target = normalizePath(`${newFolder}/${base.name}${suffix}.${cover.extension}`);
            if (target === cover.path) continue;
            if (this.app.vault.getAbstractFileByPath(target)) {
                new Notice(`Didn't rename ${cover.path}: ${target} already exists.`);
                continue;
            }
            try {
                await this.ensureFolder(newFolder);
                this.inFlight.add(target);
                await this.app.fileManager.renameFile(cover, target);
                updates[key] = `[[${this.app.metadataCache.fileToLinktext(cover, note.path, true)}]]`;
            } catch (err) {
                console.error(`[better-images] couldn't rename cover ${cover.path}`, err);
                new Notice(`Couldn't rename ${cover.path}. See the developer console for details.`);
            } finally {
                window.setTimeout(() => this.inFlight.delete(target), 10000);
            }
        }

        // Obsidian may already have updated the links; set them anyway in case
        // "Automatically update internal links" is off.
        if (Object.keys(updates).length > 0) {
            await this.app.fileManager.processFrontMatter(note, (fm: Record<string, unknown>) => {
                for (const [key, link] of Object.entries(updates)) fm[key] = link;
            });
        }
        this.invalidate();
    }

    private findExisting(folder: string, name: string): TFile | null {
        for (const ext of IMAGE_EXTENSIONS) {
            const file = this.app.vault.getAbstractFileByPath(normalizePath(`${folder}/${name}.${ext}`));
            if (file instanceof TFile) return file;
        }
        return null;
    }

    private async ensureFolder(path: string): Promise<void> {
        const existing = this.app.vault.getAbstractFileByPath(path);
        if (existing instanceof TFolder) return;
        if (existing) throw new Error(`"${path}" exists and isn't a folder`);
        await this.app.vault.createFolder(path);
    }

    private report(result: CoverResult, always: boolean): void {
        if (result.saved.length > 0) {
            const list = result.saved.length === 1 ? result.saved[0] : `${result.saved.length} images`;
            new Notice(`Saved cover: ${list}`);
        } else if (always && result.errors.length === 0) {
            new Notice("Nothing to download.");
        }
        if (result.errors.length > 0) {
            new Notice(`Couldn't download cover image:\n${result.errors.slice(0, 5).join("\n")}`, 10000);
        }
    }
}
