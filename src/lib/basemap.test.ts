import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import { cartoBasemapUrl, basemapAttribution } from "./basemap";

describe("basemap URLs", () => {
  const prev = process.env.NEXT_PUBLIC_CARTO_API_KEY;

  afterEach(() => {
    if (prev === undefined) delete process.env.NEXT_PUBLIC_CARTO_API_KEY;
    else process.env.NEXT_PUBLIC_CARTO_API_KEY = prev;
  });

  it("uses Carto key query param per docs", () => {
    process.env.NEXT_PUBLIC_CARTO_API_KEY = "test-key-123";
    const url = cartoBasemapUrl("voyager");
    assert.match(url, /\/voyager\/\{z\}\/\{x\}\/\{y\}\.png\?key=test-key-123$/);
    assert.doesNotMatch(url, /api_key/);
    assert.doesNotMatch(url, /\{r\}/);
  });

  it("omits key query when env unset", () => {
    delete process.env.NEXT_PUBLIC_CARTO_API_KEY;
    const url = cartoBasemapUrl("positron");
    assert.equal(
      url,
      "https://{s}.basemaps.cartocdn.com/rastertiles/positron/{z}/{x}/{y}.png"
    );
  });

  it("includes OSM and CARTO attribution", () => {
    assert.match(basemapAttribution(), /OpenStreetMap/);
    assert.match(basemapAttribution(), /carto\.com\/attributions/);
  });
});
