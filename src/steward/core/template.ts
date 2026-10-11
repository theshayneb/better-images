import { moment } from "obsidian";

/**
 * Obsidian's `moment` re-export types as `typeof Moment`, which only
 * resolves correctly if the consumer's environment also resolves the
 * `moment` package's own types — not guaranteed in every type-checking
 * environment. Isolating the cast here means a failure to resolve degrades
 * to `any` in exactly one place instead of leaking into every call site.
 */
type MomentFn = (input?: number) => { format(fmt?: string): string };
const momentFn = moment as unknown as MomentFn;

export function formatDate(timestamp: number | undefined, format: string): string {
  return momentFn(timestamp).format(format);
}

type MomentParseFn = (input: string, format: string, strict: boolean) => { isValid(): boolean; valueOf(): number };
const momentParseFn = moment as unknown as MomentParseFn;

/** Inverse of `formatDate`: recovers the epoch ms a rendered date string came from, or null if it doesn't match `format` at all. */
export function parseDate(text: string, format: string): number | null {
  const parsed = momentParseFn(text, format, true);
  return parsed.isValid() ? parsed.valueOf() : null;
}

/**
 * Deliberately contains NO field referencing the attachment's current
 * filename. Every value here comes from the frozen AttachmentRecord (or the
 * owning note's current identity), never from the file as it exists on disk
 * right now — this is what makes repeated template application idempotent
 * instead of compounding.
 */
export interface TemplateContext {
  originalName: string;
  extension: string;
  importedAt: number;
  md5: string;
  notePath: string;
  noteName: string;
  noteParent: string;
  dateFormat: string;
}

export type RenderMode = "folder" | "filename";

const VARIABLE = /\$\{(date|notepath|notename|parent|originalname|md5)\}/g;

/** Characters illegal (or awkward) in a filesystem path segment. */
const ILLEGAL_CHARS = /[\\:|?*"<>]/g;

export function sanitize(raw: string, allowSlashes: boolean): string {
  let out = allowSlashes ? raw.replace(/\\/g, "/") : raw.replace(/[\\/]/g, "-");
  out = out.replace(ILLEGAL_CHARS, "-");
  out = out.replace(/\s+/g, " ").trim();
  // Trailing dots/spaces on a path segment are illegal on some filesystems
  // (and silently stripped on others), so normalize them away up front.
  out = out
    .split("/")
    .map((seg) => seg.replace(/[. ]+$/g, ""))
    .join("/");
  return out;
}

export function render(tpl: string, ctx: TemplateContext, mode: RenderMode): string {
  return tpl.replace(VARIABLE, (_match, variable: string) => {
    let raw: string;
    switch (variable) {
      case "date":
        raw = formatDate(ctx.importedAt, ctx.dateFormat);
        break;
      case "notepath":
        raw = ctx.notePath;
        break;
      case "notename":
        raw = ctx.noteName;
        break;
      case "parent":
        raw = ctx.noteParent;
        break;
      case "originalname":
        raw = ctx.originalName;
        break;
      case "md5":
        raw = ctx.md5;
        break;
      default:
        raw = "";
    }
    const allowSlashes = mode === "folder" && variable === "notepath";
    return sanitize(raw, allowSlashes);
  });
}
