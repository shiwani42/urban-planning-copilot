import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fetchJsonWithRetry } from "./fetch-json";
import {
  homesCountInTitle,
  objectiveTitleMismatchWarning,
} from "./objective-display";

describe("fetchJsonWithRetry", () => {
  it("retries when the response body is empty", async () => {
    let attempts = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      attempts += 1;
      if (attempts < 2) {
        return new Response("", { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };
    try {
      const { data } = await fetchJsonWithRetry<{ ok: boolean }>("/api/test", undefined, {
        retries: 2,
        label: "Test",
      });
      assert.equal(data.ok, true);
      assert.equal(attempts, 2);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("objectiveTitleMismatchWarning", () => {
  it("detects mismatch between title and parsed target", () => {
    assert.equal(homesCountInTitle("Pass15 Mission 600 homes"), 600);
    const warning = objectiveTitleMismatchWarning("Pass15 Mission 600 homes", 2000);
    assert.match(warning ?? "", /600/);
    assert.match(warning ?? "", /2,000/);
  });

  it("returns null when title and target agree", () => {
    assert.equal(objectiveTitleMismatchWarning("Mission 600 homes", 600), null);
  });
});
