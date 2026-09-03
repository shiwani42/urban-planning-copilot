import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cartoBasemapUrl, basemapAttribution, resolveCartoApiKey } from "./basemap";

describe("basemap URLs", () => {
  it("uses Carto key query param per docs", () => {
    const url = cartoBasemapUrl("voyager", { NEXT_PUBLIC_CARTO_API_KEY: "test-key-123" });
    assert.match(url, /\/voyager\/\{z\}\/\{x\}\/\{y\}\.png\?key=test-key-123$/);
    assert.doesNotMatch(url, /api_key/);
    assert.doesNotMatch(url, /\{r\}/);
  });

  it("accepts CARTO_API_KEY when NEXT_PUBLIC_ is unset", () => {
    const url = cartoBasemapUrl("voyager", { CARTO_API_KEY: "secret-from-render" });
    assert.match(url, /\?key=secret-from-render$/);
    assert.equal(resolveCartoApiKey({ CARTO_API_KEY: "secret-from-render" }), "secret-from-render");
  });

  it("omits key query when env unset", () => {
    const url = cartoBasemapUrl("positron", {});
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
