import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  compactLegacyPayloadInPlace,
  compactLegacyStoreJsonBeforeParse,
  storeJsonNeedsLegacyCompaction,
} from "./store-legacy-compact";
import { bloatedStoreFixture } from "./pass-51-fixture";

describe("store-legacy-compact", () => {
  it("detects bloated candidate geometry in store JSON", () => {
    const raw = bloatedStoreFixture(100);
    assert.equal(storeJsonNeedsLegacyCompaction(raw), true);
  });

  it("strips geometry and provenance from 1500 candidates before parse", () => {
    const raw = bloatedStoreFixture(1500);
    const beforeBytes = Buffer.byteLength(raw, "utf8");
    assert.ok(beforeBytes > 800_000, `expected bloated fixture, got ${beforeBytes} bytes`);

    const { raw: compacted, changed } = compactLegacyStoreJsonBeforeParse(raw);
    assert.equal(changed, true);
    const afterBytes = Buffer.byteLength(compacted, "utf8");
    assert.ok(afterBytes < beforeBytes * 0.5, `expected major shrink, ${beforeBytes} -> ${afterBytes}`);

    const parsed = JSON.parse(compacted) as {
      analysisResults: Array<{ candidates: Array<{ geometry?: unknown; provenance?: unknown }> }>;
    };
    for (const result of parsed.analysisResults) {
      for (const candidate of result.candidates) {
        assert.equal(candidate.geometry, undefined);
        assert.equal(candidate.provenance, undefined);
      }
    }
    assert.equal(parsed.analysisResults[0]!.candidates.length, 1500);
  });

  it("compactLegacyPayloadInPlace strips parsed candidate geometry", () => {
    const parsed = JSON.parse(bloatedStoreFixture(50)) as { analysisResults: unknown[] };
    assert.equal(compactLegacyPayloadInPlace(parsed), true);
    const candidates = (
      parsed.analysisResults[0] as { candidates: Array<Record<string, unknown>> }
    ).candidates;
    assert.ok(candidates.every((c) => !("geometry" in c) && !("provenance" in c)));
    assert.ok(candidates.every((c) => Array.isArray(c.centroid)));
  });

  it("leaves already-compact store JSON unchanged", () => {
    const compact = JSON.stringify({
      version: 1,
      projects: [],
      scenarios: [],
      analysisResults: [
        {
          id: "r1",
          candidates: [{ id: "c1", score: 50, rank: 1, featureIds: [], metrics: [] }],
        },
      ],
    });
    const { raw, changed } = compactLegacyStoreJsonBeforeParse(compact);
    assert.equal(changed, false);
    assert.equal(raw, compact);
  });
});
