import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { attachSanFranciscoParks, loadSanFranciscoParks } from "./sf-data";
import { layerSwatch } from "./layer-styles";
import type { DatasetMeta } from "./types";

describe("San Francisco parks snapshot", () => {
  it("loads a Mission/SoMa Recreation and Parks clip", async () => {
    const parks = await loadSanFranciscoParks();
    assert.ok(parks, "parks.geojson.gz should be checked in");
    assert.equal(parks.dataset.synthetic, false);
    assert.equal(parks.dataset.kind, "parks");
    assert.match(parks.dataset.name, /Recreation and Parks/);
    assert.ok(parks.features.features.length >= 8);
    assert.ok(
      parks.features.features.some((f) => /Mission Playground/i.test(String(f.properties?.name)))
    );
  });

  it("attaches parks onto an SF parcel catalog and leaves synthetic cities alone", async () => {
    const synthetic = {
      datasets: [
        {
          id: "ds-parcels",
          kind: "parcels",
          name: "Parcels",
          synthetic: true,
        } as DatasetMeta,
      ],
      featuresByDataset: {},
    };
    assert.equal(await attachSanFranciscoParks(synthetic), false);
    assert.equal(synthetic.datasets.some((d) => d.kind === "parks"), false);

    const city = {
      datasets: [
        {
          id: "ds-parcels",
          kind: "parcels",
          name: "Active parcels (San Francisco)",
          synthetic: false,
        } as DatasetMeta,
      ],
      featuresByDataset: {},
    };
    assert.equal(await attachSanFranciscoParks(city), true);
    const parks = city.datasets.find((d) => d.kind === "parks");
    assert.ok(parks);
    assert.equal(parks.synthetic, false);
    assert.ok(city.featuresByDataset[parks.id]?.features.length);
  });

  it("legend uses a park polygon swatch, not a pill", () => {
    const swatch = layerSwatch("parks");
    assert.match(swatch.label, /Recreation and Parks/);
    assert.doesNotMatch(swatch.className, /rounded-full/);
  });
});
