/** Frontmatter properties holding a cover image, and the suffix their saved file gets. */
export const COVER_PROPERTIES = [
    { key: "Image", suffix: "" },
    { key: "WideImage", suffix: "-wide" },
] as const;

/** Folder, next to the note, that downloaded covers are saved in. */
export const COVER_FOLDER = "Images";

/** The cover folder for a note in `parentPath` (the vault root is "" or "/"). */
export function coverFolderFor(parentPath: string): string {
    return parentPath && parentPath !== "/" ? `${parentPath}/${COVER_FOLDER}` : COVER_FOLDER;
}

export const IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "webp", "gif", "avif", "svg"];

const CONTENT_TYPE_EXTENSIONS = new Map<string, string>([
    ["image/jpeg", "jpg"],
    ["image/jpg", "jpg"],
    ["image/pjpeg", "jpg"],
    ["image/png", "png"],
    ["image/webp", "webp"],
    ["image/gif", "gif"],
    ["image/avif", "avif"],
    ["image/svg+xml", "svg"],
]);

export function isWebUrl(value: unknown): value is string {
    return typeof value === "string" && /^https?:\/\//i.test(value.trim());
}

/** A property's value as a single string: the first entry of a list, or null. */
export function propertyText(value: unknown): string | null {
    if (Array.isArray(value)) return propertyText(value[0]);
    if (typeof value === "string") return value.trim() || null;
    if (typeof value === "number") return String(value);
    return null;
}

/** Turns `[[Target|Alias]]` into `Target`; other text is returned unchanged. */
export function stripWikiLink(text: string): string {
    const match = /^\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]$/.exec(text.trim());
    return (match ? match[1] : text).trim();
}

/** Makes `name` safe as a file name on every platform Obsidian runs on. */
export function sanitizeFileName(name: string): string {
    return name
        .replace(/[\\/:*?"<>|#^[\]]/g, "-")
        .replace(/\s+/g, " ")
        .replace(/^[\s.]+|[\s.]+$/g, "");
}

function isSong(tags: string[]): boolean {
    return tags.some((tag) => {
        const name = tag.replace(/^#/, "").toLowerCase();
        return name === "song" || name.startsWith("song/");
    });
}

function albumOf(frontmatter: Record<string, unknown> | undefined): string | null {
    if (!frontmatter) return null;
    const key = Object.keys(frontmatter).find((k) => k.toLowerCase() === "album");
    const text = key ? propertyText(frontmatter[key]) : null;
    return text ? stripWikiLink(text) : null;
}

/**
 * Base file name (no extension, no "-wide") for a note's covers: the note's
 * own name, or for notes tagged #song with an Album property, the album's
 * name, so every song on an album shares one image.
 */
export function coverBaseName(noteBasename: string, frontmatter: Record<string, unknown> | undefined, tags: string[]): { name: string; shared: boolean } {
    const album = isSong(tags) ? albumOf(frontmatter) : null;
    const albumName = album ? sanitizeFileName(album) : "";
    if (albumName) return { name: albumName, shared: true };
    return { name: sanitizeFileName(noteBasename) || "Cover", shared: false };
}

/** Image format recognized from the first bytes of the data, or null. */
export function sniffImageExtension(bytes: Uint8Array): string | null {
    const starts = (...sig: number[]) => sig.every((byte, i) => bytes[i] === byte);
    const ascii = (from: number, to: number) => String.fromCharCode(...bytes.slice(from, to));
    if (starts(0xff, 0xd8, 0xff)) return "jpg";
    if (starts(0x89, 0x50, 0x4e, 0x47)) return "png";
    if (ascii(0, 4) === "GIF8") return "gif";
    if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "webp";
    if (ascii(4, 8) === "ftyp" && /^avi[fs]$/.test(ascii(8, 12))) return "avif";
    const head = ascii(0, Math.min(bytes.length, 512)).trimStart().toLowerCase();
    if (head.startsWith("<svg") || (head.startsWith("<?xml") && head.includes("<svg"))) return "svg";
    return null;
}

/**
 * File extension for downloaded data: from its bytes, else its content type,
 * else the URL. Null if it isn't recognizably an image (e.g. an HTML page).
 */
export function imageExtension(bytes: Uint8Array, contentType: string | undefined, url: string): string | null {
    const sniffed = sniffImageExtension(bytes);
    if (sniffed) return sniffed;
    const type = (contentType ?? "").split(";")[0].trim().toLowerCase();
    if (type.startsWith("text/") || type.includes("html") || type.includes("json")) return null;
    const fromType = CONTENT_TYPE_EXTENSIONS.get(type);
    if (fromType) return fromType;
    let path = url;
    try {
        path = new URL(url).pathname;
    } catch {
        // Not a parseable URL: fall back to the raw text.
    }
    const ext = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase();
    if (ext && IMAGE_EXTENSIONS.includes(ext)) return ext === "jpeg" ? "jpg" : ext;
    return null;
}
