import { App, CachedMetadata, TFile } from "obsidian";

/**
 * Non-markdown files a note currently links/embeds, resolved via the
 * metadata cache so path-less markdown-style links (e.g. `[x](UUID.pdf)`,
 * common in Apple Notes exports) resolve correctly, not just wikilinks.
 */
export function referencedAttachments(app: App, note: TFile, cache: CachedMetadata): Set<string> {
  const out = new Set<string>();
  const refs = [...(cache.embeds ?? []), ...(cache.links ?? [])];
  for (const ref of refs) {
    let link = ref.link.split("#")[0].split("|")[0];
    if (!link || /^[a-z]+:\/\//i.test(link)) continue;
    try {
      link = decodeURIComponent(link);
    } catch {
      // Not URI-encoded — use as-is.
    }
    const dest = app.metadataCache.getFirstLinkpathDest(link, note.path);
    if (dest instanceof TFile && dest.extension.toLowerCase() !== "md") {
      out.add(dest.path);
    }
  }
  return out;
}
