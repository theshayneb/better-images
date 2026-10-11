import { describe, expect, it } from "vitest";
import { recognizeAppliedName } from "../../src/steward/core/recognize";
import { formatDate } from "../../src/steward/core/template";

const FORMAT = "${date}-${originalname}";
const DATE_FORMAT = "YYYY-MM-DD-HH_mm_ss_SSS";

describe("recognizeAppliedName", () => {
  it("returns null when the template has no ${date} or ${originalname}", () => {
    expect(recognizeAppliedName("anything", "${notename}-${originalname}", DATE_FORMAT)).toBeNull();
    expect(recognizeAppliedName("anything", "${date}-fixed", DATE_FORMAT)).toBeNull();
  });

  it("returns null for a name that doesn't match the stamped pattern", () => {
    expect(recognizeAppliedName("Vacation Photo", FORMAT, DATE_FORMAT)).toBeNull();
  });

  it("recovers the original name and timestamp from a once-stamped name", () => {
    const ts = Date.UTC(2024, 0, 15, 12, 0, 0, 0);
    const stamped = `${formatDate(ts, DATE_FORMAT)}-Vacation Photo`;
    const result = recognizeAppliedName(stamped, FORMAT, DATE_FORMAT);
    expect(result).toEqual({ originalName: "Vacation Photo", importedAt: ts });
  });

  it("regression (7e8257c): unwinds a name stamped more than once, recursively, down to the true original", () => {
    const ts1 = Date.UTC(2024, 0, 1, 0, 0, 0, 0);
    const ts2 = Date.UTC(2024, 0, 2, 0, 0, 0, 0);
    const oncestamped = `${formatDate(ts1, DATE_FORMAT)}-Vacation Photo`;
    const twicestamped = `${formatDate(ts2, DATE_FORMAT)}-${oncestamped}`;

    const result = recognizeAppliedName(twicestamped, FORMAT, DATE_FORMAT);
    // The outer (most recent) stamp is unwound one level at a time, and the
    // recursive call re-checks the inner string — ending on the true original,
    // not stopping at the first successful unwrap.
    expect(result?.originalName).toBe("Vacation Photo");
  });

  it("requires the date segment specifically, not just any digits, when the template also has literal text", () => {
    const result = recognizeAppliedName("not-a-date-stamp-at-all", FORMAT, DATE_FORMAT);
    expect(result).toBeNull();
  });

  it("recognizes its own output for a template with extra literal text around the variables", () => {
    const fmt = "img_${date}_${originalname}_final";
    const ts = Date.UTC(2024, 2, 3, 4, 5, 6, 7);
    const stamped = `img_${formatDate(ts, DATE_FORMAT)}_Sunset_final`;
    const result = recognizeAppliedName(stamped, fmt, DATE_FORMAT);
    expect(result).toEqual({ originalName: "Sunset", importedAt: ts });
  });
});
