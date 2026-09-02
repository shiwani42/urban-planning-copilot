import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assessExploreQuestion,
  buildExploreConvertDraft,
  runExploreInvestigation,
} from "./explore";
import { generateSyntheticCity } from "./seed";

function cityLayers(seed = 3) {
  const city = generateSyntheticCity(seed);
  const layers: Record<string, GeoJSON.FeatureCollection> = {};
  for (const d of city.datasets) {
    layers[d.kind] = city.featuresByDataset[d.id];
  }
  return {
    layers,
    datasetIds: Object.fromEntries(city.datasets.map((d) => [d.kind, d.id])),
    datasets: city.datasets,
  };
}

describe("explore question routing", () => {
  it("rejects uninterpretable input", () => {
    const asdf = assessExploreQuestion("asdf");
    assert.equal(asdf.interpretable, false);
    assert.equal(asdf.supported, false);
    const oneChar = assessExploreQuestion("a");
    assert.equal(oneChar.interpretable, false);
  });

  it("rejects unsupported parking questions", () => {
    const assessed = assessExploreQuestion(
      "How should we phase downtown parking reduction over 10 years?"
    );
    assert.equal(assessed.supported, false);
    assert.equal(assessed.analysisType, "unsupported");
  });

  it("routes transit gap vs school gap vs housing siting", () => {
    const transit = assessExploreQuestion("Where are transit accessibility gaps largest?");
    assert.equal(transit.supported, true);
    assert.equal(transit.analysisType, "transit_gap");

    const school = assessExploreQuestion("Which neighborhoods are underserved by schools?");
    assert.equal(school.supported, true);
    assert.equal(school.analysisType, "school_gap");

    const housing = assessExploreQuestion("Where could 500 additional homes fit near transit?");
    assert.equal(housing.supported, true);
    assert.equal(housing.analysisType, "housing_siting");
  });
});

describe("explore investigation engine", () => {
  const base = cityLayers();

  it("produces different results for transit vs school questions", () => {
    const transit = runExploreInvestigation({
      question: "Where are transit accessibility gaps largest?",
      ...base,
    });
    const school = runExploreInvestigation({
      question: "Which neighborhoods are underserved by schools?",
      ...base,
    });
    assert.notEqual(transit.analysisType, school.analysisType);
    assert.notEqual(transit.summary, school.summary);
    const transitTop = transit.candidates[0]?.id;
    const schoolTop = school.candidates[0]?.id;
    assert.ok(transitTop);
    assert.ok(schoolTop);
    // Rankings should differ when sorted by different gap metrics
    const sameOrder =
      transit.candidates.slice(0, 5).map((c) => c.id).join() ===
      school.candidates.slice(0, 5).map((c) => c.id).join();
    assert.equal(sameOrder, false);
  });

  it("uses gap metrics for transit gap — not housing shortlist copy", () => {
    const result = runExploreInvestigation({
      question: "Find neighborhoods with the largest transit accessibility gaps.",
      ...base,
    });
    assert.equal(result.analysisType, "transit_gap");
    assert.match(result.summary, /transit accessibility gaps/i);
    assert.ok(!/eligible candidates/i.test(result.summary));
    assert.ok(result.aggregateMetrics.some((m) => m.key === "gap_area_count"));
    assert.ok(!result.aggregateMetrics.some((m) => m.key === "total_capacity"));
  });

  it("ensures unique candidate ids and labels", () => {
    const result = runExploreInvestigation({
      question: "Where are transit accessibility gaps largest?",
      ...base,
    });
    const ids = result.candidates.map((c) => c.id);
    const labels = result.candidates.map((c) => c.label);
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(new Set(labels).size, labels.length);
  });

  it("ranks by score with rank equal to sort order", () => {
    const result = runExploreInvestigation({
      question: "Where are transit accessibility gaps largest?",
      ...base,
    });
    const scores = result.candidates.map((c) => c.score);
    for (let i = 1; i < scores.length; i++) {
      assert.ok(scores[i] <= scores[i - 1], "scores must be non-increasing by rank");
    }
    result.candidates.forEach((c, i) => {
      assert.equal(c.rank, i + 1);
    });
    const maxScore = Math.max(...scores);
    assert.ok(maxScore < 100, "calibrated scores should not cluster at 100");
  });

  it("deduplicates limitations", () => {
    const result = runExploreInvestigation({
      question: "Where are transit accessibility gaps largest?",
      ...base,
    });
    const lower = result.limitations.map((l) => l.toLowerCase());
    assert.equal(new Set(lower).size, lower.length);
  });

  it("builds convert draft carrying question and findings", () => {
    const result = runExploreInvestigation({
      question: "Where are transit accessibility gaps largest?",
      ...base,
    });
    const draft = buildExploreConvertDraft(result);
    assert.equal(draft.objective, result.question);
    assert.ok(draft.suggestedName);
    assert.ok(draft.summary);
    assert.ok(draft.topCandidates.length > 0);
    assert.equal(draft.topCandidates[0].rank, 1);
  });

  it("throws for unsupported questions", () => {
    assert.throws(
      () =>
        runExploreInvestigation({
          question: "How should we phase downtown parking reduction over 10 years?",
          ...base,
        }),
      /outside supported spatial investigations|not supported/i
    );
  });
});
