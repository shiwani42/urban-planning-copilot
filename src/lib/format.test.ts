import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  dedupeLimitations,
  formatLocaleDateTime,
  formatLocaleTime,
  PLANNER_TIME_ZONE,
} from "./format";

describe("format planner timestamps", () => {
  it("uses IST timezone consistently", () => {
    const iso = "2024-06-15T06:30:00.000Z";
    const formatted = formatLocaleDateTime(iso);
    const parts = new Intl.DateTimeFormat(undefined, {
      timeZone: PLANNER_TIME_ZONE,
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(iso));
    assert.equal(formatted, parts);
    assert.match(formatLocaleTime(iso), /12:00/);
  });
});

describe("dedupeLimitations", () => {
  it("removes case-insensitive duplicates", () => {
    const out = dedupeLimitations([
      "Synthetic flood extents",
      "synthetic flood extents",
      " Transit dataset unavailable ",
    ]);
    assert.equal(out.length, 2);
    assert.equal(out[0], "Synthetic flood extents");
  });
});
