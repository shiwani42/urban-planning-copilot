import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  dedupeLimitations,
  formatDecisionStatus,
  formatDecisionType,
  formatLocaleDateTime,
  formatLocaleTime,
} from "./format";

describe("format planner timestamps", () => {
  it("uses the runtime local timezone consistently", () => {
    const iso = "2024-06-15T06:30:00.000Z";
    const formatted = formatLocaleDateTime(iso);
    const parts = new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(iso));
    assert.equal(formatted, parts);
    assert.equal(formatLocaleTime(iso), parts.split(", ").pop() ?? parts);
  });
});

describe("decision labels", () => {
  it("humanizes decision types and statuses", () => {
    assert.equal(formatDecisionType("approve_scenario"), "Approved");
    assert.equal(formatDecisionStatus("changes_requested"), "Changes requested");
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
