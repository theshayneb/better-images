import { formatDate, parseDate } from "./template";

const VARIABLE = /\$\{(date|notepath|notename|parent|originalname|md5)\}/g;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Builds a regex for the ${date} segment from a rendered example (epoch 0)
 * rather than just its length: each digit becomes `\d` (any actual date
 * renders different digits in the same numeric format), everything else —
 * separators, and letters from a token like a month name — is matched
 * literally. Deliberately conservative: an all-numeric `dateFormat` (the
 * default, and the sane choice for a filename) recognizes any real date
 * correctly; a letter-bearing token only recognizes the exact rendering it
 * happened to produce at epoch 0. That's a narrower net, not a wrong one —
 * worse case is failing to recognize a stamp, never mistaking ordinary text
 * for one.
 */
function dateSegmentPattern(dateFormat: string): string {
  const example = formatDate(0, dateFormat);
  return [...example].map((c) => (/\d/.test(c) ? "\\d" : escapeRegExp(c))).join("");
}

export interface RecognizedName {
  originalName: string;
  /** Recovered from the stamped ${date} segment, or null if it didn't parse. */
  importedAt: number | null;
}

/**
 * Inverse of `render(formatTemplate, ...)`: if `basename` already looks like
 * something THIS plugin produced from `formatTemplate` under the current
 * `dateFormat` (recognizable by a fixed-width ${date} segment landing where
 * the template says it should), recovers the ${originalname} piece that was
 * templated in — recursively, in case the name got stamped more than once.
 * Returns null for a name that plain doesn't match the pattern.
 *
 * This is what lets a device that never witnessed a file's true first
 * sighting — because sync delivered the already-renamed file before the
 * record explaining it, or before any record at all — recognize its own
 * output on sight and recover the true original name, instead of adopting
 * the current (already-stamped) name as fresh and stacking another date on
 * top of it.
 */
export function recognizeAppliedName(basename: string, formatTemplate: string, dateFormat: string): RecognizedName | null {
  if (!formatTemplate.includes("${date}") || !formatTemplate.includes("${originalname}")) return null;

  const datePattern = dateSegmentPattern(dateFormat);
  if (!datePattern) return null;

  let pattern = "";
  let dateGroup = -1;
  let nameGroup = -1;
  let group = 0;
  let lastIndex = 0;
  VARIABLE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = VARIABLE.exec(formatTemplate))) {
    pattern += escapeRegExp(formatTemplate.slice(lastIndex, m.index));
    group++;
    if (m[1] === "date") {
      dateGroup = group;
      pattern += `(${datePattern})`;
    } else {
      if (m[1] === "originalname") nameGroup = group;
      pattern += "(.+)";
    }
    lastIndex = VARIABLE.lastIndex;
  }
  pattern += escapeRegExp(formatTemplate.slice(lastIndex));
  if (dateGroup === -1 || nameGroup === -1) return null;

  const match = new RegExp(`^${pattern}$`).exec(basename);
  if (!match) return null;

  const recoveredName = match[nameGroup];
  const importedAt = parseDate(match[dateGroup], dateFormat);

  return recognizeAppliedName(recoveredName, formatTemplate, dateFormat) ?? { originalName: recoveredName, importedAt };
}
