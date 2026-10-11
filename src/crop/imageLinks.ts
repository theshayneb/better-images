import { App, TFile } from "obsidian";

/** Formats the crop tool can save back in the same format. */
export const EDITABLE_IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "webp"];

export function isEditableImage(file: unknown): file is TFile {
    return file instanceof TFile && EDITABLE_IMAGE_EXTENSIONS.includes(file.extension.toLowerCase());
}

const WIKI_LINK = /!?\[\[([^\]|#^]+)(?:[#^][^\]|]*)?(?:\|[^\]]*)?\]\]/g;
const MARKDOWN_LINK = /!?\[[^\]]*\]\(\s*<?([^)>]+?)>?(?:\s+"[^"]*")?\s*\)/g;

/**
 * The link path of the wiki or Markdown link that covers column `ch` of
 * `line`, or null if there is none. External URLs are ignored.
 */
export function linkPathAt(line: string, ch: number): string | null {
    for (const pattern of [WIKI_LINK, MARKDOWN_LINK]) {
        pattern.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(line)) !== null) {
            const start = match.index;
            const end = start + match[0].length;
            if (ch < start || ch > end) continue;
            const path = match[1].trim();
            if (/^[a-z][a-z0-9+.-]*:/i.test(path)) return null;
            try {
                return decodeURIComponent(path);
            } catch {
                return path;
            }
        }
    }
    return null;
}

/** The editable image linked at column `ch` of `line` in the note at `sourcePath`, if any. */
export function imageLinkedAt(app: App, line: string, ch: number, sourcePath: string): TFile | null {
    const path = linkPathAt(line, ch);
    if (!path) return null;
    const file = app.metadataCache.getFirstLinkpathDest(path, sourcePath);
    return isEditableImage(file) ? file : null;
}
