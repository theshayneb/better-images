/** Pure path helpers. No Obsidian dependency — final results still go through
 * Obsidian's own `normalizePath` at the call site in resolve.ts. */

export function joinPath(...parts: string[]): string {
  return parts
    .filter((p) => p.length > 0)
    .join("/")
    .replace(/\/+/g, "/")
    .replace(/\/+$/g, "");
}

export function parentPath(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? "" : path.slice(0, idx);
}

export function baseName(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? path : path.slice(idx + 1);
}

/** Unicode-normalize for comparison. macOS/iCloud can hand back NFD while
 * rendered templates produce NFC — compare on this form, never raw strings. */
export function nfc(s: string): string {
  return s.normalize("NFC");
}

export function pathsEqual(a: string, b: string): boolean {
  return nfc(a) === nfc(b);
}
